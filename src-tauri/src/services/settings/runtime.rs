//! 托盘、窗口关闭行为和原生偏好提交。资源切换失败时保留原配置，并尝试恢复旧注册。
use super::{
    SettingsState,
    config::{NativeConfig, Patch},
};
use crate::services::tools::{Result, ToolsState, error, save_json};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    Emitter, Manager,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

pub struct Critical<'a>(&'a AtomicBool);
impl<'a> Critical<'a> {
    pub fn acquire(state: &'a SettingsState) -> Result<Self> {
        state
            .critical
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map_err(|_| error("另一个关键任务正在执行，请稍后重试"))?;
        Ok(Self(&state.critical))
    }
}
impl Drop for Critical<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}
pub fn show_main(app: &tauri::AppHandle) -> Result<()> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| error("主窗口不存在"))?;
    window.show().map_err(|_| error("主窗口无法显示"))?;
    window.unminimize().map_err(|_| error("主窗口无法恢复"))?;
    window.set_focus().map_err(|_| error("主窗口无法聚焦"))
}
pub fn tray(app: &tauri::AppHandle) -> Result<()> {
    let show = MenuItem::with_id(app, "zhenjing-show", "打开臻境", true, None::<&str>)
        .map_err(|_| error("托盘菜单创建失败"))?;
    let quit = MenuItem::with_id(app, "zhenjing-quit", "退出臻境", true, None::<&str>)
        .map_err(|_| error("托盘菜单创建失败"))?;
    let menu = Menu::with_items(app, &[&show, &quit]).map_err(|_| error("托盘菜单创建失败"))?;
    let mut builder = TrayIconBuilder::with_id("zhenjing-main-tray")
        .menu(&menu)
        .tooltip("臻境 · 双击打开")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "zhenjing-show" => {
                let _ = show_main(app);
            }
            "zhenjing-quit" => {
                if app.state::<SettingsState>().critical.load(Ordering::SeqCst) {
                    let _ = show_main(app);
                    let _ = app.emit_to(
                        "main",
                        "settings-notice",
                        "关键任务正在执行，请等待完成后退出",
                    );
                } else {
                    app.exit(0);
                }
            }
            _ => {}
        })
        .on_tray_icon_event(|icon, event| {
            if matches!(
                event,
                TrayIconEvent::DoubleClick {
                    button: MouseButton::Left,
                    ..
                } | TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                let _ = show_main(icon.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app).map_err(|_| error("系统托盘创建失败"))?;
    Ok(())
}
pub async fn patch(app: &tauri::AppHandle, patch: Patch) -> Result<NativeConfig> {
    let state = app.state::<SettingsState>();
    let _guard = state.serial.lock().await;
    if state.critical.load(Ordering::SeqCst) {
        return Err(error("关键任务执行期间不能修改原生设置"));
    }
    let old = state.config.lock().await.clone();
    let next = patch.candidate(&old)?;
    if next.close_behavior == "tray" && app.tray_by_id("zhenjing-main-tray").is_none() {
        return Err(error("托盘尚不可用，不能隐藏关闭窗口"));
    }
    // 录制期间也先试注册候选键，系统冲突必须在保存前返回；回调仍由 capture 租约屏蔽。
    let keys_changed = old.hotkeys_enabled != next.hotkeys_enabled
        || old.media_keys != next.media_keys
        || old
            .bindings
            .iter()
            .zip(&next.bindings)
            .any(|(left, right)| {
                left.action != right.action
                    || left.enabled != right.enabled
                    || left.shortcut != right.shortcut
            });
    if keys_changed {
        state.hotkeys.replace(app, &next)?;
    }
    let resources = async {
        if next.media_keys
            || next.hotkeys_enabled
            || app
                .state::<crate::services::hud::HudState>()
                .config
                .lock()
                .await
                .enabled
        {
            state.media.ensure(&state.root.join("settings")).await?;
        } else {
            state.media.stop().await?;
        }
        if !next.hotkeys_enabled
            || !next
                .bindings
                .iter()
                .any(|binding| binding.action == "clicker" && binding.enabled)
        {
            let tools = app.state::<ToolsState>();
            let config = tools.clicker.snapshot.lock().await.config.clone();
            tools
                .clicker
                .configure(&tools.root, config, false, false)
                .await?;
        }
        save_json(&state.root.join("settings/config.json"), &next).await
    }
    .await;
    if let Err(cause) = resources {
        if keys_changed {
            let _ = state.hotkeys.replace(app, &old);
        }
        return Err(cause);
    }
    // 关闭总开关或连点热键时主动停止输入；错误路径也绝不自动恢复点击。
    state
        .close_to_tray
        .store(next.close_behavior == "tray", Ordering::SeqCst);
    *state.config.lock().await = next.clone();
    app.state::<crate::services::home::HomeState>()
        .refresh_game_worker(app)
        .await;
    let _ = app.emit("settings-native-changed", &next);
    if next.check_updates && (!old.check_updates || (next.auto_update && !old.auto_update)) {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let state = app.state::<SettingsState>();
            if let Ok(status) = state.update.check(&state.releases_http).await {
                let _ = app.emit("settings-update-changed", &status);
                let latest_preferences = state.config.lock().await.clone();
                if status.phase == "available"
                    && latest_preferences.check_updates
                    && latest_preferences.auto_update
                {
                    let _ = state
                        .update
                        .download(&app.state::<ToolsState>(), &state.releases_http)
                        .await;
                }
            }
        });
    }
    Ok(next)
}
pub fn boot(app: &tauri::AppHandle) -> Result<()> {
    let state = app.state::<SettingsState>();
    let config = state
        .config
        .try_lock()
        .map_err(|_| error("启动配置正在使用"))?
        .clone();
    state.hotkeys.boot(app, &config)?;
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let state = app.state::<SettingsState>();
        if (config.media_keys
            || config.hotkeys_enabled
            || app
                .state::<crate::services::hud::HudState>()
                .config
                .lock()
                .await
                .enabled)
            && let Err(cause) = state.media.ensure(&state.root.join("settings")).await
        {
            let _ = app.emit_to("main", "settings-notice", cause.to_string());
        }
        // 自动检查与自动下载独立。让首屏和传感器先完成启动，不阻塞窗口展示。
        tokio::time::sleep(std::time::Duration::from_secs(8)).await;
        loop {
            let preferences = state.config.lock().await.clone();
            let mut failed = false;
            if preferences.check_updates {
                match state.update.check(&state.releases_http).await {
                    Ok(status) => {
                        let _ = app.emit("settings-update-changed", &status);
                        let latest_preferences = state.config.lock().await.clone();
                        if status.phase == "available"
                            && latest_preferences.check_updates
                            && latest_preferences.auto_update
                        {
                            let _ = state
                                .update
                                .download(&app.state::<ToolsState>(), &state.releases_http)
                                .await;
                        }
                    }
                    Err(_) => {
                        failed = true;
                        let _ = app.emit("settings-update-changed", ());
                    }
                }
            }
            // 网络异常时适度重试；不会因单次离线而等满四小时，也不会连续弹出失败提醒。
            tokio::time::sleep(std::time::Duration::from_secs(if failed {
                15 * 60
            } else {
                4 * 3600
            }))
            .await;
        }
    });
    Ok(())
}
pub async fn ensure_quiet(app: &tauri::AppHandle) -> Result<()> {
    let tools = app.state::<ToolsState>();
    if tools.filters.snapshot.lock().await.enabled
        || tools.clicker.snapshot.lock().await.armed
        || tools.audio.snapshot().await?.running
    {
        return Err(error(
            "请先停止显示滤镜、音频引擎和连点器，再执行重置或程序替换",
        ));
    }
    if tools.downloads.list().await.iter().any(|task| {
        matches!(
            task.status.as_str(),
            "running"
                | "probing"
                | "pausing"
                | "cancelling"
                | "queued"
                | "downloading"
                | "verifying"
        )
    }) {
        return Err(error("请先暂停或完成下载，再执行重置或程序替换"));
    }
    Ok(())
}
