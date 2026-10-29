//! 硬件服务是唯一采样与记录来源。多窗口只查询该服务，不各自启动驱动、WMI 或计时器造数。
pub mod frames;
pub mod history;
pub mod readings;
#[cfg(test)]
mod readings_test;
pub mod remote;
pub mod types;
use crate::services::tools::{Result, check_local_path, ensure_local_path, error, io_error};
use std::{
    path::{Path, PathBuf},
    process::Stdio,
    sync::Arc,
    time::Duration,
};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, BufReader},
    process::Command,
    sync::{Mutex, RwLock},
};
use tokio_util::sync::CancellationToken;
use types::{Message, Sensor, Snapshot, text_valid};

struct Worker {
    stop: CancellationToken,
    handle: tokio::task::JoinHandle<()>,
}
pub struct HardwareState {
    pub ui_seen: std::sync::atomic::AtomicI64,
    pub hud_input: Mutex<Option<tokio::process::ChildStdin>>,
    pub hud_generation: std::sync::atomic::AtomicU64,
    pub hud: RwLock<serde_json::Value>,
    pub game: RwLock<serde_json::Value>,
    pub root: PathBuf,
    pub snapshot: Arc<RwLock<Snapshot>>,
    pub history: Mutex<Option<history::History>>,
    pub frames: Arc<frames::Frames>,
    pub remote: remote::Remote,
    serial: Mutex<()>,
    worker: Mutex<Option<Worker>>,
}
pub type Hardware = Arc<HardwareState>;
impl HardwareState {
    pub fn new(root: &Path) -> Result<Hardware> {
        let root = root.join("hardware");
        ensure_local_path(&root)?;
        std::fs::create_dir_all(&root).map_err(io_error)?;
        Ok(Arc::new(Self {
            ui_seen: std::sync::atomic::AtomicI64::new(0),
            hud_input: Mutex::new(None),
            hud_generation: std::sync::atomic::AtomicU64::new(0),
            hud: RwLock::new(serde_json::json!({})),
            game: RwLock::new(serde_json::json!({"processId":0})),
            root,
            snapshot: Arc::new(RwLock::new(Snapshot::default())),
            history: Mutex::new(None),
            frames: Arc::new(frames::Frames::default()),
            remote: remote::Remote::default(),
            serial: Mutex::new(()),
            worker: Mutex::new(None),
        }))
    }
    pub async fn start(self: &Arc<Self>) -> Result<()> {
        let _guard = self.serial.lock().await;
        let absent = self.worker.lock().await.is_none();
        if absent {
            self.spawn(false).await;
        }
        Ok(())
    }
    async fn spawn(self: &Arc<Self>, privileged: bool) {
        {
            let mut current = self.snapshot.write().await;
            current.status = "starting".into();
            current.privileged = false;
            current.warnings.clear();
        }
        let state = self.clone();
        let stop = CancellationToken::new();
        let cancel = stop.clone();
        let handle = tokio::spawn(async move {
            let absent = state.history.lock().await.is_none();
            if absent {
                match history::History::open(&state.root).await {
                    Ok(store) => {
                        state.snapshot.write().await.recording = store.status();
                        *state.history.lock().await = Some(store);
                    }
                    Err(cause) => {
                        state.snapshot.write().await.recording.error = Some(cause.to_string());
                    }
                }
            }
            for attempt in 0..3 {
                if cancel.is_cancelled() {
                    break;
                }
                let result = run_child(&state, privileged, cancel.clone()).await;
                if cancel.is_cancelled() {
                    break;
                }
                let mut snapshot = state.snapshot.write().await;
                snapshot.status = "failed".into();
                snapshot.captured_at = None;
                snapshot.metrics.clear();
                snapshot.gpus.clear();
                snapshot
                    .sensors
                    .iter_mut()
                    .for_each(|sensor| sensor.value = None);
                snapshot.warnings = vec![format!(
                    "{}（自动恢复 {}/3）",
                    result
                        .err()
                        .map_or("监控进程已退出".into(), |cause| cause.to_string()),
                    attempt + 1
                )];
                drop(snapshot);
                tokio::select! { _ = cancel.cancelled() => break, _ = tokio::time::sleep(Duration::from_secs(2 << attempt)) => {} }
            }
            if let Some(store) = state.history.lock().await.as_mut() {
                let _ = store.flush().await;
            }
        });
        *self.worker.lock().await = Some(Worker { stop, handle });
    }
    pub async fn restart(self: &Arc<Self>, privileged: bool) -> Result<()> {
        let _guard = self.serial.lock().await;
        if let Some(worker) = self.worker.lock().await.take() {
            worker.stop.cancel();
            let _ = worker.handle.await;
        }
        self.spawn(privileged).await;
        Ok(())
    }
    pub async fn shutdown(&self) -> Result<()> {
        let _guard = self.serial.lock().await;
        self.remote.stop().await;
        let frames = self.frames.clone();
        tauri::async_runtime::spawn_blocking(move || frames.stop())
            .await
            .map_err(|_| error("ETW 关闭任务失败"))??;
        if let Some(worker) = self.worker.lock().await.take() {
            worker.stop.cancel();
            let _ = worker.handle.await;
        }
        if let Some(history) = self.history.lock().await.as_mut() {
            history.flush().await?;
        }
        self.snapshot.write().await.status = "stopped".into();
        Ok(())
    }
    /// HUD 退出时只释放自己启动的闲置助手，不停止硬件页或远程监控持有的采样。
    pub async fn pause_if_idle(&self) -> Result<bool> {
        let _guard = self.serial.lock().await;
        if chrono::Utc::now().timestamp_millis()
            - self.ui_seen.load(std::sync::atomic::Ordering::Relaxed)
            < 10000
            || self.frames.snapshot().enabled
            || self.remote.is_active().await
        {
            return Ok(false);
        }
        if let Some(worker) = self.worker.lock().await.take() {
            worker.stop.cancel();
            let _ = worker.handle.await;
        }
        if let Some(history) = self.history.lock().await.as_mut() {
            history.flush().await?;
        }
        self.snapshot.write().await.status = "stopped".into();
        Ok(true)
    }
    pub async fn read(&self) -> Snapshot {
        let mut result = self.snapshot.read().await.clone();
        result.fps = self.frames.snapshot();
        if result
            .captured_at
            .is_some_and(|at| chrono::Utc::now().timestamp_millis() - at > 5000)
        {
            result.status = "stale".into();
            result.metrics.clear();
            result
                .gpus
                .iter_mut()
                .for_each(|gpu| gpu.metrics.values_mut().for_each(|value| *value = None));
            result
                .sensors
                .iter_mut()
                .for_each(|sensor| sensor.value = None);
        }
        result
    }
    pub async fn clear(&self) -> Result<()> {
        let mut store = self.history.lock().await;
        if let Some(history) = store.as_mut() {
            history.clear().await?;
        } else {
            *store = Some(history::History::discard(&self.root).await?);
        }
        let mut snapshot = self.snapshot.write().await;
        snapshot.samples.clear();
        snapshot.recording = types::Recording::default();
        snapshot.sensors.iter_mut().for_each(|sensor| {
            sensor.min = sensor.value;
            sensor.max = sensor.value;
        });
        Ok(())
    }
    async fn accept(&self, message: Message) -> Result<()> {
        match message {
            Message::Hud { data } => {
                let incoming = data
                    .as_object()
                    .filter(|object| object.len() <= 8)
                    .ok_or_else(|| error("HUD 助手响应结构无效"))?;
                if serde_json::to_vec(&data)
                    .map_err(|_| error("HUD 数据无效"))?
                    .len()
                    > 524288
                    || incoming.keys().any(|key| {
                        ![
                            "catalog",
                            "capturedAt",
                            "profileId",
                            "render",
                            "missing",
                            "variables",
                            "error",
                            "power",
                            "triggeredAt",
                        ]
                        .contains(&key.as_str())
                    })
                {
                    return Err(error("HUD 响应超出允许范围"));
                }
                let mut state = self.hud.write().await;
                if let Some(object) = state.as_object_mut() {
                    if incoming.contains_key("render") {
                        object.remove("error");
                    }
                    for (key, value) in incoming {
                        object.insert(key.clone(), value.clone());
                    }
                }
            }
            Message::Capabilities { privileged } => {
                self.snapshot.write().await.privileged = privileged
            }
            Message::Inventory { devices, warnings } => {
                if devices.len() > 256
                    || devices.iter().any(|device| {
                        !text_valid(&device.id, 256)
                            || !text_valid(&device.kind, 32)
                            || !text_valid(&device.name, 1024)
                            || !matches!(
                                device.kind.as_str(),
                                "cpu"
                                    | "gpu"
                                    | "memory"
                                    | "motherboard"
                                    | "bios"
                                    | "disk"
                                    | "volume"
                                    | "audio"
                                    | "network"
                                    | "monitor"
                                    | "os"
                            )
                            || device.fields.len() > 64
                            || device.fields.iter().any(|field| {
                                !text_valid(&field.label, 160) || !text_valid(&field.value, 1024)
                            })
                    })
                {
                    return Err(error("硬件型号响应不符合约定"));
                }
                validate_warnings(&warnings)?;
                let mut current = self.snapshot.write().await;
                current.devices = devices;
                current.warnings = warnings;
            }
            Message::Sample {
                captured_at,
                mut sensors,
                metrics,
                warnings,
            } => {
                let now = chrono::Utc::now().timestamp_millis();
                if now.abs_diff(captured_at) > 60_000
                    || sensors.len() > 8192
                    || sensors.iter().any(|sensor| !valid_sensor(sensor))
                {
                    return Err(error("传感器响应无效、过大或时间戳异常"));
                }
                validate_warnings(&warnings)?;
                let process_name = metrics
                    .process_name
                    .clone()
                    .filter(|name| text_valid(name, 256));
                *self.game.write().await = serde_json::json!({"processId":metrics.game_process_id,
                    "name":metrics.game_name.as_ref().filter(|name|text_valid(name,256)),
                    "reason":metrics.game_reason.as_ref().filter(|name|text_valid(name,256)),"capturedAt":captured_at});
                let (mut metrics, mut gpus, pid) = readings::summarize(&sensors, metrics);
                readings::complete_devices(&mut gpus, &self.snapshot.read().await.devices);
                for (name, value) in &mut metrics {
                    if value.is_some_and(|value| {
                        !value.is_finite()
                            || value.abs() > 1e15
                            || (matches!(name.as_str(), "cpu" | "memory")
                                && !(0.0..=100.0).contains(&value))
                    }) {
                        *value = None;
                    }
                }
                self.frames.foreground(pid);
                let fps = self.frames.snapshot();
                let sample = types::Sample {
                    timestamp: captured_at,
                    metrics: metrics.clone(),
                    gpus: gpus.clone(),
                    fps: fps.clone(),
                };
                // 与 clear/export 使用相同锁，保证成功清除之前开始写入的样本不能晚到并回写旧历史。
                let mut history = self.history.lock().await;
                let mut current = self.snapshot.write().await;
                let extrema: std::collections::HashMap<_, _> = current
                    .sensors
                    .iter()
                    .map(|sensor| (sensor.id.as_str(), (sensor.min, sensor.max)))
                    .collect();
                for sensor in &mut sensors {
                    let old = extrema.get(sensor.id.as_str());
                    sensor.min = old
                        .and_then(|old| old.0)
                        .into_iter()
                        .chain(sensor.value)
                        .reduce(f64::min);
                    sensor.max = old
                        .and_then(|old| old.1)
                        .into_iter()
                        .chain(sensor.value)
                        .reduce(f64::max);
                }
                current.status = if warnings.is_empty() {
                    "ready"
                } else {
                    "degraded"
                }
                .into();
                current.captured_at = Some(captured_at);
                current.sensors = sensors;
                current.metrics = metrics;
                current.gpus = gpus;
                current.warnings = warnings;
                current.fps = fps;
                current.process_name = process_name;
                current.process_id = pid;
                current.samples.push(sample.clone());
                if current.samples.len() > 360 {
                    current.samples.remove(0);
                }
                drop(current);
                if let Some(store) = history.as_mut() {
                    let failure = store
                        .append(sample)
                        .await
                        .err()
                        .map(|cause| cause.to_string());
                    let mut status = store.status();
                    status.error = failure;
                    self.snapshot.write().await.recording = status;
                }
            }
            Message::Error { message } => {
                return Err(error(message.chars().take(1024).collect::<String>()));
            }
        }
        Ok(())
    }
}
fn validate_warnings(warnings: &[String]) -> Result<()> {
    if warnings.len() > 128 || warnings.iter().any(|warning| !text_valid(warning, 1024)) {
        return Err(error("硬件警告响应无效"));
    }
    Ok(())
}
fn valid_sensor(sensor: &Sensor) -> bool {
    [
        &sensor.id,
        &sensor.hardware_id,
        &sensor.hardware,
        &sensor.name,
    ]
    .into_iter()
    .all(|value| text_valid(value, 512))
        && [&sensor.hardware_type, &sensor.sensor_type, &sensor.unit]
            .into_iter()
            .all(|value| text_valid(value, 64))
        && sensor
            .value
            .is_none_or(|value| value.is_finite() && value.abs() < 1e15)
}
pub(crate) async fn helper(root: &Path) -> Result<PathBuf> {
    use sha2::{Digest, Sha256};
    const BYTES: &[u8] = include_bytes!("../../../resources/hardware-monitor/ZhenjingMonitor.exe");
    let digest = tauri::async_runtime::spawn_blocking(|| format!("{:x}", Sha256::digest(BYTES)))
        .await
        .map_err(|_| error("硬件助手摘要任务失败"))?;
    let directory = root.join(format!("monitor-{digest}"));
    check_local_path(&directory).await?;
    tokio::fs::create_dir_all(&directory)
        .await
        .map_err(io_error)?;
    let path = directory.join("ZhenjingMonitor.exe");
    if tokio::fs::read(&path).await.ok().as_deref() != Some(BYTES) {
        let temporary = directory.join(format!("{}.tmp", uuid::Uuid::new_v4()));
        tokio::fs::write(&temporary, BYTES)
            .await
            .map_err(io_error)?;
        tokio::fs::rename(&temporary, &path)
            .await
            .map_err(io_error)?;
    }
    Ok(path)
}
async fn run_child(state: &HardwareState, privileged: bool, stop: CancellationToken) -> Result<()> {
    let executable = helper(&state.root).await?;
    let protected = executable.clone();
    let _guard = tauri::async_runtime::spawn_blocking(move || {
        let mut options = std::fs::OpenOptions::new();
        options.read(true);
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            options.share_mode(1);
        }
        options.open(protected).map_err(io_error)
    })
    .await
    .map_err(|_| error("硬件助手保护任务失败"))??;
    let mut command = Command::new(&executable);
    command
        .env("ZHENJING_HUD_DIR", state.root.join("hud"))
        .arg(std::process::id().to_string())
        .arg(if privileged { "sensors" } else { "safe" })
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    for name in [
        "TEMP",
        "TMP",
        "APPDATA",
        "LOCALAPPDATA",
        "USERPROFILE",
        "DOTNET_BUNDLE_EXTRACT_BASE_DIR",
    ] {
        let path = state.root.join("process").join(name);
        check_local_path(&path).await?;
        tokio::fs::create_dir_all(&path).await.map_err(io_error)?;
        command.env(name, path);
    }
    command
        .env("DOTNET_CLI_TELEMETRY_OPTOUT", "1")
        .current_dir(&state.root);
    #[cfg(windows)]
    command.creation_flags(0x0800_0000);
    let mut child = command.spawn().map_err(io_error)?;
    *state.hud_input.lock().await = child.stdin.take();
    state
        .hud_generation
        .fetch_add(1, std::sync::atomic::Ordering::Release);
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| error("无法读取硬件助手输出"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| error("无法读取硬件助手错误"))?;
    let error_reader = tokio::spawn(async move {
        let mut bytes = Vec::new();
        let _ = stderr.take(32768).read_to_end(&mut bytes).await;
        bytes
    });
    let mut reader = BufReader::new(stdout);
    let mut initialized = false;
    let result = loop {
        let mut line = String::new();
        let mut limited = (&mut reader).take(2_097_153);
        let duration = if initialized {
            Duration::from_secs(12)
        } else {
            Duration::from_secs(120)
        };
        let read = tokio::select! {
            _ = stop.cancelled() => break Ok(()),
            result = tokio::time::timeout(duration, limited.read_line(&mut line)) => result,
        };
        match read {
            Ok(Ok(0)) => break Err(error("硬件助手已关闭输出")),
            Ok(Ok(read)) if read <= 2_097_152 => {
                let message = serde_json::from_str::<Message>(line.trim())
                    .map_err(|_| error("硬件助手返回格式错误"));
                match message {
                    Ok(message) => {
                        if matches!(message, Message::Sample { .. }) {
                            initialized = true;
                        }
                        if let Err(cause) = state.accept(message).await {
                            break Err(cause);
                        }
                    }
                    Err(cause) => break Err(cause),
                }
            }
            Ok(Ok(_)) => break Err(error("硬件助手单帧超过上限")),
            Ok(Err(cause)) => break Err(io_error(cause)),
            Err(_) => break Err(error("硬件助手超时，已终止并将尝试恢复")),
        }
    };
    let _ = child.kill().await;
    *state.hud_input.lock().await = None;
    let _ = child.wait().await;
    let details = error_reader.await.unwrap_or_default();
    if !details.is_empty() {
        log::warn!("硬件助手: {}", String::from_utf8_lossy(&details));
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "实际 Windows 硬件只读验收；不安装驱动、不启动 ETW、不开放局域网端口"]
    fn live_read_only_pipeline() -> Result<()> {
        tauri::async_runtime::block_on(async {
            let root = crate::services::tools::test_root("hardware-live")?;
            let state = HardwareState::new(&root)?;
            state.start().await?;
            let started = std::time::Instant::now();
            loop {
                let snapshot = state.read().await;
                if snapshot.samples.len() >= 4 {
                    break;
                }
                if started.elapsed() > Duration::from_secs(100) {
                    state.shutdown().await?;
                    return Err(error(format!("真实采样未就绪：{:?}", snapshot.warnings)));
                }
                tokio::time::sleep(Duration::from_millis(300)).await;
            }
            let snapshot = state.read().await;
            assert!(!snapshot.devices.is_empty());
            assert!(!snapshot.sensors.is_empty());
            assert!(snapshot.metrics.get("cpu").is_some_and(Option::is_some));
            assert!(!snapshot.privileged);
            assert!(!snapshot.fps.enabled);
            let (points, count) = state
                .history
                .lock()
                .await
                .as_mut()
                .ok_or_else(|| error("历史未就绪"))?
                .points(None, None)
                .await?;
            let receipt = history::report(&state.root, &snapshot, points, count).await?;
            let output = serde_json::json!({"snapshot":snapshot,"report":receipt.path});
            let file = Path::new(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .ok_or_else(|| error("测试工作区不存在"))?
                .join(".cache/verification/hardware-live-result.json");
            crate::services::tools::save_json(&file, &output).await?;
            state.clear().await?;
            state.shutdown().await?;
            Ok(())
        })
    }
}
