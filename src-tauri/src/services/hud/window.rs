//! 小尺寸、透明、非激活窗口；所有坐标按目标显示器工作区与 DPI 计算并夹紧。
use super::config::Config;
use crate::services::tools::{Result, error};
use serde_json::{Value, json};
use tauri::Manager;

pub fn dimensions(config: &Config, game: bool) -> (f64, f64) {
    (
        (if game { 720.0 } else { 580.0 }) * config.scale,
        180.0 * config.scale * config.font_scale,
    )
}
pub fn displays(app: &tauri::AppHandle) -> Result<Value> {
    let monitors = app
        .available_monitors()
        .map_err(|_| error("无法读取显示器"))?;
    Ok(Value::Array(monitors.iter().enumerate().map(|(index,m)|json!({"id":index,"name":m.name(),"width":m.size().width,"height":m.size().height,"scale":m.scale_factor()})).collect()))
}
pub fn update(app: &tauri::AppHandle, config: &Config, game: bool) -> Result<tauri::WebviewWindow> {
    let window = if let Some(window) = app.get_webview_window("hud") {
        window
    } else {
        // 与主窗口复用同一 WebView2 环境：避免再启动一套浏览器/GPU 进程，
        // 同时让字体、语言等本地偏好能通过 storage 事件在两个窗口同步。
        let webview_directory = app
            .state::<crate::services::settings::SettingsState>()
            .root
            .join("webview");
        let mut builder = tauri::WebviewWindowBuilder::new(
            app,
            "hud",
            tauri::WebviewUrl::App("index.html#/hud".into()),
        )
        .title("臻境 · HUD")
        .data_directory(webview_directory)
        .inner_size(580.0, 180.0)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .focusable(false)
        .visible(false);
        if let Some(args) = app
            .config()
            .app
            .windows
            .first()
            .and_then(|w| w.additional_browser_args.as_ref())
        {
            builder = builder.additional_browser_args(args);
        }
        let window = builder
            .build()
            .map_err(|_| error("统一 HUD 窗口创建失败"))?;
        interactions(app.clone());
        window
    };
    window
        .set_always_on_top(config.layer == "topmost")
        .map_err(|_| error("HUD 置顶设置失败"))?;
    window
        .set_always_on_bottom(false)
        .map_err(|_| error("HUD 桌面层设置失败"))?;
    let monitors = app
        .available_monitors()
        .map_err(|_| error("显示器读取失败"))?;
    let monitor = monitors
        .get(config.monitor)
        .or_else(|| monitors.first())
        .ok_or_else(|| error("没有可用显示器"))?;
    let area = monitor.work_area();
    let dpi = monitor.scale_factor();
    let (w, h) = dimensions(config, game);
    let w = (w * dpi).min(f64::from(area.size.width));
    let h = (h * dpi).min(f64::from(area.size.height));
    window
        .set_size(tauri::PhysicalSize::new(w.round() as u32, h.round() as u32))
        .map_err(|_| error("HUD 尺寸设置失败"))?;
    let room_x = (f64::from(area.size.width) - w).max(0.0);
    let room_y = (f64::from(area.size.height) - h).max(0.0);
    let x = if config.position.ends_with("left") {
        0.0
    } else if config.position.ends_with("right") {
        room_x
    } else {
        room_x / 2.0
    };
    let y = if config.position.starts_with("top") {
        0.0
    } else if config.position.starts_with("bottom") {
        room_y
    } else {
        room_y / 2.0
    };
    let (x, y) = if config.position == "custom" {
        (config.x * dpi, config.y * dpi)
    } else {
        (x + config.x * dpi, y + config.y * dpi)
    };
    window
        .set_position(tauri::PhysicalPosition::new(
            area.position.x + x.clamp(0.0, room_x).round() as i32,
            area.position.y + y.clamp(0.0, room_y).round() as i32,
        ))
        .map_err(|_| error("HUD 定位失败"))?;
    Ok(window)
}
/// 鼠标命中测试与 1Hz 采样解耦。只在 HUD 存在时运行，且仅在穿透状态变化时更新窗口。
fn interactions(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut previous = None;
        let mut entered = false;
        while let Some(window) = app.get_webview_window("hud") {
            let state = app.state::<super::HudState>();
            let (locked, scale, font_scale, hotzone, always_show, seconds) = {
                let config = state.config.lock().await;
                (
                    config.locked,
                    config.scale,
                    config.font_scale,
                    config.hotzone,
                    config.always_show,
                    config.display_seconds,
                )
            };
            if let (Ok(cursor), Ok(position), Ok(size), Ok(dpi)) = (
                window.cursor_position(),
                window.outer_position(),
                window.outer_size(),
                window.scale_factor(),
            ) {
                let game = state.snapshot.read().await["game"]
                    .as_bool()
                    .unwrap_or(false);
                let height = (if game { 100.0 } else { 60.0 }) * scale * font_scale * dpi;
                let inside = cursor.x >= f64::from(position.x) + 10.0 * scale * dpi
                    && cursor.x
                        <= f64::from(position.x) + f64::from(size.width) - 10.0 * scale * dpi
                    && (cursor.y - f64::from(position.y) - f64::from(size.height) / 2.0).abs()
                        <= height / 2.0;
                let ignore = locked || !inside;
                if previous != Some(ignore) {
                    let _ = window.set_ignore_cursor_events(ignore);
                    previous = Some(ignore);
                }
                if !always_show {
                    let at_hotzone = hotzone
                        && window.current_monitor().ok().flatten().is_some_and(|m| {
                            let area = m.work_area();
                            let middle =
                                f64::from(area.position.x) + f64::from(area.size.width) / 2.0;
                            (cursor.x - middle).abs() < 100.0 * dpi
                                && (cursor.y - f64::from(area.position.y)).abs() < 8.0 * dpi
                        });
                    let hovering = inside && window.is_visible().unwrap_or(false);
                    if at_hotzone || hovering {
                        state.peek_until.store(
                            chrono::Utc::now().timestamp_millis() + i64::from(seconds) * 1000,
                            std::sync::atomic::Ordering::Relaxed,
                        );
                        if !entered {
                            state.wake.notify_one();
                        }
                        entered = true;
                    } else {
                        entered = false;
                    }
                }
            }
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
    });
}
pub async fn remember(app: &tauri::AppHandle) -> Result<()> {
    let state = app.state::<super::HudState>();
    let _guard = state.serial.lock().await;
    let window = app
        .get_webview_window("hud")
        .ok_or_else(|| error("HUD 未开启"))?;
    let monitor = window
        .current_monitor()
        .map_err(|_| error("HUD 显示器读取失败"))?
        .ok_or_else(|| error("HUD 不在有效显示器内"))?;
    let position = window
        .outer_position()
        .map_err(|_| error("HUD 位置读取失败"))?;
    let mut config = state.config.lock().await.clone();
    let monitors = app
        .available_monitors()
        .map_err(|_| error("显示器读取失败"))?;
    config.monitor = monitors
        .iter()
        .position(|m| m.position() == monitor.position())
        .unwrap_or(0);
    config.position = "custom".into();
    config.x = f64::from(position.x - monitor.work_area().position.x) / monitor.scale_factor();
    config.y = f64::from(position.y - monitor.work_area().position.y) / monitor.scale_factor();
    config.validate()?;
    crate::services::tools::save_json(&state.root.join("config.json"), &config).await?;
    *state.config.lock().await = config;
    state.wake.notify_one();
    Ok(())
}
