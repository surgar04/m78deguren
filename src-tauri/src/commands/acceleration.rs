//! 主窗口限定网关：只接受登记标识与一次性会话，不接受 URL、命令行或任意 EXE 路径。
use crate::{
    error::AppError,
    services::{
        acceleration::AccelerationState,
        tools::{Result, error},
    },
};
use serde::Deserialize;
use tauri::Manager;
#[derive(Deserialize)]
#[serde(tag = "operation", rename_all = "kebab-case", deny_unknown_fields)]
pub enum Request {
    Snapshot {},
    Discover {},
    Choose {},
    Select {
        hash: String,
        index: usize,
        revision: String,
    },
    Remind {
        enabled: bool,
        revision: String,
    },
    Open {},
    Website {
        kind: String,
    },
    Prepare {
        #[serde(rename = "gameId")]
        game_id: String,
    },
    Confirm {
        id: String,
        consent: bool,
    },
    Cancel {
        id: String,
    },
    StopTracking {
        id: String,
    },
}
#[tauri::command]
pub async fn acceleration_execute(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    request: Request,
) -> std::result::Result<serde_json::Value, AppError> {
    if window.label() != "main" {
        return Err(error("辅助窗口没有加速准备权限"));
    }
    let state = app.state::<AccelerationState>();
    if !matches!(
        &request,
        Request::Snapshot {} | Request::Cancel { .. } | Request::StopTracking { .. }
    ) && (app
        .state::<super::super::services::settings::SettingsState>()
        .critical
        .load(std::sync::atomic::Ordering::SeqCst)
        || !app
            .state::<super::super::services::onboarding::OnboardingState>()
            .progress
            .lock()
            .await
            .complete)
    {
        return Err(error("首次准备或关键系统操作期间暂不可使用加速准备"));
    }
    let result: Result<_> = match request {
        Request::Snapshot {} => state.snapshot().await,
        Request::Discover {} => state.discover().await,
        Request::Choose {} => state.choose(&app).await,
        Request::Select {
            hash,
            index,
            revision,
        } => state.select(index, &hash, &revision).await,
        Request::Remind { enabled, revision } => state.remind(enabled, &revision).await,
        Request::Open {} => state.open().await,
        Request::Prepare { game_id } => state.prepare(&app, &game_id).await,
        Request::Confirm { id, consent } => state.confirm(&app, &id, consent).await,
        Request::Cancel { id } => state.cancel(&id).await,
        Request::StopTracking { id } => state.stop_tracking(&id).await,
        Request::Website { kind } => {
            let url = match kind.as_str() {
                "download" => "https://www.51quickfox.com/",
                "help" => "https://www.51quickfox.com/faq-2",
                _ => return Err(error("未知官方页面")),
            };
            use tauri_plugin_opener::OpenerExt;
            app.opener()
                .open_url(url, None::<&str>)
                .map_err(|_| error("官网无法打开，请检查默认浏览器"))?;
            state.snapshot().await
        }
    };
    serde_json::to_value(result?).map_err(|_| error("加速准备响应编码失败"))
}
