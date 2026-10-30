//! 加速准备仅记录本地客户端及单次操作；没有账号、密码、线路凭据或推测的延迟。
use serde::{Deserialize, Serialize};
#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Client {
    pub path: String,
    pub version: String,
    pub publisher: String,
    pub sha256: String,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Config {
    pub client: Option<Client>,
    pub remind_on_exit: bool,
}
impl Default for Config {
    fn default() -> Self {
        Self {
            client: None,
            remind_on_exit: true,
        }
    }
}
#[derive(Clone, Deserialize, Serialize, PartialEq, Eq, Debug)]
#[serde(rename_all = "kebab-case")]
pub enum Phase {
    Waiting,
    LaunchRequested,
    Playing,
    Finished,
    Cancelled,
    Failed,
}
impl Phase {
    pub fn active(&self) -> bool {
        matches!(self, Self::Waiting | Self::LaunchRequested | Self::Playing)
    }
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub game_id: String,
    pub game_name: String,
    pub phase: Phase,
    pub message: String,
    pub created_at: i64,
    pub confirmed_at: Option<i64>,
    #[serde(skip)]
    pub client_instance: Option<(u32, u64)>,
    #[serde(skip)]
    pub game_path: String,
    #[serde(skip)]
    pub launch_target: (String, Option<u32>),
    #[serde(skip)]
    pub client: Client,
    #[serde(skip)]
    pub misses: u8,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub config: Config,
    pub revision: String,
    pub clients: Vec<Client>,
    pub client_running: bool,
    pub session: Option<Session>,
    pub warnings: Vec<String>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Discovery {
    pub clients: Vec<Client>,
    pub warnings: Vec<String>,
}
