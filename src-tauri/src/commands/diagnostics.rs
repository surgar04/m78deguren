use crate::services::{
    diagnostics,
    tools::{Result, error},
};
use serde::Deserialize;
use serde_json::{Value, json};
use tauri::Manager;
#[derive(Deserialize)]
#[serde(tag = "operation", rename_all = "kebab-case", deny_unknown_fields)]
pub enum Request {
    Ingest { entries: Vec<diagnostics::Input> },
    Read { level: String, search: String },
    Detail { enabled: bool },
    Open {},
    Export {},
    Clear { consent: bool },
}
/// 辅助窗口只能上报自身事件；目录、导出、清理和详细模式仅主窗口可用。
#[tauri::command]
pub async fn diagnostics_execute(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    request: Request,
) -> Result<Value> {
    let label = window.label();
    if let Request::Ingest { entries } = request {
        if !matches!(
            label,
            "main"
                | "hud"
                | "desktop-lyrics"
                | "sensor-monitor"
                | "crosshair-overlay"
                | "screen-test"
        ) {
            return Err(error("该窗口不能提交诊断事件"));
        }
        let label = label.to_owned();
        return tauri::async_runtime::spawn_blocking(move || diagnostics::ingest(&label, entries))
            .await
            .map_err(|_| error("诊断写入任务失败"))?;
    }
    if label != "main" || crate::services::developer::locked() {
        return Err(error("只能在主窗口管理应用日志"));
    }
    let root = app
        .state::<crate::services::settings::SettingsState>()
        .root
        .clone();
    match request {
        Request::Read { level, search } => tauri::async_runtime::spawn_blocking(move || {
            diagnostics::snapshot(&root, &level, &search)
        })
        .await
        .map_err(|_| error("日志读取任务失败"))?,
        Request::Detail { enabled } => {
            diagnostics::detail(enabled);
            Ok(json!({"enabled":enabled}))
        }
        Request::Open {} => {
            use tauri_plugin_opener::OpenerExt;
            app.opener()
                .open_path(root.join("logs").to_string_lossy(), None::<&str>)
                .map_err(|_| error("无法打开日志目录"))?;
            Ok(Value::Null)
        }
        Request::Export {} => {
            use tauri_plugin_dialog::DialogExt;
            let dialog = app.clone();
            let folder = root.join("logs");
            let selected = tauri::async_runtime::spawn_blocking(move || {
                dialog
                    .dialog()
                    .file()
                    .set_title("导出脱敏诊断包（不含账号与设置）")
                    .set_directory(folder)
                    .set_file_name(format!(
                        "臻境诊断-{}.json",
                        chrono::Utc::now().format("%Y%m%d-%H%M%S")
                    ))
                    .add_filter("JSON 诊断包", &["json"])
                    .blocking_save_file()
            })
            .await
            .map_err(|_| error("无法打开诊断导出对话框"))?;
            let Some(selected) = selected else {
                return Ok(json!({"saved":false}));
            };
            let path = selected.into_path().map_err(|_| error("请选择本地文件"))?;
            tauri::async_runtime::spawn_blocking(move || diagnostics::export(&root, &path))
                .await
                .map_err(|_| error("诊断导出任务失败"))??;
            Ok(json!({"saved":true}))
        }
        Request::Clear { consent } => {
            if !consent {
                return Err(error("请明确确认清除应用日志"));
            }
            tauri::async_runtime::spawn_blocking(move || diagnostics::clear(&root))
                .await
                .map_err(|_| error("日志清理任务失败"))??;
            Ok(Value::Null)
        }
        Request::Ingest { .. } => Err(error("诊断请求无效")),
    }
}
