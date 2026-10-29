use serde::{Deserialize, Serialize};
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Region {
    Cn,
    Global,
    Jp,
    Kr,
    Tw,
    #[default]
    Unknown,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Game {
    pub id: String,
    pub family: String,
    pub name: String,
    pub region: Region,
    pub evidence: Vec<String>,
    pub path: String,
    pub launcher: Option<String>,
    pub steam_app_id: Option<u32>,
    pub version: String,
    pub available: bool,
    pub detected_at: i64,
}
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Snapshot {
    pub games: Vec<Game>,
    pub scanned_at: Option<i64>,
    pub running: bool,
    pub mode: String,
    pub visited: u64,
    pub skipped: u64,
    pub complete: bool,
    pub message: String,
    pub warnings: Vec<String>,
    pub roots: Vec<String>,
}
#[derive(Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Hint {
    pub path: String,
    #[serde(default)]
    pub region: Region,
    #[serde(default)]
    pub family: String,
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub steam_app_id: Option<u32>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Hints {
    pub roots: Vec<Hint>,
    pub drives: Vec<String>,
    pub warnings: Vec<String>,
}
