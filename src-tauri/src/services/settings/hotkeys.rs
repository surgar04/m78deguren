//! 全局热键唯一所有者：原子切换绑定、真实冲突反馈，以及编辑时限时释放键盘占用。
use super::{SettingsState, config::NativeConfig};
use crate::services::tools::{Result, ToolsState, error};
use serde::Serialize;
use std::{
    collections::HashSet,
    sync::{Mutex, atomic::Ordering},
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

#[derive(Clone, Serialize)]
pub struct Registration {
    pub action: String,
    pub shortcut: String,
    pub registered: bool,
    pub error: Option<String>,
}
#[derive(Default)]
pub struct Registry {
    rows: Mutex<Vec<Registration>>,
}
fn desired(config: &NativeConfig) -> Result<Vec<Registration>> {
    let mut result = Vec::new();
    if config.hotkeys_enabled {
        for row in config.bindings.iter().filter(|row| row.enabled) {
            result.push(Registration {
                action: row.action.clone(),
                shortcut: row.shortcut.clone(),
                registered: false,
                error: None,
            });
        }
        if config.media_keys {
            for (action, shortcut) in [
                ("media-previous", "MediaTrackPrevious"),
                ("media-next", "MediaTrackNext"),
                ("media-play-pause", "MediaPlayPause"),
            ] {
                result.push(Registration {
                    action: action.into(),
                    shortcut: shortcut.into(),
                    registered: false,
                    error: None,
                });
            }
        }
    }
    let mut ids = HashSet::new();
    for row in &result {
        let shortcut = row
            .shortcut
            .parse::<Shortcut>()
            .map_err(|_| error("热键格式不受支持"))?;
        if !ids.insert(shortcut.id()) {
            return Err(error("快捷键与其他绑定或媒体键重复"));
        }
    }
    Ok(result)
}
fn register(app: &tauri::AppHandle, row: &mut Registration) -> Result<()> {
    let action = row.action.clone();
    app.global_shortcut()
        .on_shortcut(row.shortcut.as_str(), move |app, _, event| {
            if event.state != ShortcutState::Pressed {
                return;
            }
            let app = app.clone();
            let action = action.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(cause) = execute(&app, &action).await {
                    let _ = app.emit_to("main", "settings-notice", cause.to_string());
                }
            });
        })
        .map_err(|_| {
            error(format!(
                "{} 的快捷键 {} 已被占用或无效",
                row.action, row.shortcut
            ))
        })?;
    row.registered = true;
    row.error = None;
    Ok(())
}
impl Registry {
    pub fn snapshot(&self) -> Result<Vec<Registration>> {
        self.rows
            .lock()
            .map(|value| value.clone())
            .map_err(|_| error("热键状态锁异常"))
    }
    pub fn replace(&self, app: &tauri::AppHandle, config: &NativeConfig) -> Result<()> {
        let mut candidate = desired(config)?;
        let mut rows = self.rows.lock().map_err(|_| error("热键状态锁异常"))?;
        let previous = rows.clone();
        for index in 0..rows.len() {
            if !rows[index].registered {
                continue;
            }
            if app
                .global_shortcut()
                .unregister(rows[index].shortcut.as_str())
                .is_err()
            {
                rows[index].error = Some("旧热键释放失败，设置未保存".into());
                for row in rows.iter_mut().filter(|row| !row.registered) {
                    if previous.iter().any(|old| {
                        old.registered && old.action == row.action && old.shortcut == row.shortcut
                    }) && let Err(cause) = register(app, row)
                    {
                        row.error = Some(cause.to_string());
                    }
                }
                return Err(error("无法释放旧热键；已尝试恢复此前注册，详情见各项状态"));
            }
            rows[index].registered = false;
        }
        for index in 0..candidate.len() {
            // 启动时已经明确报告的未变更冲突不应阻塞其他设置；新增/修改的键仍必须试注册。
            if let Some(old) = previous.iter().find(|row| {
                !row.registered
                    && row.error.is_some()
                    && row.action == candidate[index].action
                    && row.shortcut == candidate[index].shortcut
            }) {
                candidate[index].error = old.error.clone();
                continue;
            }
            if let Err(cause) = register(app, &mut candidate[index]) {
                let mut retained = Vec::new();
                for row in candidate.iter_mut().filter(|row| row.registered) {
                    if app
                        .global_shortcut()
                        .unregister(row.shortcut.as_str())
                        .is_err()
                    {
                        row.error = Some("回滚时无法释放此热键，请退出重启".into());
                        retained.push(row.clone());
                    }
                }
                let mut restored = previous;
                for row in restored.iter_mut().filter(|row| row.registered) {
                    row.registered = false;
                    if let Err(problem) = register(app, row) {
                        row.error = Some(problem.to_string());
                    }
                }
                restored.extend(retained);
                *rows = restored;
                return Err(cause);
            }
        }
        *rows = candidate;
        Ok(())
    }
    pub fn boot(&self, app: &tauri::AppHandle, config: &NativeConfig) -> Result<()> {
        let mut candidate = desired(config)?;
        for row in &mut candidate {
            if let Err(cause) = register(app, row) {
                row.error = Some(cause.to_string());
            }
        }
        *self.rows.lock().map_err(|_| error("热键状态锁异常"))? = candidate;
        Ok(())
    }
    pub fn release(&self, app: &tauri::AppHandle) -> Result<()> {
        let mut rows = self.rows.lock().map_err(|_| error("热键状态锁异常"))?;
        for row in rows.iter_mut().filter(|row| row.registered) {
            app.global_shortcut()
                .unregister(row.shortcut.as_str())
                .map_err(|_| error("热键释放失败"))?;
            row.registered = false;
        }
        Ok(())
    }
}
pub async fn capture_start(app: &tauri::AppHandle) -> Result<String> {
    let state = app.state::<SettingsState>();
    let _guard = state.serial.lock().await;
    state.hotkeys.release(app)?;
    let token = uuid::Uuid::new_v4().to_string();
    *state.capture.lock().await = Some((token.clone(), Instant::now()));
    app.state::<crate::services::home::HomeState>()
        .refresh_game_worker(app)
        .await;
    let own_token = token.clone();
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(30)).await;
        if let Err(cause) = capture_end(&app, &own_token).await {
            let _ = app.emit_to("main", "settings-notice", cause.to_string());
        }
    });
    Ok(token)
}
pub async fn capture_end(app: &tauri::AppHandle, token: &str) -> Result<()> {
    uuid::Uuid::parse_str(token).map_err(|_| error("录制凭据无效"))?;
    let state = app.state::<SettingsState>();
    let _guard = state.serial.lock().await;
    let mut current = state.capture.lock().await;
    if current.as_ref().is_some_and(|(own, _)| own == token) {
        *current = None;
        state
            .hotkeys
            .replace(app, &state.config.lock().await.clone())?;
    }
    drop(current);
    app.state::<crate::services::home::HomeState>()
        .refresh_game_worker(app)
        .await;
    Ok(())
}
async fn execute(app: &tauri::AppHandle, action: &str) -> Result<()> {
    let state = app.state::<SettingsState>();
    // 首次准备及关键系统操作期间禁止热键触发输入工具或辅助窗口，避免干扰安装/分区确认。
    if state.critical.load(std::sync::atomic::Ordering::SeqCst)
        || !app
            .state::<crate::services::onboarding::OnboardingState>()
            .progress
            .lock()
            .await
            .complete
    {
        return Ok(());
    }
    let config = state.config.lock().await.clone();
    if !config.hotkeys_enabled || state.capture.lock().await.is_some() {
        return Ok(());
    }
    let action = if let Some(action) = action.strip_prefix("media-") {
        if !config.media_keys {
            return Ok(());
        }
        action
    } else {
        if !config
            .bindings
            .iter()
            .any(|binding| binding.action == action && binding.enabled)
        {
            return Ok(());
        }
        action
    };
    let tools = app.state::<ToolsState>();
    perform_action(app, &tools, action).await
}
/// 轮盘调用同一原生动作；仍受总热键开关、关键任务和每个工具的会话授权限制。
pub async fn execute_quick(app: &tauri::AppHandle, action: &str) -> Result<()> {
    let state = app.state::<SettingsState>();
    if !state.config.lock().await.hotkeys_enabled
        || state.capture.lock().await.is_some()
        || state.critical.load(Ordering::SeqCst)
    {
        return Err(error("总热键已关闭或正在执行关键任务"));
    }
    let action = action.strip_prefix("media-").unwrap_or(action);
    let tools = app.state::<ToolsState>();
    perform_action(app, &tools, action).await
}
async fn perform_action(app: &tauri::AppHandle, tools: &ToolsState, action: &str) -> Result<()> {
    let state = app.state::<SettingsState>();
    match action {
        "crosshair" => {
            let current = tools.crosshair.lock().await.snapshot.clone();
            super::super::tools::crosshair::update(
                app.clone(),
                tools.root.clone(),
                tools.crosshair.clone(),
                current.config,
                !current.enabled,
            )
            .await?;
        }
        "overlay" => {
            let hud = app.state::<crate::services::hud::HudState>();
            let mut config = hud.config.lock().await.public();
            config.enabled = !config.enabled;
            hud.apply(app, config).await?;
        }
        "filter" => {
            let current = tools.filters.snapshot.lock().await.clone();
            if !current.enabled && !state.filter_granted.load(Ordering::SeqCst) {
                return action_needed(
                    app,
                    "screen-filter",
                    "请先在屏幕滤镜中逐项确认颜色修改；本次启动不会自动获得授权",
                );
            }
            tools
                .filters
                .configure(&tools.root, current.config, !current.enabled, false, true)
                .await?;
        }
        "clicker" => tools.clicker.toggle().await?,
        "previous" | "next" | "play-pause" => {
            state
                .media
                .control(&state.root.join("settings"), action)
                .await?;
        }
        _ => return Err(error("未知热键动作")),
    }
    Ok(())
}
fn action_needed(app: &tauri::AppHandle, tool: &str, message: &str) -> Result<()> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
    let _ = app.emit_to("main", "settings-tool-needed", tool);
    Err(error(message))
}
