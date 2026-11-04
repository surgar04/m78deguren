//! 游戏中间页的单实例编排。页面焦点只在会话变化时提升，常驻检测不能反复抢占输入。
pub mod community;
pub mod wegame;
use crate::services::{
    hardware::Hardware,
    tools::{Result, error, io_error},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    path::{Path, PathBuf},
    time::Duration,
};
use tauri::{Emitter, Manager};
use tokio::sync::Mutex;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Preferences {
    pub auto_open: bool,
    pub always_on_top: bool,
    pub block_sticky_keys: bool,
}
impl Default for Preferences {
    fn default() -> Self {
        Self {
            auto_open: true,
            always_on_top: true,
            block_sticky_keys: true,
        }
    }
}
#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub game_id: String,
    pub name: String,
    pub pid: u32,
    pub started_at: i64,
    pub ended_at: Option<i64>,
    pub running: bool,
    pub message: String,
}
/// 进程信息只来自已有原生识别助手；路径用于识别，不返回页面或写入诊断。
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Detected {
    pub pid: u32,
    pub created: String,
    pub name: String,
    pub path: String,
}
pub struct GameRoomState {
    pub root: PathBuf,
    pub http: reqwest::Client,
    pub preferences: Mutex<Preferences>,
    pub session: Mutex<Session>,
    serial: Mutex<()>,
    frame_lease: Mutex<Option<u64>>,
    frame_retry_at: std::sync::atomic::AtomicI64,
    pub wegame: wegame::WeGame,
    pub remote_serial: Mutex<()>,
    pub asset_slots: tokio::sync::Semaphore,
    pub asset_cache: Mutex<std::collections::VecDeque<(String, Value)>>,
}
impl GameRoomState {
    pub fn new(root: &Path) -> Result<Self> {
        let root = root.join("game-room");
        crate::services::tools::ensure_local_path(&root)?;
        std::fs::create_dir_all(&root).map_err(io_error)?;
        let preferences = match std::fs::read(root.join("preferences.json")) {
            Ok(bytes) if bytes.len() <= 8192 => serde_json::from_slice(&bytes)
                .map_err(|_| error("游戏中间页设置损坏，请检查数据目录"))?,
            Ok(_) => return Err(error("游戏中间页设置超过限制")),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Preferences::default(),
            Err(e) => return Err(io_error(e)),
        };
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(22))
            .connect_timeout(Duration::from_secs(8))
            .redirect(reqwest::redirect::Policy::none())
            .user_agent(concat!("Zhenjing/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|_| error("游戏服务网络初始化失败"))?;
        Ok(Self {
            wegame: wegame::WeGame::new(root.clone()),
            root,
            http,
            preferences: Mutex::new(preferences),
            session: Mutex::new(Session::default()),
            serial: Mutex::new(()),
            frame_lease: Mutex::new(None),
            frame_retry_at: std::sync::atomic::AtomicI64::new(0),
            remote_serial: Mutex::new(()),
            asset_slots: tokio::sync::Semaphore::new(3),
            asset_cache: Mutex::new(std::collections::VecDeque::new()),
        })
    }
    pub async fn snapshot(&self) -> Result<Value> {
        Ok(
            json!({"session":self.session.lock().await.clone(),"preferences":self.preferences.lock().await.clone(),"account":self.wegame.account().await,"protectionMessage":""}),
        )
    }
    pub async fn configure(
        &self,
        app: &tauri::AppHandle,
        preferences: Preferences,
    ) -> Result<Value> {
        let serial = self.serial.lock().await;
        let previous = self.preferences.lock().await.clone();
        crate::services::tools::save_json(&self.root.join("preferences.json"), &preferences)
            .await?;
        *self.preferences.lock().await = preferences.clone();
        if let Some(window) = app.get_webview_window("game-room")
            && window.set_always_on_top(preferences.always_on_top).is_err()
        {
            *self.preferences.lock().await = previous.clone();
            crate::services::tools::save_json(&self.root.join("preferences.json"), &previous)
                .await?;
            return Err(error("游戏窗口置顶设置失败，已恢复原设置"));
        }
        if let Err(cause) = app
            .state::<crate::services::home::HomeState>()
            .configure_quick_launch(app)
            .await
        {
            *self.preferences.lock().await = previous.clone();
            crate::services::tools::save_json(&self.root.join("preferences.json"), &previous)
                .await?;
            if let Some(window) = app.get_webview_window("game-room") {
                let _ = window.set_always_on_top(previous.always_on_top);
            }
            return Err(cause);
        }
        drop(serial);
        self.snapshot().await
    }
    pub async fn show(&self, app: &tauri::AppHandle) -> Result<()> {
        if let Some(window) = app.get_webview_window("game-room") {
            window.show().map_err(|_| error("游戏中间页显示失败"))?;
            window
                .unminimize()
                .map_err(|_| error("游戏中间页恢复失败"))?;
            window
                .set_focus()
                .map_err(|_| error("游戏中间页焦点设置失败"))?;
            return Ok(());
        }
        let prefs = self.preferences.lock().await.clone();
        let directory = app
            .state::<crate::services::settings::SettingsState>()
            .root
            .join("webview");
        crate::services::tools::check_local_path(&directory).await?;
        tokio::fs::create_dir_all(&directory)
            .await
            .map_err(io_error)?;
        let mut builder = tauri::WebviewWindowBuilder::new(
            app,
            "game-room",
            tauri::WebviewUrl::App("index.html#/delta-force".into()),
        )
        .title("臻境 · 游戏空间")
        .inner_size(1160.0, 800.0)
        .min_inner_size(720.0, 540.0)
        .center()
        .decorations(false)
        .always_on_top(prefs.always_on_top)
        .initialization_script(crate::services::diagnostics::BOOTSTRAP_SCRIPT)
        .data_directory(directory);
        // 共用数据档案时 WebView2 启动参数也必须一致，否则原生环境会拒绝创建窗口。
        if let Some(args) = app
            .config()
            .app
            .windows
            .first()
            .and_then(|window| window.additional_browser_args.as_ref())
        {
            builder = builder.additional_browser_args(args);
        }
        if let Some(monitor) = app
            .primary_monitor()
            .map_err(|_| error("显示器信息读取失败"))?
        {
            let area = monitor
                .work_area()
                .size
                .to_logical::<f64>(monitor.scale_factor());
            // 高 DPI 或小屏幕也不能让最小窗口尺寸突破工作区边界。
            let width = (area.width - 24.0).clamp(320.0, 1160.0);
            let height = (area.height - 40.0).clamp(300.0, 800.0);
            builder = builder
                .inner_size(width, height)
                .min_inner_size(width.min(480.0), height.min(400.0));
        }
        let window = builder
            .build()
            .map_err(|_| error("无法创建游戏中间页，请检查 WebView2"))?;
        let app = app.clone();
        window.on_window_event(move |event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    let state = app.state::<GameRoomState>();
                    let _ = state.release_capture(&app).await;
                    tokio::time::sleep(Duration::from_secs(11)).await;
                    let _ = app.state::<Hardware>().pause_if_idle().await;
                    log::info!("游戏中间页采样租约已释放");
                });
            }
        });
        log::info!("游戏中间页窗口已创建");
        Ok(())
    }
    /// 在提交游戏启动请求之前先展示页面；实际 PID 只能由后续进程检测确认。
    pub async fn preparing(&self, app: &tauri::AppHandle, name: &str, path: &str) -> Result<()> {
        if !self.preferences.lock().await.auto_open {
            return Ok(());
        }
        let _serial = self.serial.lock().await;
        let mut session = self.session.lock().await;
        if session.running {
            return Ok(());
        }
        *session = Session {
            id: uuid::Uuid::new_v4().to_string(),
            game_id: game_id(name, path).into(),
            name: name.chars().take(100).collect(),
            started_at: chrono::Utc::now().timestamp_millis(),
            message: "正在等待游戏进程…".into(),
            ..Session::default()
        };
        drop(session);
        self.frame_retry_at
            .store(0, std::sync::atomic::Ordering::Relaxed);
        self.show(app).await
    }
    pub async fn observe(&self, app: &tauri::AppHandle, detected: Option<Detected>) -> Result<()> {
        let _serial = self.serial.lock().await;
        let mut session = self.session.lock().await;
        let Some(row) = detected else {
            if session.running {
                session.running = false;
                session.ended_at = Some(chrono::Utc::now().timestamp_millis());
                session.message = "游戏已退出，保留本次页面供查看".into();
            } else if session.pid == 0
                && session.started_at > 0
                && chrono::Utc::now().timestamp_millis() - session.started_at > 120000
            {
                session.message = "未检测到游戏进程，请检查官方启动器或反作弊提示".into();
            }
            drop(session);
            if let Some(owned) = self.frame_lease.lock().await.take() {
                let hardware = app.state::<Hardware>();
                if hardware.frames.generation() == owned {
                    let frames = hardware.frames.clone();
                    tauri::async_runtime::spawn_blocking(move || frames.stop_if_generation(owned))
                        .await
                        .map_err(|_| error("游戏帧采样释放失败"))??;
                }
            }
            return Ok(());
        };
        if row.pid == 0
            || row.created.len() > 40
            || !crate::services::home::types::exe_path_valid(&row.path)
            || row.name.len() > 260
        {
            return Err(error("游戏识别消息无效"));
        }
        let identity = format!("{}:{}", row.pid, row.created);
        if session.id == identity {
            return Ok(());
        }
        *session = Session {
            id: identity,
            game_id: game_id(&row.name, &row.path).into(),
            name: if game_id(&row.name, &row.path) == "delta-force" {
                "三角洲行动".into()
            } else {
                row.name
            },
            pid: row.pid,
            started_at: row
                .created
                .parse::<i64>()
                .ok()
                .and_then(|ticks| ticks.checked_sub(116444736000000000))
                .map(|ticks| ticks / 10000)
                .filter(|millis| *millis > 0 && *millis <= chrono::Utc::now().timestamp_millis())
                .unwrap_or_else(|| chrono::Utc::now().timestamp_millis()),
            ended_at: None,
            running: true,
            message: String::new(),
        };
        drop(session);
        self.frame_retry_at
            .store(0, std::sync::atomic::Ordering::Relaxed);
        if self.preferences.lock().await.auto_open {
            self.show(app).await?;
        }
        let _ = app.emit_to("game-room", "game-room-session", ());
        log::info!("游戏中间页会话已开始");
        Ok(())
    }
    /// 复用共享采样，只启动尚未运行的 ETW 会话；不能停止硬件页/HUD 后来接管的采样。
    pub async fn telemetry(&self, app: &tauri::AppHandle) -> Result<Value> {
        let hardware = app.state::<Hardware>();
        hardware.ui_seen.store(
            chrono::Utc::now().timestamp_millis(),
            std::sync::atomic::Ordering::Relaxed,
        );
        hardware.start().await?;
        let mut lease = self.frame_lease.lock().await;
        let session = self.session.lock().await.clone();
        if lease.is_some_and(|owned| hardware.frames.generation() == owned)
            && hardware.frames.snapshot().process_id != session.pid
        {
            let frames = hardware.frames.clone();
            let owned = lease.take().ok_or_else(|| error("游戏帧采样租约已失效"))?;
            tauri::async_runtime::spawn_blocking(move || frames.stop_if_generation(owned))
                .await
                .map_err(|_| error("游戏帧采样切换失败"))??;
        }
        let now = chrono::Utc::now().timestamp_millis();
        if session.running
            && session.pid > 0
            && !hardware.frames.snapshot().enabled
            && now
                >= self
                    .frame_retry_at
                    .load(std::sync::atomic::Ordering::Relaxed)
        {
            self.frame_retry_at
                .store(now + 30000, std::sync::atomic::Ordering::Relaxed);
            let frames = hardware.frames.clone();
            let pid = session.pid;
            match tauri::async_runtime::spawn_blocking(move || frames.start_if_idle(pid)).await {
                Ok(Ok(Some(generation))) => {
                    *lease = Some(generation);
                    self.session.lock().await.message = String::new();
                }
                Ok(Ok(None)) => {}
                _ => {
                    self.session.lock().await.message =
                        "ETW 帧率监测不可用，可检查权限；其他传感器仍可使用".into();
                }
            }
        }
        // 游戏空间不需要原始传感器与全套设备资料，避免每秒复制/跨 IPC 发送数千条原始记录。
        let snapshot = hardware.snapshot.read().await;
        let fresh = snapshot.captured_at.is_some_and(|at| now - at < 5000);
        let mut gpus = snapshot.gpus.clone();
        if !fresh {
            for gpu in &mut gpus {
                gpu.metrics.values_mut().for_each(|value| *value = None);
            }
        }
        let metrics = if fresh {
            snapshot.metrics.clone()
        } else {
            Default::default()
        };
        let samples: Vec<_> = snapshot.samples.iter().rev().take(60).rev().collect();
        Ok(
            json!({"status":if !fresh&&snapshot.captured_at.is_some(){"stale"}else{&snapshot.status},"capturedAt":snapshot.captured_at,"metrics":metrics,"gpus":gpus,"samples":samples,"fps":hardware.frames.snapshot(),"warnings":snapshot.warnings}),
        )
    }
    async fn release_capture(&self, app: &tauri::AppHandle) -> Result<()> {
        if let Some(owned) = self.frame_lease.lock().await.take() {
            let hardware = app.state::<Hardware>();
            if hardware.frames.generation() == owned {
                let frames = hardware.frames.clone();
                tauri::async_runtime::spawn_blocking(move || frames.stop_if_generation(owned))
                    .await
                    .map_err(|_| error("游戏帧采样释放失败"))??;
            }
        }
        Ok(())
    }
}
pub fn game_id(name: &str, path: &str) -> &'static str {
    let path = path.to_ascii_lowercase();
    if path.ends_with("deltaforceclient-win64-shipping.exe")
        || path.ends_with("deltaforcelauncher.exe")
        || name.contains("三角洲")
    {
        "delta-force"
    } else {
        "game"
    }
}
