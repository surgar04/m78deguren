//! 主窗口限定的游戏发现及快捷配置网关；后端手势不经可伪造的前端事件启动程序。
use crate::{
    error::AppError,
    services::{
        other_games::{OtherGamesState, types::Region},
        quick_launch::{Config, QuickLaunchState},
        tools::{Result, error},
    },
};
use serde::{Deserialize, Serialize};
use tauri::Manager;
#[derive(Deserialize)]
#[serde(tag = "operation", rename_all = "kebab-case", deny_unknown_fields)]
pub enum GamesRequest {
    Snapshot {},
    Catalog {},
    Scan { deep: bool },
    Cancel {},
    ChooseRoot {},
    Region { id: String, region: Region },
    Launch { id: String },
    OpenFolder { id: String },
}
fn value<T: Serialize>(value: T) -> Result<serde_json::Value> {
    serde_json::to_value(value).map_err(|_| error("启动器响应编码失败"))
}
#[tauri::command]
pub async fn other_games_execute(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    request: GamesRequest,
) -> std::result::Result<serde_json::Value, AppError> {
    if window.label() != "main" {
        return Err(error("此窗口没有游戏管理权限"));
    }
    let state = app.state::<OtherGamesState>();
    match request {
        GamesRequest::Snapshot {} => value(state.current().await),
        GamesRequest::Catalog {} => value(crate::services::other_games::catalog::PROFILES),
        GamesRequest::Scan { deep } => value(state.start(app.clone(), deep).await?),
        GamesRequest::Cancel {} => {
            state.cancellation.lock().await.cancel();
            value(())
        }
        GamesRequest::ChooseRoot {} => value(state.choose_root(&app).await?),
        GamesRequest::Region { id, region } => {
            value(state.confirm_region(&app, &id, region).await?)
        }
        GamesRequest::Launch { id } => {
            state.launch(&app, &id).await?;
            value(())
        }
        GamesRequest::OpenFolder { id } => {
            let current = state.current().await;
            let game = current
                .games
                .iter()
                .find(|game| game.id == id)
                .ok_or_else(|| error("游戏实例不存在"))?;
            let path = std::path::PathBuf::from(&game.path);
            let parent = path.parent().ok_or_else(|| error("游戏目录无效"))?;
            use tauri_plugin_opener::OpenerExt;
            app.opener()
                .open_path(parent.to_string_lossy().into_owned(), None::<&str>)
                .map_err(|_| error("游戏目录无法打开"))?;
            value(())
        }
    }
}
#[derive(Deserialize)]
#[serde(tag = "operation", rename_all = "kebab-case", deny_unknown_fields)]
pub enum QuickRequest {
    Snapshot {},
    Save {
        config: Box<Config>,
        revision: String,
    },
    Navigation {
        index: usize,
    },
    Preview {},
}
#[tauri::command]
pub async fn quick_launch_execute(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    request: QuickRequest,
) -> std::result::Result<serde_json::Value, AppError> {
    if window.label() != "main" {
        return Err(error("此窗口没有快捷配置权限"));
    }
    let state = app.state::<QuickLaunchState>();
    match request {
        QuickRequest::Snapshot {} => value(state.snapshot(&app).await?),
        QuickRequest::Save { config, revision } => {
            value(state.save(&app, *config, &revision).await?)
        }
        QuickRequest::Navigation { index } => {
            if index >= 8 {
                return Err(error("导航槽位无效"));
            }
            state.navigation_dispatch(&app, index).await?;
            value(())
        }
        QuickRequest::Preview {} => {
            app.state::<crate::services::home::HomeState>()
                .preview_wheel(&app)
                .await?;
            value(())
        }
    }
}
