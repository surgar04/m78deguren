//! 独立插件进程。只从匿名管道接收已校验组件，不接受任意磁盘路径或网络监听地址。
//! 主程序负责权限、截止时间和终止；WASI 不预开放目录、环境变量或网络能力。
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::io::{BufRead, Read, Write};
use wasmtime::component::{Component, Linker, ResourceTable};
use wasmtime::{Config, Engine, ResourceLimiter, Store, StoreLimits, StoreLimitsBuilder};
use wasmtime_wasi::{WasiCtx, WasiCtxBuilder, WasiCtxView, WasiView};

wasmtime::component::bindgen!({ path: "../../plugins/wit", world: "plugin" });
const FRAME: usize = 2 * 1024 * 1024;
type Error = Box<dyn std::error::Error>;

/// 逐段读取，禁止 read_line 在遇到恶意无换行输入时无限扩容。
fn frame(reader: &mut impl BufRead, maximum: usize) -> Result<Vec<u8>, Error> {
    let mut result = Vec::new();
    loop {
        let bytes = reader.fill_buf()?;
        if bytes.is_empty() {
            return Err("pipe closed".into());
        }
        let length = bytes
            .iter()
            .position(|&v| v == b'\n')
            .map_or(bytes.len(), |v| v + 1);
        if result.len() + length > maximum {
            return Err("frame too large".into());
        }
        let done = bytes[length - 1] == b'\n';
        result.extend_from_slice(&bytes[..length]);
        reader.consume(length);
        if done {
            return Ok(result);
        }
    }
}
fn send(value: &impl Serialize) -> Result<(), Error> {
    let bytes = serde_json::to_vec(value)?;
    if bytes.len() > FRAME {
        return Err("response too large".into());
    }
    let mut out = std::io::stdout().lock();
    out.write_all(&bytes)?;
    out.write_all(b"\n")?;
    out.flush()?;
    Ok(())
}
struct Host {
    wasi: WasiCtx,
    table: ResourceTable,
    limits: GuestLimits,
    sequence: u64,
    input: std::io::BufReader<std::io::Stdin>,
}
/// memory_size 仅限制单个内存；额外核算整个组件的总量，防止多内存扩大预算。
struct GuestLimits {
    base: StoreLimits,
    total: usize,
    maximum: usize,
    pending: usize,
}
impl ResourceLimiter for GuestLimits {
    fn memory_growing(
        &mut self,
        current: usize,
        desired: usize,
        maximum: Option<usize>,
    ) -> wasmtime::Result<bool> {
        let delta = desired.saturating_sub(current);
        if self
            .total
            .checked_add(delta)
            .is_none_or(|total| total > self.maximum)
        {
            return Ok(false);
        }
        let allowed = self.base.memory_growing(current, desired, maximum)?;
        self.pending = if allowed { delta } else { 0 };
        if allowed {
            self.total += delta;
        }
        Ok(allowed)
    }
    fn memory_grow_failed(&mut self, error: wasmtime::Error) -> wasmtime::Result<()> {
        self.total = self.total.saturating_sub(self.pending);
        self.pending = 0;
        self.base.memory_grow_failed(error)
    }
    fn table_growing(
        &mut self,
        current: usize,
        desired: usize,
        maximum: Option<usize>,
    ) -> wasmtime::Result<bool> {
        self.base.table_growing(current, desired, maximum)
    }
    fn table_grow_failed(&mut self, error: wasmtime::Error) -> wasmtime::Result<()> {
        self.base.table_grow_failed(error)
    }
    fn instances(&self) -> usize {
        self.base.instances()
    }
    fn tables(&self) -> usize {
        self.base.tables()
    }
    fn memories(&self) -> usize {
        self.base.memories()
    }
}
impl WasiView for Host {
    fn ctx(&mut self) -> WasiCtxView<'_> {
        WasiCtxView {
            ctx: &mut self.wasi,
            table: &mut self.table,
        }
    }
}
impl zhenjing::plugin::capabilities::Host for Host {
    fn call(&mut self, request: String) -> Result<String, String> {
        // 插件无法选择自己的身份；代理只接受本次管道实例关联的权限。
        if request.len() > 1024 * 1024 {
            return Err("PLUGIN_FRAME_LIMIT".into());
        }
        self.sequence = self.sequence.checked_add(1).ok_or("PLUGIN_SEQUENCE")?;
        send(&json!({"kind":"capability","sequence":self.sequence,"request":request}))
            .map_err(|_| "PLUGIN_PIPE")?;
        let response = frame(&mut self.input, FRAME).map_err(|_| "PLUGIN_PIPE")?;
        let response: Value = serde_json::from_slice(&response).map_err(|_| "PLUGIN_PROTOCOL")?;
        if response["sequence"].as_u64() != Some(self.sequence) {
            return Err("PLUGIN_SEQUENCE".into());
        }
        if response["ok"] != true {
            return Err(response["error"]
                .as_str()
                .unwrap_or("PLUGIN_CAPABILITY_FAILED")
                .to_owned());
        }
        serde_json::to_string(&response["value"]).map_err(|_| "PLUGIN_PROTOCOL".to_owned())
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Start {
    bytes: usize,
    memory_mb: usize,
    fuel: u64,
    ticket: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Invoke {
    id: String,
    command: String,
    input: Value,
}
fn run() -> Result<(), Error> {
    let mut input = std::io::BufReader::new(std::io::stdin());
    let start: Start = serde_json::from_slice(&frame(&mut input, 4096)?)?;
    if start.bytes > 64 * 1024 * 1024
        || !(16..=256).contains(&start.memory_mb)
        || start.fuel > 500_000_000
        || start.ticket.len() != 36
    {
        return Err("invalid limits".into());
    }
    let mut bytes = vec![0; start.bytes];
    input.read_exact(&mut bytes)?;
    let mut config = Config::new();
    config
        .consume_fuel(true)
        .wasm_component_model(true)
        .max_wasm_stack(512 * 1024);
    // 调试构建中的编译器本身未优化；关闭客体机器码优化，避免大型 JS 引擎冷编译超时。
    // Release 仍使用 Wasmtime 默认的速度优化，执行 fuel 和父进程截止时间不变。
    #[cfg(debug_assertions)]
    config.cranelift_opt_level(wasmtime::OptLevel::None);
    let engine = Engine::new(&config)?;
    // 仅从 Wasm 源字节编译；禁止 deserialize 不受信任的机器码缓存。
    send(&json!({"kind":"starting","stage":"compiling"}))?;
    let component = Component::new(&engine, bytes)?;
    let mut linker = Linker::new(&engine);
    wasmtime_wasi::p2::add_to_linker_sync(&mut linker)?;
    Plugin::add_to_linker::<_, wasmtime::component::HasSelf<Host>>(
        &mut linker,
        |state: &mut Host| state,
    )?;
    let wasi = WasiCtxBuilder::new()
        .max_random_size(1024 * 1024)
        .allow_tcp(false)
        .allow_udp(false)
        .allow_ip_name_lookup(false)
        .build();
    let base = StoreLimitsBuilder::new()
        .memory_size(start.memory_mb * 1024 * 1024)
        .instances(32)
        .memories(32)
        .tables(32)
        .table_elements(100_000)
        .trap_on_grow_failure(true)
        .build();
    let limits = GuestLimits {
        base,
        total: 0,
        maximum: start.memory_mb * 1024 * 1024,
        pending: 0,
    };
    let mut store = Store::new(
        &engine,
        Host {
            wasi,
            table: ResourceTable::new(),
            limits,
            sequence: 0,
            input,
        },
    );
    store.limiter(|state| &mut state.limits);
    store.set_fuel(start.fuel)?;
    send(&json!({"kind":"starting","stage":"instantiating"}))?;
    let plugin = Plugin::instantiate(&mut store, &component, &linker)?;
    send(&json!({"kind":"ready","ticket":start.ticket,"api":"1.0.0"}))?;
    loop {
        let bytes = frame(&mut store.data_mut().input, FRAME)?;
        let request: Invoke = serde_json::from_slice(&bytes)?;
        if request.id.len() != 36 || request.command.len() > 96 {
            return Err("invalid command".into());
        }
        store.set_fuel(start.fuel)?;
        let result = plugin.zhenjing_plugin_lifecycle().call_invoke(
            &mut store,
            &request.command,
            &serde_json::to_string(&request.input)?,
        );
        match result {
            Ok(Ok(text)) if text.len() <= 1024 * 1024 => {
                let value: Value = serde_json::from_str(&text)?;
                send(&json!({"kind":"result","id":request.id,"ok":true,"value":value}))?;
            }
            Ok(Err(_)) => send(
                &json!({"kind":"result","id":request.id,"ok":false,"error":"PLUGIN_GUEST_ERROR"}),
            )?,
            _ => {
                send(&json!({"kind":"result","id":request.id,"ok":false,"error":"PLUGIN_TRAP"}))?;
                return Ok(());
            }
        }
    }
}
fn main() {
    // 原始运行时错误可能包含插件提供的数据，不能写入可导出的 stdout/stderr 日志。
    if run().is_err() {
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn frames_without_newline_cannot_grow_unbounded() {
        let mut input = std::io::Cursor::new(vec![b'x'; 4097]);
        assert!(frame(&mut input, 4096).is_err());
        let mut input = std::io::Cursor::new(b"{}\nnext");
        assert_eq!(frame(&mut input, 16).ok(), Some(b"{}\n".to_vec()));
    }
    #[test]
    fn memory_budget_is_aggregate_and_failed_growth_is_refunded() -> wasmtime::Result<()> {
        let mut limits = GuestLimits {
            base: StoreLimitsBuilder::new().memory_size(128).build(),
            total: 0,
            maximum: 128,
            pending: 0,
        };
        assert!(limits.memory_growing(0, 80, None)?);
        assert!(!limits.memory_growing(0, 80, None)?);
        assert!(limits.memory_growing(80, 100, None)?);
        limits.memory_grow_failed(wasmtime::Error::msg("allocation failed"))?;
        assert_eq!(limits.total, 80);
        assert!(limits.memory_growing(0, 48, None)?);
        assert_eq!(limits.total, 128);
        Ok(())
    }
    #[test]
    fn fuel_stops_a_real_infinite_wasm_loop() -> wasmtime::Result<()> {
        let mut config = Config::new();
        config.consume_fuel(true);
        let engine = Engine::new(&config)?;
        let module =
            wasmtime::Module::new(&engine, "(module (func (export \"spin\") (loop br 0)))")?;
        let mut store = Store::new(&engine, ());
        store.set_fuel(10000)?;
        let instance = wasmtime::Instance::new(&mut store, &module, &[])?;
        assert!(
            instance
                .get_typed_func::<(), ()>(&mut store, "spin")?
                .call(&mut store, ())
                .is_err()
        );
        assert_eq!(store.get_fuel()?, 0);
        Ok(())
    }
}
