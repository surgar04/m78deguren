use crate::error::AppError;
use serde::Serialize;
pub mod builtin;
pub mod hardware;
pub mod home;
pub mod hud;
pub mod launchers;
pub mod onboarding;
pub mod optimizer;
pub mod settings;
pub mod steam;
pub mod tools;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Greeting {
    message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    name: &'static str,
    version: &'static str,
    platform: &'static str,
    architecture: &'static str,
}

fn make_greeting(name: &str) -> Result<Greeting, AppError> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 40 || name.chars().any(char::is_control) {
        return Err(AppError::InvalidName);
    }
    Ok(Greeting {
        message: format!("你好，{name}！React 与 Rust 已成功连接。"),
    })
}

#[tauri::command]
pub async fn greet(name: String) -> Result<Greeting, AppError> {
    make_greeting(&name)
}

#[tauri::command]
pub fn app_info() -> AppInfo {
    AppInfo {
        name: "臻境",
        version: env!("CARGO_PKG_VERSION"),
        platform: std::env::consts::OS,
        architecture: std::env::consts::ARCH,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_unicode_length_and_whitespace() {
        assert!(make_greeting("  ").is_err());
        assert!(make_greeting(&"境".repeat(40)).is_ok());
        assert!(make_greeting(&"境".repeat(41)).is_err());
        assert!(make_greeting("hello\nworld").is_err());
        assert!(
            matches!(make_greeting(" 臻境 "), Ok(value) if value.message.contains("你好，臻境！"))
        );
    }

    #[test]
    fn error_contract_is_structured() -> Result<(), serde_json::Error> {
        let error = serde_json::to_value(AppError::InvalidName)?;
        assert_eq!(error["code"], "INVALID_NAME");
        Ok(())
    }
}
