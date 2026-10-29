//! 优化页读取网关；提交复用系统变更的一次性确认与串行执行机制。
use crate::{
    error::AppError,
    services::tools::{self, ToolsState},
};
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(tag = "operation", rename_all = "kebab-case", deny_unknown_fields)]
pub enum Request {
    Catalog {},
    Scan {},
    History {},
}

#[tauri::command]
pub async fn optimizer_execute(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ToolsState>,
    request: Request,
) -> Result<serde_json::Value, AppError> {
    if window.label() != "main" {
        return Err(tools::error("辅助窗口不能读取或操作系统优化"));
    }
    match request {
        Request::Catalog {} => tools::optimizer::catalog(),
        Request::Scan {} => tools::optimizer::scan(&state.root).await,
        Request::History {} => serde_json::to_value(
            state
                .changes
                .history()
                .await?
                .into_iter()
                .filter(|row| row.domain.as_deref() == Some("optimization"))
                .collect::<Vec<_>>(),
        )
        .map_err(|_| tools::error("优化历史格式无效")),
    }
}
