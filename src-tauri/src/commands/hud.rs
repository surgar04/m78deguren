//! HUD 窗口仅允许读状态、媒体控制和移动自己；配置及文件导入导出只授予主窗口。
use crate::{
    error::AppError,
    services::{
        hud::{self, HudState},
        settings::{self, SettingsState},
        tools::{check_local_path, error, io_error},
    },
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::sync::atomic::Ordering;
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;
use tokio::io::AsyncReadExt;

#[derive(Deserialize)]
#[serde(tag = "operation", rename_all = "kebab-case", deny_unknown_fields)]
pub enum Request {
    Snapshot {},
    Configure { config: Box<hud::config::Config> },
    Toggle {},
    Next {},
    Drag {},
    Remember {},
    Displays {},
    Media { action: String },
    OpenSettings {},
    Import {},
    Export {},
    Catalog {},
    Locale { locale: String },
}
fn allowed(label: &str, request: &Request) -> bool {
    label == "main"
        || (label == "hud"
            && matches!(
                request,
                Request::Snapshot {}
                    | Request::Next {}
                    | Request::Drag {}
                    | Request::Remember {}
                    | Request::Media { .. }
                    | Request::OpenSettings {}
                    | Request::Locale { .. }
            ))
}
#[tauri::command]
pub async fn hud_execute(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    request: Request,
) -> std::result::Result<Value, AppError> {
    if !allowed(window.label(), &request) {
        return Err(error("该窗口没有 HUD 管理权限"));
    }
    let state = app.state::<HudState>();
    match request {
        Request::Snapshot {} => Ok(state.read(window.label() == "main").await),
        Request::Configure { config } => {
            state.apply(&app, *config).await?;
            Ok(state.read(true).await)
        }
        Request::Toggle {} => {
            let mut config = state.config.lock().await.public();
            config.enabled = !config.enabled;
            state.apply(&app, config).await?;
            Ok(json!(()))
        }
        Request::Next {} => {
            state.cycle.fetch_add(1, Ordering::Relaxed);
            state.wake.notify_one();
            Ok(json!(()))
        }
        Request::Displays {} => hud::window::displays(&app),
        Request::Catalog {} => {
            let hw = app.state::<crate::services::hardware::Hardware>();
            let data = hw.hud.read().await;
            Ok(json!({"catalog":data.get("catalog"),"variables":data.get("variables")}))
        }
        Request::Locale { locale } => {
            if !["zh-CN", "zh-TW", "en", "ja", "de", "fr"].contains(&locale.as_str()) {
                return Err(error("HUD 语言不受支持"));
            }
            *state.locale.write().await = locale;
            state.wake.notify_one();
            Ok(json!(()))
        }
        Request::Drag {} => {
            if window.label() != "hud" || state.config.lock().await.locked {
                return Err(error("请先解除 HUD 锁定"));
            }
            window.start_dragging().map_err(|_| error("HUD 拖动失败"))?;
            Ok(json!(()))
        }
        Request::Remember {} => {
            hud::window::remember(&app).await?;
            Ok(json!(()))
        }
        Request::Media { action } => {
            if !["previous", "play-pause", "next"].contains(&action.as_str()) {
                return Err(error("媒体动作无效"));
            }
            let settings = app.state::<SettingsState>();
            settings
                .media
                .ensure(&settings.root.join("settings"))
                .await?;
            settings
                .media
                .control(&settings.root.join("settings"), &action)
                .await?;
            Ok(json!(()))
        }
        Request::OpenSettings {} => {
            settings::runtime::show_main(&app)?;
            app.emit_to("main", "hud-open-settings", ())
                .map_err(|_| error("HUD 设置导航失败"))?;
            Ok(json!(()))
        }
        Request::Export {} => {
            let mut export = state.config.lock().await.public();
            export.deepseek_key.clear();
            for source in &mut export.http_sources {
                source.headers.clear();
            }
            let bytes =
                serde_json::to_vec_pretty(&export).map_err(|_| error("HUD 导出结构无效"))?;
            // 原生对话框会阻塞线程，不能占用异步调度线程。
            let dialog_app = app.clone();
            let file = tauri::async_runtime::spawn_blocking(move || {
                dialog_app
                    .dialog()
                    .file()
                    .set_file_name("臻境-HUD.json")
                    .add_filter("HUD 配置", &["json"])
                    .blocking_save_file()
            })
            .await
            .map_err(|_| error("HUD 保存对话框失败"))?;
            let Some(file) = file else {
                return Ok(json!(false));
            };
            let path = file.into_path().map_err(|_| error("仅支持本地文件"))?;
            check_local_path(&path).await?;
            tokio::fs::write(path, bytes).await.map_err(io_error)?;
            Ok(json!(true))
        }
        Request::Import {} => {
            let dialog_app = app.clone();
            let file = tauri::async_runtime::spawn_blocking(move || {
                dialog_app
                    .dialog()
                    .file()
                    .add_filter("HUD 配置", &["json"])
                    .blocking_pick_file()
            })
            .await
            .map_err(|_| error("HUD 导入对话框失败"))?;
            let Some(file) = file else {
                return Ok(json!(false));
            };
            let path = file.into_path().map_err(|_| error("仅支持本地文件"))?;
            let file = tokio::fs::File::open(path).await.map_err(io_error)?;
            let mut bytes = Vec::new();
            file.take(524289)
                .read_to_end(&mut bytes)
                .await
                .map_err(io_error)?;
            if bytes.len() > 524288 {
                return Err(error("HUD 导入文件过大"));
            }
            let mut config: hud::config::Config =
                serde_json::from_slice(&bytes).map_err(|_| error("HUD 配置格式无效"))?;
            config.enabled = false;
            config.deepseek_key.clear();
            for source in &mut config.http_sources {
                source.headers.clear();
                // 导入配置不能自动向外部地址发请求；用户核对后在数据页逐项启用。
                source.enabled = false;
            }
            state.apply(&app, config).await?;
            Ok(json!(true))
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn hud_cannot_reconfigure_read_files_or_toggle_system_tools() {
        for request in [
            Request::Import {},
            Request::Export {},
            Request::Toggle {},
            Request::Displays {},
        ] {
            assert!(!allowed("hud", &request));
            assert!(allowed("main", &request));
        }
        assert!(allowed("hud", &Request::Snapshot {}));
        assert!(!allowed("sensor-monitor", &Request::Snapshot {}));
    }
}
