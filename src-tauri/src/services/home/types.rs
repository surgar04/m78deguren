//! 首页只存用户真实创建的数据；不含游戏种子、固定硬件读数或合成运行状态。
use crate::services::tools::{Result, error};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Policy {
    pub auto_game_mode: bool,
    pub disable_win_in_game: bool,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Shortcut {
    pub id: String,
    pub name: String,
    pub path: String,
    pub is_game: bool,
    pub last_launched: Option<i64>,
    #[serde(default)]
    pub managed_game: bool,
}
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Store {
    pub policy: Policy,
    pub shortcuts: Vec<Shortcut>,
}
pub fn name_valid(text: &str) -> bool {
    !text.trim().is_empty() && text.chars().count() <= 60 && !text.chars().any(char::is_control)
}
impl Store {
    pub fn validate(&self) -> Result<()> {
        let mut ids = HashSet::new();
        let mut paths = HashSet::new();
        if self.shortcuts.len() > 128 {
            return Err(error("快捷启动最多保存 128 项"));
        }
        for row in &self.shortcuts {
            if uuid::Uuid::parse_str(&row.id).is_err()
                || !ids.insert(&row.id)
                || !name_valid(&row.name)
                || !paths.insert(row.path.to_lowercase())
                || !exe_path_valid(&row.path)
            {
                return Err(error("快捷启动配置包含无效或重复的项目"));
            }
        }
        Ok(())
    }
}
/// 只接受本机绝对 EXE 路径，拒绝 UNC、设备路径、控制字符及相对路径。
pub fn exe_path_valid(text: &str) -> bool {
    let bytes = text.as_bytes();
    text.len() <= 4096
        && bytes.len() > 7
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && matches!(bytes[2], b'\\' | b'/')
        && text.to_ascii_lowercase().ends_with(".exe")
        && !text.chars().any(char::is_control)
        && !text.contains(['"', '<', '>', '|', '*', '?'])
        && !text[2..].contains(':')
        && !std::path::Path::new(text)
            .components()
            .any(|part| matches!(part, std::path::Component::ParentDir))
}
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Runtime {
    pub ready: bool,
    pub manual: bool,
    pub effective: bool,
    pub game_running: bool,
    pub win_key_blocked: bool,
    pub suppressed_count: u32,
    pub recoverable_count: u32,
    pub message: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub username: String,
    pub revision: String,
    pub policy: Policy,
    pub shortcuts: Vec<Shortcut>,
    pub runtime: Runtime,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Draft {
    pub ticket: String,
    pub name: String,
    pub path: String,
    pub icon: Option<String>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Content {
    pub title: String,
    pub text: String,
    pub author: String,
    pub source: String,
    pub url: Option<String>,
    pub fetched_at: i64,
    pub cached: bool,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Picture {
    pub id: String,
    pub author: String,
    pub source: String,
    pub data: String,
    pub fetched_at: i64,
}
