//! 一插件一宿主进程；匿名管道与一次性实例票据防止跨插件调用。等待、取消和终止都有上限。
use super::{
    PluginState,
    model::{MAX_FRAME, Record},
    package, storage,
};
use crate::services::tools::{Result, error, io_error};
use serde_json::{Value, json};
use std::{
    path::{Path, PathBuf},
    process::Stdio,
    sync::Arc,
    time::Duration,
};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, ChildStdout, Command},
    sync::Mutex,
};
use tokio_util::sync::CancellationToken;

include!(concat!(env!("OUT_DIR"), "/plugin_host_digest.rs"));
struct Process {
    child: Child,
    input: ChildStdin,
    output: BufReader<ChildStdout>,
}
pub struct Session {
    process: Mutex<Process>,
    pub cancellation: CancellationToken,
    pub digest: String,
    // 保持只读文件句柄直至宿主退出，防止摘要校验后替换本机受信任宿主。
    _guard: std::fs::File,
}
async fn frame(reader: &mut BufReader<ChildStdout>) -> Result<Value> {
    let mut bytes = Vec::new();
    loop {
        let next = reader.fill_buf().await.map_err(io_error)?;
        if next.is_empty() {
            return Err(error("PLUGIN_HOST_EXITED"));
        }
        let count = next
            .iter()
            .position(|&b| b == b'\n')
            .map_or(next.len(), |i| i + 1);
        if bytes.len() + count > MAX_FRAME {
            return Err(error("PLUGIN_FRAME_LIMIT"));
        }
        let done = next[count - 1] == b'\n';
        bytes.extend_from_slice(&next[..count]);
        reader.consume(count);
        if done {
            return serde_json::from_slice(&bytes).map_err(|_| error("PLUGIN_PROTOCOL"));
        }
    }
}
async fn send(input: &mut ChildStdin, value: &Value) -> Result<()> {
    let mut bytes = serde_json::to_vec(value).map_err(|_| error("PLUGIN_PROTOCOL"))?;
    if bytes.len() > MAX_FRAME {
        return Err(error("PLUGIN_FRAME_LIMIT"));
    }
    bytes.push(b'\n');
    input.write_all(&bytes).await.map_err(io_error)?;
    input.flush().await.map_err(io_error)
}
pub fn host_path() -> Result<PathBuf> {
    let installed = std::env::current_exe()
        .map_err(io_error)?
        .parent()
        .ok_or_else(|| error("PLUGIN_HOST_MISSING"))?
        .join("components/plugin-host/zhenjing-plugin-host.exe");
    if installed.is_file() {
        return Ok(installed);
    }
    #[cfg(debug_assertions)]
    {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("resources/plugin-host/zhenjing-plugin-host.exe");
        if path.is_file() {
            return Ok(path);
        }
    }
    Err(error("PLUGIN_HOST_MISSING：请构建插件宿主或修复应用安装"))
}
fn protect(path: &Path) -> Result<std::fs::File> {
    use std::io::Read;
    storage::ordinary_tree(path)?;
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.share_mode(1);
    }
    let mut file = options.open(path).map_err(io_error)?;
    if file.metadata().map_err(io_error)?.len() > 256 * 1024 * 1024 {
        return Err(error("PLUGIN_HOST_INTEGRITY"));
    }
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).map_err(io_error)?;
    let expected =
        PLUGIN_HOST_DIGEST.ok_or_else(|| error("PLUGIN_HOST_INTEGRITY：宿主摘要未构建"))?;
    if package::digest(&bytes) != expected {
        return Err(error("PLUGIN_HOST_INTEGRITY：宿主文件与应用不一致"));
    }
    Ok(file)
}
impl Session {
    /// 只做零等待的进程查询；正在执行调用时不争抢管道锁，也不阻塞快照轮询。
    pub fn is_alive(&self) -> bool {
        if self.cancellation.is_cancelled() {
            return false;
        }
        let Ok(mut process) = self.process.try_lock() else {
            return true;
        };
        let alive = process
            .child
            .try_wait()
            .is_ok_and(|status| status.is_none());
        if !alive {
            self.cancellation.cancel();
            log::info!("插件宿主已退出");
        }
        alive
    }
    pub(super) async fn start(
        root: &Path,
        record: &Record,
        component: Vec<u8>,
        cancellation: CancellationToken,
        group: &super::isolation::ProcessGroup,
    ) -> Result<Arc<Self>> {
        if cancellation.is_cancelled() {
            return Err(error("PLUGIN_CANCELLED"));
        }
        let (path, guard) = tauri::async_runtime::spawn_blocking(|| {
            let path = host_path()?;
            let guard = protect(&path)?;
            Ok::<_, crate::error::AppError>((path, guard))
        })
        .await
        .map_err(|_| error("PLUGIN_HOST_INTEGRITY"))??;
        let temporary = root.join("tmp");
        tokio::fs::create_dir_all(&temporary)
            .await
            .map_err(io_error)?;
        let mut command = Command::new(&path);
        command
            .env_clear()
            .env("TEMP", &temporary)
            .env("TMP", &temporary)
            .current_dir(root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        // 仅影响本次子进程；低于普通优先级，避免计算型插件抢占桌面主进程。
        #[cfg(windows)]
        command.creation_flags(0x08004000);
        let mut child = command.spawn().map_err(|_| error("PLUGIN_HOST_START"))?;
        // 在发送任何组件字节之前加入回收组；失败时 kill_on_drop 会终止尚未执行客体的进程。
        group.attach(&child)?;
        let mut input = child.stdin.take().ok_or_else(|| error("PLUGIN_PIPE"))?;
        let output = child.stdout.take().ok_or_else(|| error("PLUGIN_PIPE"))?;
        let mut output = BufReader::new(output);
        let ticket = uuid::Uuid::new_v4().to_string();
        let started = async {
            send(&mut input,&json!({"bytes":component.len(),"memoryMb":record.manifest.limits.memory_mb,"fuel":record.manifest.limits.fuel,"ticket":ticket})).await?;
            input.write_all(&component).await.map_err(io_error)?;
            input.flush().await.map_err(io_error)?;
            // 只接受宿主定义的两个阶段，既能定位编译/初始化耗时，也不能靠心跳刷新 60 秒总期限。
            for stage in ["compiling", "instantiating"] {
                let progress = frame(&mut output).await?;
                if progress["kind"] != "starting" || progress["stage"] != stage {
                    return Err(error("PLUGIN_HANDSHAKE"));
                }
                if stage == "compiling" {
                    log::info!("插件组件编译已开始");
                } else {
                    log::info!("插件组件初始化已开始");
                }
            }
            let ready = frame(&mut output).await?;
            if ready["kind"] != "ready" || ready["ticket"] != ticket || ready["api"] != "1.0.0" {
                return Err(error("PLUGIN_HANDSHAKE"));
            }
            Ok(())
        };
        // 编译启动也有独立截止时间，不能让有效签名的大组件长期占据应用启动流程。
        let outcome = tokio::select! {_ = cancellation.cancelled()=>Err(error("PLUGIN_CANCELLED")),result=tokio::time::timeout(Duration::from_secs(60),started)=>result.map_err(|_|error("PLUGIN_START_TIMEOUT")).and_then(|v|v)};
        if let Err(cause) = outcome {
            let _ = child.kill().await;
            return Err(cause);
        }
        log::info!("插件宿主已启动");
        Ok(Arc::new(Self {
            process: Mutex::new(Process {
                child,
                input,
                output,
            }),
            cancellation,
            digest: record.digest.clone(),
            _guard: guard,
        }))
    }
    pub async fn stop(&self) {
        self.cancellation.cancel();
        let mut process = self.process.lock().await;
        let _ = process.child.start_kill();
        let _ = tokio::time::timeout(Duration::from_secs(3), process.child.wait()).await;
        log::info!("插件宿主已停止");
    }
    pub async fn invoke<R: tauri::Runtime>(
        &self,
        state: &PluginState,
        app: &tauri::AppHandle<R>,
        record: &Record,
        command: &str,
        value: Value,
        data_scope: Option<&Path>,
    ) -> Result<Value> {
        PluginState::verify_channel(record)?;
        if data_scope.is_none() {
            state.available(&record.manifest.id)?;
        }
        // 排队也计入截止时间，防止并发调用在互斥锁前无限积压。
        let execution = async {
            let mut process = self.process.lock().await;
            let id = uuid::Uuid::new_v4().to_string();
            send(
                &mut process.input,
                &json!({"id":id,"command":command,"input":value}),
            )
            .await?;
            let mut calls = 0u32;
            loop {
                let response = frame(&mut process.output).await?;
                if response["kind"] == "capability" {
                    calls += 1;
                    if calls > 128 {
                        return Err(error("PLUGIN_CALL_LIMIT"));
                    }
                    let sequence = response["sequence"]
                        .as_u64()
                        .ok_or_else(|| error("PLUGIN_PROTOCOL"))?;
                    let request = response["request"]
                        .as_str()
                        .ok_or_else(|| error("PLUGIN_PROTOCOL"))?;
                    let result = state.capability(app, record, request, data_scope).await;
                    let result = match result {
                        Ok(value) => json!({"sequence":sequence,"ok":true,"value":value}),
                        Err(_) => {
                            json!({"sequence":sequence,"ok":false,"error":"PLUGIN_CAPABILITY_DENIED_OR_FAILED"})
                        }
                    };
                    send(&mut process.input, &result).await?;
                } else if response["kind"] == "result" && response["id"] == id {
                    if response["ok"] == true {
                        return Ok(response["value"].clone());
                    }
                    return Err(error("PLUGIN_EXECUTION_FAILED"));
                } else {
                    return Err(error("PLUGIN_PROTOCOL"));
                }
            }
        };
        tokio::select! {
            _ = state.shutdown.cancelled() => Err(error("PLUGIN_CANCELLED")),
            _ = self.cancellation.cancelled() => Err(error("PLUGIN_CANCELLED")),
            result = tokio::time::timeout(Duration::from_millis(record.manifest.limits.timeout_ms),execution) => result.map_err(|_|error("PLUGIN_TIMEOUT"))?,
        }
    }
}
