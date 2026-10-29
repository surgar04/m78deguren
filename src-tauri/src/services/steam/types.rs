use serde::{Deserialize, Serialize};
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Account {
    pub id: String,
    pub account_name: String,
    pub name: String,
    pub active: bool,
    pub most_recent: bool,
    pub remember_password: bool,
    pub last_login: Option<u64>,
}
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Library {
    pub id: String,
    pub path: String,
    pub available: bool,
    pub total_bytes: Option<u64>,
    pub free_bytes: Option<u64>,
    pub steam_bytes: u64,
    pub games: usize,
}
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Game {
    pub app_id: u32,
    pub name: String,
    pub installed: bool,
    pub install_complete: bool,
    pub library_id: Option<String>,
    pub install_path: Option<String>,
    pub size_bytes: Option<u64>,
    pub playtime_minutes: Option<u64>,
    pub last_played: Option<u64>,
    /// 本地安装/游玩缓存不构成当前账号拥有该游戏的证明。
    pub owned: Option<bool>,
    pub evidence: String,
}
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Snapshot {
    pub installed: bool,
    pub path: Option<String>,
    pub running: bool,
    pub current_account: Option<String>,
    pub accounts: Vec<Account>,
    pub libraries: Vec<Library>,
    pub games: Vec<Game>,
    pub warnings: Vec<String>,
    pub captured_at: i64,
    pub revision: String,
    pub inventory_source: String,
    pub inventory_complete: bool,
}
#[derive(Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LoginRegistry {
    pub auto_login: Option<String>,
    pub remember: Option<u32>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Disk {
    pub drive: String,
    pub total: u64,
    pub free: u64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Platform {
    pub path: Option<String>,
    pub running: bool,
    pub active_id: Option<u32>,
    pub disks: Vec<Disk>,
    pub registry: LoginRegistry,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Backup {
    pub id: String,
    pub kind: String,
    pub account: String,
    pub created_at: i64,
    pub steam_path: String,
    pub before_hash: String,
    pub after_hash: String,
    pub before_registry: LoginRegistry,
    pub after_registry: LoginRegistry,
    pub state: String,
    pub message: String,
}
