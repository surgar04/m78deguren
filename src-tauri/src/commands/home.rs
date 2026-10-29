//! 首页最小 IPC：程序只能通过原生选取票据登记，后续操作只能引用登记 UUID。
use crate::{
    error::AppError,
    services::{
        home::HomeState,
        tools::{Result, error},
    },
};
use serde::{Deserialize, Serialize};
use tauri::Manager;
#[derive(Deserialize)]
#[serde(tag = "operation", rename_all = "kebab-case", deny_unknown_fields)]
pub enum Request {
    Snapshot {},
    Choose {},
    Add {
        ticket: String,
        name: String,
        #[serde(rename = "isGame")]
        is_game: bool,
        revision: String,
    },
    Remove {
        id: String,
        revision: String,
        consent: bool,
    },
    Reorder {
        ids: Vec<String>,
        revision: String,
    },
    Launch {
        id: String,
        consent: bool,
    },
    Icon {
        id: String,
    },
    Policy {
        key: String,
        enabled: bool,
        consent: bool,
    },
    Manual {
        enabled: bool,
        consent: bool,
    },
    Restore {
        consent: bool,
    },
    Content {
        kind: String,
        refresh: bool,
    },
    Picture {
        refresh: bool,
    },
    PictureSave {
        id: String,
    },
    PictureWallpaper {
        id: String,
    },
    Open {
        kind: String,
    },
}
fn json<T: Serialize>(value: T) -> Result<serde_json::Value> {
    serde_json::to_value(value).map_err(|_| error("首页响应编码失败"))
}
#[tauri::command]
pub async fn home_execute(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, HomeState>,
    request: Request,
) -> std::result::Result<serde_json::Value, AppError> {
    if window.label() != "main" {
        return Err(error("辅助窗口没有首页程序控制权限"));
    }
    let app = window.app_handle();
    match request {
        Request::Snapshot {} => {
            let mut snapshot = state.snapshot().await?;
            if let Some(identity) = &app
                .state::<crate::services::onboarding::OnboardingState>()
                .progress
                .lock()
                .await
                .identity
            {
                snapshot.username = identity.name.clone();
            }
            json(snapshot)
        }
        Request::Choose {} => json(state.choose(app).await?),
        Request::Add {
            ticket,
            name,
            is_game,
            revision,
        } => json(state.add(&ticket, &name, is_game, &revision, app).await?),
        Request::Remove {
            id,
            revision,
            consent,
        } => {
            if !consent {
                return Err(error("请确认移除快捷启动；不会删除原程序"));
            }
            json(state.remove(&id, &revision, app).await?)
        }
        Request::Reorder { ids, revision } => json(state.reorder(&ids, &revision).await?),
        Request::Launch { id, consent } => json(state.launch(&id, consent, app).await?),
        Request::Icon { id } => json(state.icon(&id).await?),
        Request::Policy {
            key,
            enabled,
            consent,
        } => {
            let settings = app.state::<crate::services::settings::SettingsState>();
            let _guard = crate::services::settings::runtime::Critical::acquire(&settings)?;
            json(state.policy(&key, enabled, consent, app).await?)
        }
        Request::Manual { enabled, consent } => {
            let settings = app.state::<crate::services::settings::SettingsState>();
            let _guard = crate::services::settings::runtime::Critical::acquire(&settings)?;
            json(state.manual(enabled, consent, app).await?)
        }
        Request::Restore { consent } => {
            let settings = app.state::<crate::services::settings::SettingsState>();
            let _guard = crate::services::settings::runtime::Critical::acquire(&settings)?;
            json(state.restore(consent, app).await?)
        }
        Request::Content { kind, refresh } => json(state.text_content(&kind, refresh).await?),
        Request::Picture { refresh } => json(state.picture(refresh).await?),
        Request::PictureSave { id } => json(state.save_picture(&id, app).await?),
        Request::PictureWallpaper { id } => json(state.picture_wallpaper(&id, app).await?),
        Request::Open { kind } => {
            use tauri_plugin_opener::OpenerExt;
            let url = match kind.as_str() {
                "feedback" => "https://github.com/surgar04/m78deguren/issues",
                _ => return Err(error("未知首页外部入口")),
            };
            app.opener()
                .open_url(url, None::<&str>)
                .map_err(|_| error("链接无法打开"))?;
            json(())
        }
    }
}
