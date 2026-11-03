//! 本地结构化诊断：只记录事件及安全上下文，不记录 IPC 参数、返回正文或系统环境快照。
//! 复用应用日志插件的同步写入和轮转；panic 独立落盘，避免在日志锁内崩溃导致死锁。
use crate::services::tools::{Result, error, io_error};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::VecDeque,
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::{
        LazyLock, Mutex, OnceLock,
        atomic::{AtomicU64, Ordering},
    },
    time::Instant,
};

pub const MAX_FILE: u64 = 2 * 1024 * 1024;
/// 在业务 bundle 之前注册，捕获脚本解析/资源加载导致主入口根本无法执行的情况。
/// 只上报固定说明，不读取资源 URL、错误正文、DOM 或页面账号信息。
pub const BOOTSTRAP_SCRIPT: &str = r#"(()=>{let count=0;const report=()=>{if(window.__ZHENJING_DIAGNOSTICS_READY__||count++>=16)return;const api=window.__TAURI_INTERNALS__;if(api&&typeof api.invoke==='function')void api.invoke('diagnostics_execute',{request:{operation:'ingest',entries:[{level:'error',event:'frontend.error',operation:'bootstrap',trace:null,durationMs:null,message:'Bootstrap script or resource failed before application diagnostics were ready'}]}}).catch(()=>{});};window.addEventListener('error',report,true);})()"#;
static CONTEXT: OnceLock<Context> = OnceLock::new();
static DETAIL_UNTIL: AtomicU64 = AtomicU64::new(0);
static INGEST: Mutex<(u64, u64)> = Mutex::new((0, 0));
static DROPPED: AtomicU64 = AtomicU64::new(0);
static LIMIT_WARNING: AtomicU64 = AtomicU64::new(0);
static SENSITIVE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)cookie|authorization|password|token|secret|credential|username|nickname|api.?key|账号|用户名|昵称|密码|令牌|密钥|邮箱|bearer\s").unwrap_or_else(|_| unreachable!())
});
static PRIVATE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?i)https?://[^\s<>]+|[a-z]:[\\/][^\r\n\"<>]*|\\\\[^\r\n\"<>]+|/(?:home|Users)/[^\r\n\"<>]+|[^\s<>@]+@[^\s<>@]+|[A-Za-z0-9_+/=.-]{24,}|\b\d{6,}\b"#).unwrap_or_else(|_| unreachable!())
});

struct Context {
    root: PathBuf,
    session: String,
    previous_unclean: bool,
    recent: Mutex<VecDeque<Value>>,
}
/// 严格枚举级别；前端不能控制日志目标、路径或任意元数据字段。
#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    Debug,
    Info,
    Warn,
    Error,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Input {
    pub level: Level,
    pub event: String,
    pub operation: Option<String>,
    pub trace: Option<String>,
    pub duration_ms: Option<u64>,
    pub message: Option<String>,
}

/// 先截断再匹配，避免恶意巨型日志耗费过多 CPU；含凭据关键词的整条消息不保留。
pub fn redact(input: &str) -> String {
    let limited: String = input.chars().take(4096).collect();
    if SENSITIVE.is_match(&limited) {
        return "[sensitive details omitted]".into();
    }
    if limited.contains('{') || limited.to_lowercase().contains("<html") {
        return "[structured details omitted]".into();
    }
    PRIVATE
        .replace_all(&limited, "[redacted]")
        .chars()
        .filter(|c| !c.is_control() || matches!(c, '\n' | '\t'))
        .take(2048)
        .collect()
}
fn now() -> u64 {
    chrono::Utc::now().timestamp_millis().max(0) as u64
}
pub fn enabled(metadata: &log::Metadata<'_>) -> bool {
    metadata.level() <= log::Level::Info
        || (now() < DETAIL_UNTIL.load(Ordering::Relaxed)
            && metadata.target().starts_with("zhenjing"))
}
fn envelope(
    level: &str,
    source: &str,
    event: &str,
    operation: Option<&str>,
    trace: Option<&str>,
    duration: Option<u64>,
    message: &str,
) -> Value {
    json!({"schema":1,"at":chrono::Utc::now().to_rfc3339(),"session":CONTEXT.get().map(|c|c.session.as_str()).unwrap_or("bootstrap"),"version":env!("CARGO_PKG_VERSION"),"pid":std::process::id(),"level":level,"source":redact(source),"event":event,"operation":operation,"trace":trace,"durationMs":duration,"message":redact(message)})
}
/// 插件格式化器是唯一正文写入关口，现有全部 log:: 调用也必须经过脱敏。
pub fn format(record: &log::Record<'_>) -> String {
    let text = record.args().to_string();
    if record.target() == "zhenjing::event"
        && let Ok(value) = serde_json::from_str::<Value>(&text)
    {
        return value.to_string();
    }
    let value = envelope(
        &record.level().to_string().to_lowercase(),
        record.target(),
        "native.message",
        None,
        None,
        None,
        &text,
    );
    remember(&value);
    value.to_string()
}
fn remember(value: &Value) {
    if let Some(c) = CONTEXT.get()
        && let Ok(mut recent) = c.recent.lock()
    {
        recent.push_front(value.clone());
        recent.truncate(200);
    }
}
pub fn emit(
    level: Level,
    source: &str,
    event: &str,
    operation: Option<&str>,
    trace: Option<&str>,
    duration: Option<u64>,
    message: &str,
) {
    let value = envelope(
        match level {
            Level::Debug => "debug",
            Level::Info => "info",
            Level::Warn => "warn",
            Level::Error => "error",
        },
        source,
        event,
        operation,
        trace,
        duration,
        message,
    );
    if !matches!(level, Level::Debug) || now() < DETAIL_UNTIL.load(Ordering::Relaxed) {
        remember(&value);
    }
    let text = value.to_string();
    match level {
        Level::Debug => log::debug!(target:"zhenjing::event","{text}"),
        Level::Info => log::info!(target:"zhenjing::event","{text}"),
        Level::Warn => log::warn!(target:"zhenjing::event","{text}"),
        Level::Error => log::error!(target:"zhenjing::event","{text}"),
    }
}
pub fn initialize(root: &Path) -> Result<()> {
    let logs = root.join("logs");
    super::tools::ensure_local_path(&logs)?;
    std::fs::create_dir_all(&logs).map_err(io_error)?;
    crate::storage_policy::ensure_local_path(&logs.join("session.json")).map_err(io_error)?;
    let old: Value = read_bounded(&logs.join("session.json"), 4096)
        .ok()
        .filter(|b| b.len() < 4096)
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or(Value::Null);
    let unclean = old["clean"] == false;
    let _ = CONTEXT.set(Context {
        root: root.to_owned(),
        session: uuid::Uuid::new_v4().to_string(),
        previous_unclean: unclean,
        recent: Mutex::new(VecDeque::new()),
    });
    marker(false)?;
    // 仅清理自己管理的历史日志；不遍历用户目录、不跟随链接、不删除更新或工具备份。
    for item in std::fs::read_dir(&logs).map_err(io_error)?.flatten() {
        let name = item.file_name().to_string_lossy().into_owned();
        if ((name.starts_with("zhenjing") || name.starts_with("managed")) && name.ends_with(".log"))
            || (name.starts_with("panic-") && name.ends_with(".json"))
        {
            let meta = item.path().symlink_metadata().map_err(io_error)?;
            if meta.is_file()
                && !meta.file_type().is_symlink()
                && meta
                    .modified()
                    .ok()
                    .and_then(|t| t.elapsed().ok())
                    .is_some_and(|age| age.as_secs() > 14 * 86400)
            {
                let _ = std::fs::remove_file(item.path());
            }
        }
    }
    let mut panics = std::fs::read_dir(&logs)
        .map_err(io_error)?
        .flatten()
        .filter_map(|item| {
            let name = item.file_name();
            let name = name.to_string_lossy();
            let metadata = item.path().symlink_metadata().ok()?;
            if name.starts_with("panic-")
                && name.ends_with(".json")
                && metadata.is_file()
                && !metadata.file_type().is_symlink()
            {
                Some((metadata.modified().ok(), item.path()))
            } else {
                None
            }
        })
        .collect::<Vec<_>>();
    panics.sort_by_key(|item| std::cmp::Reverse(item.0));
    for (_, path) in panics.into_iter().skip(6) {
        let _ = std::fs::remove_file(path);
    }
    let bootstrap = envelope(
        "info",
        "native",
        "session.start",
        None,
        None,
        None,
        if unclean {
            "上次会话未记录正常退出，可能是强制结束、崩溃或另一个实例"
        } else {
            "日志会话已建立"
        },
    );
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open({
            crate::storage_policy::ensure_local_path(&logs.join("zhenjing.log"))
                .map_err(io_error)?;
            logs.join("zhenjing.log")
        })
        .map_err(io_error)?;
    writeln!(file, "{bootstrap}").map_err(io_error)?;
    std::panic::set_hook(Box::new(|info| {
        let message = info
            .payload()
            .downcast_ref::<&str>()
            .copied()
            .or_else(|| info.payload().downcast_ref::<String>().map(String::as_str))
            .unwrap_or("native panic");
        let location = info
            .location()
            .map(|l| {
                format!(
                    "{}:{}",
                    l.file().rsplit(['/', '\\']).next().unwrap_or("native"),
                    l.line()
                )
            })
            .unwrap_or_default();
        let value = envelope(
            "error",
            "native",
            "process.panic",
            Some(&location),
            None,
            None,
            message,
        );
        if let Some(context) = CONTEXT.get() {
            let path = context
                .root
                .join("logs")
                .join(format!("panic-{}.json", context.session));
            if crate::storage_policy::ensure_local_path(&path).is_err() {
                return;
            }
            if let Ok(mut file) = std::fs::File::create(path) {
                let _ = file.write_all(value.to_string().as_bytes());
                let _ = file.sync_all();
            }
        }
        // 不执行原始 hook，避免其向控制台输出未经脱敏的 panic payload。
    }));
    Ok(())
}
fn marker(clean: bool) -> Result<()> {
    if let Some(c) = CONTEXT.get() {
        crate::storage_policy::ensure_local_path(&c.root.join("logs/session.json"))
            .map_err(io_error)?;
        std::fs::write(c.root.join("logs/session.json"),json!({"session":c.session,"pid":std::process::id(),"clean":clean,"at":chrono::Utc::now().to_rfc3339()}).to_string()).map_err(io_error)?;
    }
    Ok(())
}
pub fn shutdown() {
    emit(
        Level::Info,
        "native",
        "session.stop",
        None,
        None,
        None,
        "正常退出",
    );
    log::logger().flush();
    let _ = marker(true);
}
pub fn child_context() -> Option<(PathBuf, String)> {
    CONTEXT
        .get()
        .map(|c| (c.root.join("logs"), c.session.clone()))
}
pub fn detail(enabled: bool) {
    DETAIL_UNTIL.store(
        if enabled { now() + 30 * 60 * 1000 } else { 0 },
        Ordering::Relaxed,
    );
    emit(
        Level::Info,
        "diagnostics",
        "logging.detail",
        None,
        None,
        None,
        if enabled {
            "详细日志已开启，30 分钟后自动关闭"
        } else {
            "详细日志已关闭"
        },
    );
}
fn safe_slug(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 100
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._:/-".contains(&b))
}
pub fn ingest(window: &str, entries: Vec<Input>) -> Result<Value> {
    if entries.len() > 64 {
        return Err(error("单次诊断事件超过上限"));
    }
    for e in &entries {
        if !matches!(
            e.event.as_str(),
            "ipc.start"
                | "ipc.complete"
                | "ipc.failed"
                | "frontend.error"
                | "frontend.rejection"
                | "frontend.console"
                | "query.failed"
                | "mutation.failed"
                | "schema.invalid"
                | "window.event"
                | "log.queue_overflow"
                | "media.state"
                | "media.error"
                | "navigation.changed"
        ) || e.operation.as_ref().is_some_and(|v| !safe_slug(v))
            || e.trace
                .as_ref()
                .is_some_and(|v| uuid::Uuid::parse_str(v).is_err())
            || e.duration_ms.is_some_and(|v| v > 86400000)
            || e.message.as_ref().is_some_and(|v| v.len() > 16384)
        {
            return Err(error("诊断事件字段无效"));
        }
    }
    let mut budget = INGEST.lock().map_err(|_| error("日志限流状态不可用"))?;
    let minute = now() / 60000;
    if budget.0 != minute {
        *budget = (minute, 0);
    }
    let accepted = (600u64.saturating_sub(budget.1)).min(entries.len() as u64) as usize;
    budget.1 += accepted as u64;
    drop(budget);
    if accepted < entries.len() {
        DROPPED.fetch_add((entries.len() - accepted) as u64, Ordering::Relaxed);
        if LIMIT_WARNING.swap(minute, Ordering::Relaxed) != minute {
            emit(
                Level::Warn,
                "diagnostics",
                "logging.rate_limited",
                None,
                None,
                None,
                "前端事件达到每分钟上限，重复事件已合并；可在日志统计中查看限流数量",
            );
        }
    }
    for e in entries.iter().take(accepted) {
        emit(
            e.level,
            window,
            &e.event,
            e.operation.as_deref(),
            e.trace.as_deref(),
            e.duration_ms,
            e.message.as_deref().unwrap_or(""),
        );
    }
    Ok(json!({"accepted":accepted,"dropped":entries.len()-accepted}))
}
/// 只从本应用受限日志目录读取，所有同步磁盘访问由命令层放入阻塞池。
pub fn snapshot(root: &Path, level: &str, search: &str) -> Result<Value> {
    if !matches!(level, "all" | "error" | "warn" | "info" | "debug") || search.chars().count() > 120
    {
        return Err(error("日志筛选条件无效"));
    }
    log::logger().flush();
    let logs = root.join("logs");
    super::tools::ensure_local_path(&logs)?;
    let mut files = Vec::new();
    let mut bytes = 0u64;
    for item in std::fs::read_dir(&logs).map_err(io_error)?.flatten() {
        let name = item.file_name().to_string_lossy().into_owned();
        if ((name.starts_with("zhenjing") || name.starts_with("managed")) && name.ends_with(".log"))
            || (name.starts_with("panic-") && name.ends_with(".json"))
            || name == "startup-failure.json"
        {
            let meta = item.path().symlink_metadata().map_err(io_error)?;
            if meta.is_file() && !meta.file_type().is_symlink() {
                bytes += meta.len();
                files.push((meta.modified().ok(), item.path()));
            }
        }
    }
    files.sort_by_key(|b| std::cmp::Reverse(b.0));
    let mut entries = VecDeque::new();
    if let Some(context) = CONTEXT.get()
        && context.root == root
        && let Ok(recent) = context.recent.lock()
    {
        entries.extend(recent.iter().map(clean_entry));
    }
    let needle = search.to_lowercase();
    for (_, path) in files.iter().take(6) {
        crate::storage_policy::validate_local_path(path, false)
            .map_err(|_| error("日志路径不安全"))?;
        let mut input = std::fs::File::open(path).map_err(io_error)?;
        let size = input.metadata().map_err(io_error)?.len();
        let offset = size.saturating_sub(MAX_FILE + 65536);
        input.seek(SeekFrom::Start(offset)).map_err(io_error)?;
        let mut bytes = Vec::new();
        input
            .take(MAX_FILE + 65536)
            .read_to_end(&mut bytes)
            .map_err(io_error)?;
        let text = String::from_utf8_lossy(&bytes);
        for line in text.lines().rev() {
            if line.trim().is_empty() {
                continue;
            }
            // 旧版纯文本不作为未经审核的附件导出；将其转换成脱敏的兼容事件。
            let value: Value = serde_json::from_str(line).unwrap_or_else(|_| {
                envelope("info", "legacy", "legacy.message", None, None, None, line)
            });
            let value = clean_entry(&value);
            if level != "all" && value["level"] != level {
                continue;
            }
            if !needle.is_empty() && !value.to_string().to_lowercase().contains(&needle) {
                continue;
            }
            if !entries.contains(&value) {
                entries.push_back(value);
            }
            if entries.len() >= 500 {
                break;
            }
        }
        if entries.len() >= 500 {
            break;
        }
    }
    entries.retain(|value| {
        (level == "all" || value["level"] == level)
            && (needle.is_empty() || value.to_string().to_lowercase().contains(&needle))
    });
    entries
        .make_contiguous()
        .sort_by(|a, b| b["at"].as_str().cmp(&a["at"].as_str()));
    entries.truncate(500);
    Ok(
        json!({"session":CONTEXT.get().map(|c|c.session.as_str()).unwrap_or("unavailable"),"version":env!("CARGO_PKG_VERSION"),"bytes":bytes,"files":files.len(),"dropped":DROPPED.load(Ordering::Relaxed),"detailUntil":DETAIL_UNTIL.load(Ordering::Relaxed),"detailed":now()<DETAIL_UNTIL.load(Ordering::Relaxed),"previousUnclean":CONTEXT.get().is_some_and(|c|c.previous_unclean),"entries":entries}),
    )
}
fn valid_time(value: &Value) -> String {
    value
        .as_str()
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|t| t.to_rfc3339())
        .unwrap_or_else(|| "legacy".into())
}
/// 重新构建固定字段，旧文件中任意新增的嵌套对象不会随诊断导出。关联 ID 是应用生成的随机值，予以保留。
fn clean_entry(value: &Value) -> Value {
    let identifier = |key: &str| {
        value[key]
            .as_str()
            .filter(|s| uuid::Uuid::parse_str(s).is_ok())
            .map(str::to_owned)
    };
    json!({"schema":1,"at":valid_time(&value["at"]),"session":identifier("session").unwrap_or_else(||"legacy".into()),"version":value["version"].as_str().and_then(|s|semver::Version::parse(s).ok()).map(|v|v.to_string()).unwrap_or_else(||env!("CARGO_PKG_VERSION").into()),"level":value["level"].as_str().filter(|s|matches!(*s,"error"|"warn"|"info"|"debug")).unwrap_or("info"),"source":metadata_label(value["source"].as_str().unwrap_or("legacy")),"event":metadata_label(value["event"].as_str().unwrap_or("legacy.message")),"operation":value["operation"].as_str().map(metadata_label),"trace":identifier("trace"),"durationMs":value["durationMs"].as_u64().filter(|v|*v<=86400000),"message":redact(value["message"].as_str().unwrap_or(""))})
}
fn metadata_label(value: &str) -> String {
    let private_path =
        value.as_bytes().get(1) == Some(&b':') && value.as_bytes().get(2) == Some(&b'/');
    if !safe_slug(value) || value.contains("://") || SENSITIVE.is_match(value) || private_path {
        "[redacted]".into()
    } else {
        value.to_owned()
    }
}
pub fn bootstrap_failure(message: &str) {
    if let Some(c) = CONTEXT.get() {
        if crate::storage_policy::ensure_local_path(&c.root.join("logs/startup-failure.json"))
            .is_err()
        {
            return;
        }
        let record = envelope(
            "error",
            "native",
            "session.start_failed",
            None,
            None,
            None,
            message,
        );
        let _ = std::fs::write(c.root.join("logs/startup-failure.json"), record.to_string());
    }
}
pub fn export(root: &Path, path: &Path) -> Result<()> {
    super::tools::ensure_local_path(path)?;
    let mut report = snapshot(root, "all", "")?;
    report["schema"] = json!(1);
    report["platform"] = json!(std::env::consts::OS);
    report["architecture"] = json!(std::env::consts::ARCH);
    let auth = root.join("music/ytm-auth-diagnostics.json");
    if auth.is_file() {
        crate::storage_policy::validate_local_path(&auth, false)
            .map_err(|_| error("授权诊断路径无效"))?;
        if let Ok(bytes) = read_bounded(&auth, 8192)
            && bytes.len() <= 8192
            && let Ok(value) = serde_json::from_slice::<Value>(&bytes)
        {
            let timeline:Vec<Value>=value["timeline"].as_array().into_iter().flatten().take(40).map(|row|json!({"at":valid_time(&row["at"]),"phase":if matches!(row["phase"].as_str(),Some("idle"|"opening"|"browser"|"reading"|"verifying"|"confirmed"|"error"|"cancelled")){row["phase"].clone()}else{json!("unknown")},"code":redact(row["code"].as_str().unwrap_or(""))})).collect();
            report["musicAuth"] = json!({"provider":"ytm","timeline":timeline});
        }
    }
    // 默认只导出脱敏事件，不打包用户配置、媒体、数据库、环境变量或会话仓库。
    let mut file = std::fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(path)
        .map_err(|cause| {
            if cause.kind() == std::io::ErrorKind::AlreadyExists {
                error("目标诊断文件已存在，请选择新的文件名")
            } else {
                io_error(cause)
            }
        })?;
    let encoded = serde_json::to_vec_pretty(&report).map_err(|_| error("诊断包序列化失败"))?;
    if file
        .write_all(&encoded)
        .and_then(|()| file.sync_all())
        .is_err()
    {
        drop(file);
        let _ = std::fs::remove_file(path);
        return Err(error("诊断包写入失败，请检查目标磁盘空间和权限"));
    }
    Ok(())
}
fn read_bounded(path: &Path, limit: u64) -> std::io::Result<Vec<u8>> {
    let mut bytes = Vec::new();
    std::fs::File::open(path)?
        .take(limit + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > limit {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "diagnostic file size limit",
        ));
    }
    Ok(bytes)
}
pub fn clear(root: &Path) -> Result<()> {
    let logs = root.join("logs");
    super::tools::ensure_local_path(&logs)?;
    log::logger().flush();
    if let Some(c) = CONTEXT.get()
        && c.root == root
        && let Ok(mut recent) = c.recent.lock()
    {
        recent.clear();
    }
    for item in std::fs::read_dir(&logs).map_err(io_error)?.flatten() {
        let name = item.file_name().to_string_lossy().into_owned();
        if ((name.starts_with("zhenjing") || name.starts_with("managed")) && name.ends_with(".log"))
            || (name.starts_with("panic-") && name.ends_with(".json"))
            || name == "startup-failure.json"
        {
            crate::storage_policy::validate_local_path(&item.path(), false)
                .map_err(|_| error("日志路径无效"))?;
            if item.file_type().map_err(io_error)?.is_file() {
                std::fs::OpenOptions::new()
                    .write(true)
                    .truncate(true)
                    .open(item.path())
                    .map_err(io_error)?;
            }
        }
    }
    emit(
        Level::Info,
        "diagnostics",
        "logging.cleared",
        None,
        None,
        None,
        "用户清除了应用诊断日志",
    );
    Ok(())
}
/// 后台任务也记录开始、耗时和中断，UI 关闭或 Future 被取消时仍有结束线索。
pub struct Task {
    operation: String,
    id: String,
    at: Instant,
    finished: bool,
}
impl Task {
    pub fn cancel(mut self) {
        self.finished = true;
        emit(
            Level::Info,
            "native.task",
            "task.cancelled",
            Some(&self.operation),
            Some(&self.id),
            Some(self.at.elapsed().as_millis().min(u64::MAX as u128) as u64),
            "",
        );
    }
    pub fn new(operation: &str) -> Self {
        let task = Self {
            operation: operation.into(),
            id: uuid::Uuid::new_v4().to_string(),
            at: Instant::now(),
            finished: false,
        };
        emit(
            Level::Info,
            "native.task",
            "task.start",
            Some(operation),
            Some(&task.id),
            None,
            "",
        );
        task
    }
    pub fn finish(mut self, ok: bool) {
        self.finished = true;
        emit(
            if ok { Level::Info } else { Level::Error },
            "native.task",
            if ok { "task.complete" } else { "task.failed" },
            Some(&self.operation),
            Some(&self.id),
            Some(self.at.elapsed().as_millis().min(u64::MAX as u128) as u64),
            "",
        );
    }
}
impl Drop for Task {
    fn drop(&mut self) {
        if !self.finished {
            emit(
                Level::Warn,
                "native.task",
                "task.interrupted",
                Some(&self.operation),
                Some(&self.id),
                Some(self.at.elapsed().as_millis().min(u64::MAX as u128) as u64),
                "",
            );
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn exports_rebuilt_fields_preserving_generated_correlations()
    -> std::result::Result<(), Box<dyn std::error::Error>> {
        let base = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .ok_or("root missing")?
            .join(".cache/verification");
        std::fs::create_dir_all(&base)?;
        let fixture = tempfile::Builder::new()
            .prefix("diagnostics-test-")
            .tempdir_in(base)?;
        let root = fixture.path();
        std::fs::create_dir_all(root.join("logs"))?;
        std::fs::create_dir_all(root.join("music"))?;
        let trace = uuid::Uuid::new_v4().to_string();
        let session = uuid::Uuid::new_v4().to_string();
        let row = serde_json::json!({"at":chrono::Utc::now().to_rfc3339(),"session":session,"trace":trace,"version":"0.10.2","level":"error","source":"native.task","event":"task.failed","operation":"developer_workspace_execute/prepare","message":"file C:/Users/private/name.txt","extra":{"cookie":"fixture-secret-value"}});
        std::fs::write(root.join("logs/zhenjing.log"), format!("{row}\n"))?;
        std::fs::write(root.join("music/ytm-auth-diagnostics.json"),serde_json::json!({"token":"fixture-secret-value","timeline":[{"at":chrono::Utc::now().to_rfc3339(),"phase":"error","code":"session-missing","cookie":"fixture-secret-value"}]}).to_string())?;
        let output = root.join("report.json");
        super::export(root, &output)?;
        let text = std::fs::read_to_string(output)?;
        assert!(!text.contains("fixture-secret-value"));
        assert!(!text.contains("Users/private"));
        assert!(!text.contains("extra"));
        let parsed: serde_json::Value = serde_json::from_str(&text)?;
        assert_eq!(parsed["entries"][0]["trace"], trace);
        assert_eq!(parsed["entries"][0]["session"], session);
        assert_eq!(
            parsed["entries"][0]["operation"],
            "developer_workspace_execute/prepare"
        );
        super::clear(root)?;
        assert_eq!(std::fs::metadata(root.join("logs/zhenjing.log"))?.len(), 0);
        Ok(())
    }
    #[test]
    fn redacts_credentials_identifiers_and_private_locations() {
        for value in [
            "cookie=short",
            "Authorization: Basic abc",
            "stoken=123",
            "mail alice@example.com",
            "path D:\\private\\name.txt",
            "https://example.com/?secret=a",
            "value eyJhbGciOiJIUzI1NiJ9.large.value",
            "account 123456789",
        ] {
            let text = super::redact(value);
            assert!(
                !text.contains("alice")
                    && !text.contains("name.txt")
                    && !text.contains("secret=a")
                    && !text.contains("short")
                    && !text.contains("eyJhb")
                    && !text.contains("123456789")
            );
        }
        assert_eq!(super::redact("臻境已启动"), "臻境已启动");
    }
    #[test]
    fn bounds_and_escapes_untrusted_text() {
        assert!(super::redact(&"中".repeat(10000)).chars().count() <= 2048);
        assert!(!super::redact("message\u{0}tail").contains('\u{0}'));
    }
}
