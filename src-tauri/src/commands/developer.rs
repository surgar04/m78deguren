//! 主窗口专属认证入口；未经认证时，其余应用 IPC 由根处理器统一阻断。
use crate::services::{
    developer::DeveloperState,
    tools::{Result, error},
};
use serde::Deserialize;
use tauri::Manager;

#[derive(Deserialize)]
#[serde(tag = "operation", rename_all = "kebab-case", deny_unknown_fields)]
pub enum Request {
    Status {},
    Authenticate { email: String, stoken: String },
    Fallback {},
}

#[tauri::command]
pub async fn developer_execute(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    request: Request,
) -> Result<crate::services::developer::Status> {
    if window.label() != "main" {
        return Err(error("开发者身份只允许在主窗口管理"));
    }
    let state = app.state::<DeveloperState>();
    let _guard = state.serial.lock().await;
    let expired = state.expire_if_needed().await;
    if expired || !matches!(&request, Request::Status {}) {
        app.state::<crate::services::settings::SettingsState>()
            .update
            .reset_channel()
            .await?;
    }
    let result = match request {
        Request::Status {} => state.snapshot().await,
        Request::Authenticate { email, mut stoken } => {
            // 不把凭据放入日志、命令行、错误消息或长期状态。
            let result = state.authenticate(&email, &stoken).await;
            stoken.clear();
            result?
        }
        Request::Fallback {} => {
            state
                .fallback("已使用稳定功能与更新通道；用户数据保留")
                .await?
        }
    };
    if !crate::services::developer::locked() {
        crate::boot_runtime(&app)?;
    }
    Ok(result)
}
