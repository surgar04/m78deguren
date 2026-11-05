//! 只有主窗口可管理插件；安装文件来自原生选择器，不接受前端提供任意本机路径。
use crate::{
    error::AppError,
    services::{
        plugins::{PluginState, model::MAX_PACKAGE, storage},
        tools::{Result, error},
    },
};
use serde::Deserialize;
use serde_json::Value;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

#[derive(Deserialize)]
#[serde(tag = "operation", rename_all = "kebab-case", deny_unknown_fields)]
pub enum Request {
    Snapshot {},
    BuiltinDues {
        request: crate::services::plugins::dues::Request,
    },
    PickFile {
        id: String,
        mode: String,
    },
    Choose {
        #[serde(rename = "allowUnsigned")]
        allow_unsigned: bool,
    },
    CancelPreview {
        ticket: String,
    },
    Install {
        ticket: String,
        grants: Vec<String>,
        revision: u64,
        consent: bool,
    },
    Configure {
        id: String,
        digest: String,
        enabled: bool,
        grants: Vec<String>,
        revision: u64,
        consent: bool,
    },
    Stop {
        id: String,
    },
    SafeMode {
        enabled: bool,
        consent: bool,
    },
    Uninstall {
        id: String,
        purge: bool,
        revision: u64,
        consent: bool,
    },
    Rollback {
        id: String,
        revision: u64,
        consent: bool,
    },
    Update {
        id: String,
    },
    Invoke {
        id: String,
        command: String,
        input: Value,
    },
}
fn json(value: impl serde::Serialize) -> Result<Value> {
    serde_json::to_value(value).map_err(|_| error("PLUGIN_ENCODING"))
}
#[cfg(test)]
mod tests {
    use super::Request;
    #[test]
    fn ipc_rejects_extra_fields_and_authorization_without_package_digest() {
        assert!(
            serde_json::from_str::<Request>(r#"{"operation":"snapshot","path":"D:/other"}"#)
                .is_err()
        );
        assert!(serde_json::from_str::<Request>(r#"{"operation":"configure","id":"test.plugin","enabled":true,"grants":[],"revision":0,"consent":true}"#).is_err());
        assert!(
            serde_json::from_str::<Request>(
                r#"{"operation":"pick-file","id":"test.plugin","mode":"read","path":"D:/other"}"#
            )
            .is_err()
        );
    }
}
#[tauri::command]
pub async fn plugins_execute(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, PluginState>,
    request: Request,
) -> std::result::Result<Value, AppError> {
    if window.label() != "main" {
        return Err(error("PLUGIN_WINDOW_DENIED"));
    }
    match request {
        Request::Snapshot {} => json(state.snapshot().await),
        Request::BuiltinDues { request } => state.builtin_dues(request).await,
        Request::PickFile { id, mode } => {
            json(state.pick_file(window.app_handle(), &id, &mode).await?)
        }
        Request::Choose { allow_unsigned } => {
            if allow_unsigned && !(cfg!(debug_assertions) || crate::services::developer::enabled())
            {
                return Err(error("PLUGIN_DEVELOPER_REQUIRED"));
            }
            let app = window.app_handle().clone();
            let selected = tauri::async_runtime::spawn_blocking(move || {
                app.dialog()
                    .file()
                    .add_filter("臻境插件", &["zjplug"])
                    .blocking_pick_file()
            })
            .await
            .map_err(|_| error("PLUGIN_DIALOG"))?;
            let Some(selected) = selected else {
                return Ok(Value::Null);
            };
            let path = selected.into_path().map_err(|_| error("PLUGIN_PATH"))?;
            // 安装源可只读已有的 C 盘文件；副本、缓存和插件所有运行数据仍在应用数据根。
            crate::storage_policy::validate_local_path(&path, false)
                .map_err(crate::services::tools::io_error)?;
            let bytes = tauri::async_runtime::spawn_blocking(move || {
                storage::read_bounded(&path, MAX_PACKAGE)
            })
            .await
            .map_err(|_| error("PLUGIN_PACKAGE"))??;
            json(state.preview(bytes, allow_unsigned).await?)
        }
        Request::CancelPreview { ticket } => {
            state.cancel_preview(&ticket).await;
            Ok(Value::Null)
        }
        Request::Install {
            ticket,
            grants,
            revision,
            consent,
        } => {
            state
                .install(window.app_handle(), &ticket, grants, revision, consent)
                .await?;
            Ok(Value::Null)
        }
        Request::Configure {
            id,
            digest,
            enabled,
            grants,
            revision,
            consent,
        } => {
            state
                .configure(&id, enabled, grants, revision, consent, &digest)
                .await?;
            Ok(Value::Null)
        }
        Request::Stop { id } => {
            super::super::services::plugins::model::identifier(&id)?;
            state.stop(&id).await;
            Ok(Value::Null)
        }
        Request::SafeMode { enabled, consent } => {
            state.safe_mode(enabled, consent).await?;
            Ok(Value::Null)
        }
        Request::Uninstall {
            id,
            purge,
            revision,
            consent,
        } => {
            state.uninstall(&id, purge, revision, consent).await?;
            Ok(Value::Null)
        }
        Request::Rollback {
            id,
            revision,
            consent,
        } => {
            state.rollback(&id, revision, consent).await?;
            Ok(Value::Null)
        }
        Request::Update { id } => json(state.update(&id).await?),
        Request::Invoke { id, command, input } => {
            state
                .invoke(window.app_handle(), &id, &command, input)
                .await
        }
    }
}
