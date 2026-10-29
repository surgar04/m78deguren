//! 原生透明准心窗口、显示器选择、用户预设与热键；状态和文件均由Rust统一维护。
use super::{Result, error, io_error, platform};
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};
use tauri::Manager;
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    sync::Mutex,
};
use tokio_util::sync::CancellationToken;

pub const SCREEN_PATTERNS: [&str; 12] = [
    "pixels",
    "gradient",
    "response",
    "refresh",
    "uniformity",
    "tearing",
    "subpixel",
    "black",
    "gray",
    "text",
    "geometry",
    "viewing",
];
/// 多窗口复用同一 WebView 环境，避免每个工具启动独立浏览器进程与缓存。
/// 原生命令权限仍按窗口标签隔离，不因共享浏览器配置而扩大。
fn webview_profile(root: &Path) -> Result<PathBuf> {
    root.parent()
        .map(|parent| parent.join("webview"))
        .ok_or_else(|| error("应用WebView目录无效"))
}
pub(super) fn browser_arguments(app: &tauri::AppHandle) -> &str {
    app.config()
        .app
        .windows
        .first()
        .and_then(|window| window.additional_browser_args.as_deref())
        .unwrap_or_default()
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScreenConfig {
    pub pattern: String,
    pub monitor: usize,
    pub color: String,
    pub speed: f64,
}
impl Default for ScreenConfig {
    fn default() -> Self {
        Self {
            pattern: "pixels".into(),
            monitor: 0,
            color: "#ffffff".into(),
            speed: 1.0,
        }
    }
}
impl ScreenConfig {
    pub fn validate(&self) -> Result<()> {
        if !SCREEN_PATTERNS.contains(&self.pattern.as_str())
            || self.monitor > 63
            || !self.speed.is_finite()
            || !(0.1..=5.0).contains(&self.speed)
            || !self
                .color
                .strip_prefix('#')
                .is_some_and(|s| s.len() == 6 && s.bytes().all(|c| c.is_ascii_hexdigit()))
        {
            return Err(error("屏幕测试参数无效"));
        }
        Ok(())
    }
}
pub fn open_screen(app: &tauri::AppHandle, root: &Path, config: &ScreenConfig) -> Result<()> {
    config.validate()?;
    let monitors = app
        .available_monitors()
        .map_err(|_| error("无法枚举显示器"))?;
    let monitor = monitors
        .get(config.monitor)
        .ok_or_else(|| error("所选显示器已断开"))?;
    let window = if let Some(window) = app.get_webview_window("screen-test") {
        window
    } else {
        tauri::WebviewWindowBuilder::new(
            app,
            "screen-test",
            tauri::WebviewUrl::App("index.html#/screen-test".into()),
        )
        .title("臻境屏幕测试")
        .decorations(false)
        .visible(false)
        .data_directory(webview_profile(root)?)
        .additional_browser_args(browser_arguments(app))
        .build()
        .map_err(|_| error("屏幕测试窗口创建失败"))?
    };
    window
        .set_fullscreen(false)
        .map_err(|_| error("无法调整测试窗口"))?;
    window
        .set_position(*monitor.position())
        .map_err(|_| error("测试窗口定位失败"))?;
    window
        .set_size(*monitor.size())
        .map_err(|_| error("测试窗口尺寸设置失败"))?;
    window
        .set_fullscreen(true)
        .map_err(|_| error("无法进入全屏测试"))?;
    window.show().map_err(|_| error("无法显示测试窗口"))?;
    window.set_focus().map_err(|_| error("无法聚焦测试窗口"))
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CrosshairConfig {
    pub shape: String,
    pub color: String,
    pub size: f64,
    pub thickness: f64,
    pub gap: f64,
    pub opacity: f64,
    pub outline: f64,
    #[serde(default = "default_outline_color")]
    pub outline_color: String,
    pub center_dot: bool,
    pub offset_x: i32,
    pub offset_y: i32,
    pub monitor: usize,
    pub image: Option<String>,
    pub shortcut: String,
    pub hold: bool,
    pub hold_key: String,
    pub hold_delay_ms: u64,
}
impl Default for CrosshairConfig {
    fn default() -> Self {
        Self {
            shape: "cross".into(),
            color: "#20e6bd".into(),
            size: 24.0,
            thickness: 2.0,
            gap: 5.0,
            opacity: 1.0,
            outline: 1.0,
            outline_color: default_outline_color(),
            center_dot: false,
            offset_x: 0,
            offset_y: 0,
            monitor: 0,
            image: None,
            shortcut: "Ctrl+Alt+C".into(),
            hold: false,
            hold_key: "right".into(),
            hold_delay_ms: 0,
        }
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Preset {
    pub id: String,
    pub name: String,
    pub config: CrosshairConfig,
}
#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CrosshairSnapshot {
    pub config: CrosshairConfig,
    pub presets: Vec<Preset>,
    #[serde(skip_deserializing)]
    pub enabled: bool,
    #[serde(skip_deserializing)]
    pub message: String,
}
pub struct CrosshairState {
    pub snapshot: CrosshairSnapshot,
    pub path: PathBuf,
    pub hold_worker: Option<CancellationToken>,
}
impl CrosshairState {
    pub fn load(root: &Path) -> Result<Self> {
        let path = root.join("crosshair.json");
        super::ensure_local_path(&path)?;
        let snapshot = if path.exists() {
            let bytes = std::fs::read(&path).map_err(io_error)?;
            if bytes.len() > 67_108_864 {
                return Err(error("准心预设文件过大"));
            }
            serde_json::from_slice::<CrosshairSnapshot>(&bytes)
                .map_err(|_| error("准心预设损坏，已保留原文件"))?
        } else {
            CrosshairSnapshot::default()
        };
        validate(&snapshot.config)?;
        if snapshot.presets.len() > 30 {
            return Err(error("最多保留30个准心预设"));
        }
        for preset in &snapshot.presets {
            validate(&preset.config)?;
        }
        Ok(Self {
            snapshot,
            path,
            hold_worker: None,
        })
    }
}
fn default_outline_color() -> String {
    "#10232c".into()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn config_bounds_and_restart_do_not_enable_overlay() -> Result<()> {
        let mut config = CrosshairConfig::default();
        validate(&config)?;
        config.size = f64::NAN;
        assert!(validate(&config).is_err());
        config.size = 24.0;
        config.offset_x = i32::MIN;
        assert!(validate(&config).is_err());
        config.offset_x = 0;
        config.shape = "image".into();
        config.image = Some("data:image/png;base64,AAAA".into());
        assert!(validate(&config).is_err());
        let value = serde_json::json!({ "config": CrosshairConfig::default(), "presets": [], "enabled":true,"message":"old" });
        let snapshot: CrosshairSnapshot =
            serde_json::from_value(value).map_err(|_| error("配置测试反序列化失败"))?;
        assert!(!snapshot.enabled);
        assert!(snapshot.message.is_empty());
        for pattern in SCREEN_PATTERNS {
            ScreenConfig {
                pattern: pattern.into(),
                ..ScreenConfig::default()
            }
            .validate()?;
        }
        Ok(())
    }
}
pub fn validate(value: &CrosshairConfig) -> Result<()> {
    let color = value
        .color
        .strip_prefix('#')
        .is_some_and(|s| s.len() == 6 && s.bytes().all(|c| c.is_ascii_hexdigit()));
    let outline_color = value
        .outline_color
        .strip_prefix('#')
        .is_some_and(|s| s.len() == 6 && s.bytes().all(|c| c.is_ascii_hexdigit()));
    if !color
        || !outline_color
        || !matches!(
            value.shape.as_str(),
            "cross" | "dot" | "circle" | "cross-dot" | "cross-circle" | "dot-box" | "image"
        )
        || !value.size.is_finite()
        || !(4.0..=200.0).contains(&value.size)
        || !value.thickness.is_finite()
        || !(1.0..=20.0).contains(&value.thickness)
        || !value.gap.is_finite()
        || !(0.0..=100.0).contains(&value.gap)
        || !value.opacity.is_finite()
        || !(0.05..=1.0).contains(&value.opacity)
        || !value.outline.is_finite()
        || !(0.0..=8.0).contains(&value.outline)
        || value.offset_x.unsigned_abs() > 4096
        || value.offset_y.unsigned_abs() > 4096
        || value.monitor > 63
        || value.shortcut.len() > 64
        || !matches!(
            value.hold_key.as_str(),
            "left" | "right" | "middle" | "x1" | "x2" | "shift" | "control" | "alt"
        )
        || value.hold_delay_ms > 2000
    {
        return Err(error("准心配置超出允许范围"));
    }
    if let Some(image) = &value.image {
        let payload = [
            "data:image/png;base64,",
            "data:image/jpeg;base64,",
            "data:image/webp;base64,",
        ]
        .iter()
        .find_map(|prefix| image.strip_prefix(prefix))
        .ok_or_else(|| error("准心图片只支持PNG/JPEG/WebP"))?;
        if payload.len() > 1_398_104 {
            return Err(error("准心图片不能超过1MB"));
        }
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(payload)
            .map_err(|_| error("准心图片编码无效"))?;
        let reader = image::ImageReader::new(std::io::Cursor::new(&bytes))
            .with_guessed_format()
            .map_err(|_| error("准心图片无效"))?;
        let (width, height) = reader
            .into_dimensions()
            .map_err(|_| error("准心图片无法读取"))?;
        if width == 0 || height == 0 || u64::from(width) * u64::from(height) > 4_194_304 {
            return Err(error("准心图片像素不能超过419万"));
        }
        image::load_from_memory(&bytes).map_err(|_| error("准心图片解码失败"))?;
    } else if value.shape == "image" {
        return Err(error("请先选择自定义准心图片"));
    }
    Ok(())
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Display {
    pub index: usize,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub x: i32,
    pub y: i32,
    pub scale: f64,
}
pub fn displays(app: &tauri::AppHandle) -> Result<Vec<Display>> {
    app.available_monitors()
        .map_err(|_| error("无法枚举显示器"))
        .map(|items| {
            items
                .iter()
                .enumerate()
                .map(|(index, monitor)| Display {
                    index,
                    name: monitor
                        .name()
                        .cloned()
                        .unwrap_or_else(|| format!("显示器 {}", index + 1)),
                    width: monitor.size().width,
                    height: monitor.size().height,
                    x: monitor.position().x,
                    y: monitor.position().y,
                    scale: monitor.scale_factor(),
                })
                .collect()
        })
}
pub fn apply_window(
    app: &tauri::AppHandle,
    root: &Path,
    config: &CrosshairConfig,
    visible: bool,
) -> Result<()> {
    let monitors = app
        .available_monitors()
        .map_err(|_| error("无法读取显示器"))?;
    let monitor = monitors
        .get(config.monitor)
        .ok_or_else(|| error("所选显示器已断开，请重新选择"))?;
    let created = app.get_webview_window("crosshair-overlay").is_none();
    let window = if let Some(window) = app.get_webview_window("crosshair-overlay") {
        window
    } else {
        tauri::WebviewWindowBuilder::new(
            app,
            "crosshair-overlay",
            tauri::WebviewUrl::App("index.html#/tool-overlay".into()),
        )
        .title("臻境辅助准心")
        .background_color(tauri::window::Color(0, 0, 0, 0))
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focusable(false)
        .visible(false)
        .resizable(false)
        .data_directory(webview_profile(root)?)
        .additional_browser_args(browser_arguments(app))
        .inner_size(480.0, 480.0)
        .build()
        .map_err(|_| error("无法创建准心覆盖层"))?
    };
    let scale = monitor.scale_factor();
    let width = (480.0 * scale) as i32;
    let position = tauri::PhysicalPosition::new(
        monitor.position().x
            + (monitor.size().width as i32 - width) / 2
            + (f64::from(config.offset_x) * scale) as i32,
        monitor.position().y
            + (monitor.size().height as i32 - width) / 2
            + (f64::from(config.offset_y) * scale) as i32,
    );
    window
        .set_position(position)
        .map_err(|_| error("准心窗口定位失败"))?;
    window
        .set_ignore_cursor_events(true)
        .map_err(|_| error("无法设置准心鼠标穿透"))?;
    if visible && !created {
        window.show()
    } else {
        window.hide()
    }
    .map_err(|_| error("准心显示状态修改失败"))
}
pub async fn update(
    app: tauri::AppHandle,
    root: PathBuf,
    state: Arc<Mutex<CrosshairState>>,
    config: CrosshairConfig,
    enabled: bool,
) -> Result<CrosshairSnapshot> {
    // 图片解码放阻塞池，不让异步执行器承担CPU密集操作。
    let candidate = config.clone();
    tauri::async_runtime::spawn_blocking(move || validate(&candidate))
        .await
        .map_err(|_| error("准心验证任务失败"))??;
    let mut current = state.lock().await;
    // 全局快捷键由设置服务统一管理；此处只改变准心，避免多个模块争抢同一按键。
    let mut candidate = current.snapshot.clone();
    candidate.config = config.clone();
    candidate.enabled = enabled;
    candidate.message.clear();
    let applied = apply_window(&app, &root, &config, enabled && !config.hold);
    let result = match applied {
        Ok(()) => super::save_json(&current.path, &candidate).await,
        Err(cause) => Err(cause),
    };
    if let Err(cause) = result {
        let _ = apply_window(
            &app,
            &root,
            &current.snapshot.config,
            current.snapshot.enabled && !current.snapshot.config.hold,
        );
        return Err(cause);
    }
    if let Some(worker) = current.hold_worker.take() {
        worker.cancel();
    }
    current.snapshot = candidate;
    if config.hold {
        let cancellation = CancellationToken::new();
        current.hold_worker = Some(cancellation.clone());
        let state = state.clone();
        let app = app.clone();
        let root = root.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(cause) = hold_worker(&app, &root, &state, &config, &cancellation).await
                && !cancellation.is_cancelled()
            {
                let mut state = state.lock().await;
                state.snapshot.enabled = false;
                state.snapshot.message = cause.to_string();
                let _ = apply_window(&app, &root, &state.snapshot.config, false);
            }
        });
    }
    Ok(current.snapshot.clone())
}
async fn hold_worker(
    app: &tauri::AppHandle,
    root: &Path,
    state: &Arc<Mutex<CrosshairState>>,
    config: &CrosshairConfig,
    cancel: &CancellationToken,
) -> Result<()> {
    // 复用固定脚本的准备过程，不把按键参数拼成C#或PowerShell源代码。
    platform::run(root, "admin", &[], Duration::from_secs(15)).await?;
    let script = platform::script_path(root);
    let key = match config.hold_key.as_str() {
        "left" => 1,
        "right" => 2,
        "middle" => 4,
        "x1" => 5,
        "x2" => 6,
        "shift" => 16,
        "control" => 17,
        _ => 18,
    };
    let args = serde_json::to_string(&[
        key.to_string(),
        config.hold_delay_ms.to_string(),
        std::process::id().to_string(),
    ])
    .map_err(|_| error("按键配置无效"))?;
    let mut command = tokio::process::Command::new(super::platform::powershell_executable()?);
    platform::configure_modules(&mut command)?;
    command
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
        ])
        .arg(script)
        .args(["-Operation", "hold", "-ArgumentJson"])
        .arg(args)
        .kill_on_drop(true)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null());
    for key in ["TEMP", "TMP", "APPDATA", "LOCALAPPDATA", "USERPROFILE"] {
        command.env(key, root.join("process").join(key));
    }
    #[cfg(windows)]
    {
        command.creation_flags(0x0800_0000);
    }
    let mut process = command.spawn().map_err(|_| error("按住检测服务无法启动"))?;
    let stdout = process
        .stdout
        .take()
        .ok_or_else(|| error("按键检测输出不可用"))?;
    let mut lines = BufReader::new(stdout).lines();
    loop {
        tokio::select! {
            _=cancel.cancelled()=>{let _=process.kill().await;return Ok(());},
            line=lines.next_line()=>{let line=line.map_err(io_error)?.ok_or_else(||error("按住检测服务已退出"))?;if matches!(line.as_str(),"0"|"1"){let snapshot=state.lock().await.snapshot.clone();if snapshot.enabled {apply_window(app,root,&snapshot.config,line=="1")?;}}}
        }
    }
}
