use crate::{
    error::AppError,
    services::{
        steam::SteamState,
        tools::{Result, error},
    },
};
use serde::{Deserialize, Serialize};
use tauri::Manager;
#[derive(Deserialize)]
#[serde(tag = "operation", rename_all = "kebab-case", deny_unknown_fields)]
pub enum Request {
    Snapshot {
        refresh: bool,
    },
    Image {
        kind: String,
        id: String,
    },
    Launch {
        kind: String,
        #[serde(rename = "appId")]
        app_id: Option<u32>,
        consent: bool,
    },
    Open {
        kind: String,
        #[serde(rename = "appId")]
        app_id: u32,
    },
    Account {
        kind: String,
        id: String,
        revision: String,
        consent: bool,
    },
    Backups {},
    Restore {
        id: String,
        consent: bool,
    },
    PublicSync {
        consent: bool,
        #[serde(rename = "apiKey")]
        api_key: Option<String>,
    },
}
fn json<T: Serialize>(value: T) -> Result<serde_json::Value> {
    serde_json::to_value(value).map_err(|_| error("Steam 响应编码失败"))
}
#[tauri::command]
pub async fn steam_execute(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, SteamState>,
    request: Request,
) -> std::result::Result<serde_json::Value, AppError> {
    if window.label() != "main" {
        return Err(error("辅助窗口没有 Steam 管理权限"));
    }
    match request {
        Request::Snapshot { refresh } => json(state.refresh(refresh).await?),
        Request::Image { kind, id } => json(state.image(&kind, &id).await?),
        Request::Launch {
            kind,
            app_id,
            consent,
        } => {
            if !consent || !matches!(kind.as_str(), "client" | "run" | "install" | "uninstall") {
                return Err(error("请确认启动或提交 Steam 请求"));
            }
            state.launch(&kind, app_id).await?;
            json(())
        }
        Request::Open { kind, app_id } => {
            use tauri_plugin_opener::OpenerExt;
            let snapshot = state.current().await?;
            let game = snapshot
                .games
                .iter()
                .find(|game| game.app_id == app_id)
                .ok_or_else(|| error("游戏不属于已扫描列表"))?;
            if kind == "store" {
                window
                    .app_handle()
                    .opener()
                    .open_url(
                        format!("https://store.steampowered.com/app/{app_id}/"),
                        None::<&str>,
                    )
                    .map_err(|_| error("商店页面无法打开"))?;
            } else if kind == "folder" {
                let path = game
                    .install_path
                    .as_deref()
                    .filter(|_| game.installed)
                    .ok_or_else(|| error("游戏安装目录不可用"))?;
                let target = tokio::fs::canonicalize(path)
                    .await
                    .map_err(|_| error("游戏目录已不存在"))?;
                let library = snapshot
                    .libraries
                    .iter()
                    .find(|library| Some(library.id.as_str()) == game.library_id.as_deref())
                    .ok_or_else(|| error("游戏库已经变化"))?;
                let parent = tokio::fs::canonicalize(
                    std::path::Path::new(&library.path).join("steamapps/common"),
                )
                .await
                .map_err(|_| error("游戏库不可访问"))?;
                if !target.starts_with(&parent) || target == parent {
                    return Err(error("游戏目录越过库边界"));
                }
                window
                    .app_handle()
                    .opener()
                    .open_path(target.to_string_lossy().into_owned(), None::<&str>)
                    .map_err(|_| error("安装目录无法打开"))?;
            } else {
                return Err(error("不支持的 Steam 跳转"));
            }
            json(())
        }
        Request::Account {
            kind,
            id,
            revision,
            consent,
        } => {
            let settings = window.state::<crate::services::settings::SettingsState>();
            let _critical = crate::services::settings::runtime::Critical::acquire(&settings)?;
            let result = state.account_action(&kind, &id, &revision, consent).await;
            json(result?)
        }
        Request::Restore { id, consent } => {
            let settings = window.state::<crate::services::settings::SettingsState>();
            let _critical = crate::services::settings::runtime::Critical::acquire(&settings)?;
            let result = state.restore(&id, consent).await;
            json(result?)
        }
        Request::Backups {} => json(state.backups().await?),
        Request::PublicSync { consent, api_key } => {
            json(state.sync_public(consent, api_key.as_deref()).await?)
        }
    }
}
