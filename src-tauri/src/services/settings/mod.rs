//! 设置服务：界面偏好留在 Zustand；需要启动时读取的原生策略由此处持久化。
//! 文件、媒体、维护和系统操作按能力拆分，IPC 从不接收脚本或任意写入路径。
pub mod assets;
pub mod config;
pub mod hotkeys;
pub mod maintenance;
pub mod media;
pub mod network;
pub mod pawnio;
pub mod runtime;
pub mod storage;
pub mod update;
pub mod video;

use crate::services::tools::{Result, downloads, ensure_local_path, io_error};
use std::{
    path::{Path, PathBuf},
    sync::{Arc, atomic::AtomicBool},
};
use tokio::sync::Mutex;

pub struct SettingsState {
    pub root: PathBuf,
    pub config: Mutex<config::NativeConfig>,
    pub serial: Mutex<()>,
    pub assets: Mutex<assets::AssetStore>,
    pub http: reqwest::Client,
    pub releases_http: reqwest::Client,
    pub close_to_tray: AtomicBool,
    pub hotkeys: hotkeys::Registry,
    pub capture: Mutex<Option<(String, std::time::Instant)>>,
    pub media: media::MediaService,
    pub filter_granted: AtomicBool,
    pub critical: AtomicBool,
    pub started_at: f64,
    pub pawnio: pawnio::PawnService,
    pub update: Arc<update::UpdateService>,
    pub maintenance: maintenance::Maintenance,
    pub warnings: Vec<String>,
    _ownership: std::fs::File,
}
impl SettingsState {
    pub fn new(root: &Path) -> Result<Self> {
        ensure_local_path(root)?;
        let directory = root.join("settings");
        ensure_local_path(&directory)?;
        std::fs::create_dir_all(&directory).map_err(io_error)?;
        let ownership = storage::ownership(root)?;
        let mut warnings = Vec::new();
        let config = match config::load(&directory) {
            Ok(value) => value,
            Err(cause) => {
                quarantine(
                    &directory.join("config.json"),
                    &cause.to_string(),
                    &mut warnings,
                )?;
                config::NativeConfig {
                    hotkeys_enabled: false,
                    ..Default::default()
                }
            }
        };
        let assets = match assets::AssetStore::load(&directory) {
            Ok(value) => value,
            Err(cause) => {
                quarantine(
                    &directory.join("assets/index.json"),
                    &cause.to_string(),
                    &mut warnings,
                )?;
                assets::AssetStore::load(&directory)?
            }
        };
        let update = match update::UpdateService::new(&directory) {
            Ok(value) => value,
            Err(cause) => {
                quarantine(
                    &directory.join("update-pending.json"),
                    &cause.to_string(),
                    &mut warnings,
                )?;
                update::UpdateService::new(&directory)?
            }
        };
        Ok(Self {
            root: root.to_owned(),
            close_to_tray: AtomicBool::new(config.close_behavior == "tray"),
            config: Mutex::new(config),
            serial: Mutex::new(()),
            assets: Mutex::new(assets),
            http: downloads::http_client()?,
            releases_http: update::github_client()?,
            hotkeys: hotkeys::Registry::default(),
            capture: Mutex::new(None),
            media: media::MediaService::default(),
            filter_granted: AtomicBool::new(false),
            critical: AtomicBool::new(false),
            started_at: crate::services::tools::network::now_ms(),
            pawnio: pawnio::PawnService::default(),
            update: Arc::new(update),
            maintenance: maintenance::Maintenance::default(),
            warnings,
            _ownership: ownership,
        })
    }
}
/// 损坏的偏好不应阻止恢复界面启动。先保全原文件，再使用安全默认值；权限错误仍显式失败。
fn quarantine(path: &Path, cause: &str, warnings: &mut Vec<String>) -> Result<()> {
    ensure_local_path(path)?;
    let target = path.with_extension(format!("corrupt-{}.json", uuid::Uuid::new_v4()));
    ensure_local_path(&target)?;
    std::fs::rename(path, &target).map_err(io_error)?;
    warnings.push(format!(
        "{cause}；原记录已保全到 {}，请检查并恢复。",
        target.display()
    ));
    Ok(())
}
