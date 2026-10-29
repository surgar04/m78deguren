use serde::Serialize;

/// 可序列化的 IPC 错误，避免把内部路径或完整错误链暴露给界面。
#[derive(Debug, thiserror::Error, Serialize)]
#[serde(tag = "code", content = "message", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AppError {
    #[error("{0}")]
    Tool(String),
    #[error("请输入 1 至 40 个字符的名字")]
    InvalidName,
}
