//! 源码准备只向主窗口中已认证的开发者开放，前端只能传选择票据和明确确认。
use crate::services::{
    developer::{self, workspace::WorkspaceState},
    tools::{Result, error},
};
use serde::Deserialize;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

#[derive(Deserialize)]
#[serde(tag = "operation", rename_all = "kebab-case", deny_unknown_fields)]
pub enum Request {
    Status {},
    Select {},
    Prepare { ticket: String, consent: bool },
    Defer {},
    Cancel {},
    Open {},
    Logs {},
    Prerequisites {},
}
#[tauri::command]
pub async fn developer_workspace_execute(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    request: Request,
) -> Result<developer::workspace::Status> {
    if window.label() != "main" || !developer::enabled() {
        return Err(error("请先在主窗口认证开发者身份"));
    }
    let state = app.state::<WorkspaceState>();
    let _guard = state.serial.lock().await;
    match request {
        Request::Status {} => state.progress().await,
        Request::Select {} => {
            let dialog_app = app.clone();
            let path = tauri::async_runtime::spawn_blocking(move || {
                dialog_app
                    .dialog()
                    .file()
                    .set_title("选择空目录存放臻境源码与开发环境")
                    .blocking_pick_folder()
            })
            .await
            .map_err(|_| error("目录选择失败"))?;
            if let Some(path) = path {
                state
                    .select(path.into_path().map_err(|_| error("请选择本地目录"))?)
                    .await
            } else {
                state.progress().await
            }
        }
        Request::Prepare { ticket, consent } => state.start(&app, &ticket, consent).await,
        Request::Defer {} => state.defer().await,
        Request::Cancel {} => {
            state.cancel().await?;
            state.progress().await
        }
        Request::Open {} | Request::Logs {} => {
            state
                .open(&app, matches!(request, Request::Logs {}))
                .await?;
            state.progress().await
        }
        Request::Prerequisites {} => {
            use tauri_plugin_opener::OpenerExt;
            app.opener()
                .open_url(
                    "https://visualstudio.microsoft.com/visual-cpp-build-tools/",
                    None::<&str>,
                )
                .map_err(|_| error("无法打开微软官方开发工具页面"))?;
            state.progress().await
        }
    }
}
