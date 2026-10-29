//! 工具服务：真实数据、受限文件入口和后台任务独立于页面生命周期。
pub mod audio;
pub mod audio_dsp;
pub mod audio_presets;
pub mod builtin;
pub mod catalog;
pub mod crashes;
pub mod crosshair;
pub mod display;
#[cfg(test)]
mod download_tests;
pub mod downloads;
pub mod filters;
pub mod icc;
pub mod input;
#[cfg(test)]
mod live_tests;
pub mod network;
pub mod optimizer;
pub mod platform;
pub mod recordings;
pub mod remote;
pub mod runtime;
pub mod speed;
pub mod system_changes;

use crate::error::AppError;
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};
use tokio::sync::Mutex;

pub type Result<T> = std::result::Result<T, AppError>;
pub fn error(message: impl Into<String>) -> AppError {
    AppError::Tool(message.into())
}
pub fn io_error(cause: std::io::Error) -> AppError {
    log::warn!("工具文件操作失败: {cause}");
    error("文件操作失败，请检查权限、文件占用和目标磁盘剩余空间")
}

/// 统一使用发布路径策略；开发入口仍显式限制 D 盘，不按盘符替代授权范围校验。
pub fn ensure_local_path(path: &Path) -> Result<()> {
    crate::storage_policy::ensure_local_path(path).map_err(|cause| error(cause.to_string()))
}

/// 异步服务调用路径校验时使用阻塞池，避免同步元数据访问阻塞Tokio工作线程。
pub async fn check_local_path(path: &Path) -> Result<()> {
    let path = path.to_owned();
    tauri::async_runtime::spawn_blocking(move || ensure_local_path(&path))
        .await
        .map_err(|_| error("目录验证任务异常"))?
}

pub struct ToolsState {
    pub root: PathBuf,
    pub http: reqwest::Client,
    pub downloads: Arc<downloads::DownloadManager>,
    pub crosshair: Arc<Mutex<crosshair::CrosshairState>>,
    pub recordings: Arc<Mutex<recordings::RecordingStore>>,
    pub speed: Arc<network::SpeedService>,
    pub probes: Mutex<std::collections::HashMap<String, network::Probe>>,
    pub runtimes: Arc<runtime::RuntimeService>,
    pub screen: Mutex<crosshair::ScreenConfig>,
    pub media_slots: Arc<tokio::sync::Semaphore>,
    pub clicker: input::ClickService,
    pub changes: system_changes::ChangeService,
    pub display: display::DisplayService,
    pub audio: audio::AudioService,
    pub filters: filters::FilterService,
    pub crash_files: Mutex<std::collections::HashMap<String, PathBuf>>,
}

impl ToolsState {
    /// setup 阶段只初始化应用目录；耗时网络/采样由显式用户操作触发。
    pub fn new(root: &Path) -> Result<Self> {
        let root = root.join("tools");
        ensure_local_path(&root)?;
        std::fs::create_dir_all(&root).map_err(io_error)?;
        let http = downloads::http_client()?;
        Ok(Self {
            downloads: Arc::new(downloads::DownloadManager::load(&root)?),
            crosshair: Arc::new(Mutex::new(crosshair::CrosshairState::load(&root)?)),
            recordings: Arc::new(Mutex::new(recordings::RecordingStore::load(&root)?)),
            speed: Arc::new(network::SpeedService::default()),
            probes: Mutex::new(std::collections::HashMap::new()),
            runtimes: Arc::new(runtime::RuntimeService::default()),
            screen: Mutex::new(crosshair::ScreenConfig::default()),
            media_slots: Arc::new(tokio::sync::Semaphore::new(4)),
            clicker: input::ClickService::load(&root),
            changes: system_changes::ChangeService::new(&root),
            display: display::DisplayService::default(),
            audio: audio::AudioService::load(&root),
            filters: filters::FilterService::load(&root),
            crash_files: Mutex::new(std::collections::HashMap::new()),
            root,
            http,
        })
    }
}

/** 固定目标原子替换；调用者负责串行化。临时文件和成品处于同一目录。 */
pub async fn save_json<T: serde::Serialize>(path: &Path, value: &T) -> Result<()> {
    check_local_path(path).await?;
    let bytes = serde_json::to_vec_pretty(value).map_err(|_| error("配置序列化失败"))?;
    let temporary = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    tokio::fs::write(&temporary, bytes)
        .await
        .map_err(io_error)?;
    if let Err(cause) = tokio::fs::rename(&temporary, path).await {
        let _ = tokio::fs::remove_file(&temporary).await;
        return Err(io_error(cause));
    }
    Ok(())
}

/// 只用于应用自己的暂存文件：Windows 上使用不覆盖的原子移动，兼容不支持硬链接的磁盘。
/// 失败时解除 TempPath 的自动删除职责，保留已校验的成品供重试；不得用于接管用户原文件。
pub fn publish_owned_file(source: &Path, target: &Path) -> Result<()> {
    ensure_local_path(source)?;
    ensure_local_path(target)?;
    let temporary = tempfile::TempPath::try_from_path(source).map_err(io_error)?;
    if let Err(failure) = temporary.persist_noclobber(target) {
        let cause = failure.error;
        let _ = failure.path.keep();
        return Err(io_error(cause));
    }
    Ok(())
}

#[cfg(test)]
pub fn test_root(label: &str) -> Result<PathBuf> {
    let project = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .ok_or_else(|| error("测试项目目录缺失"))?;
    let path = project
        .join(".cache/verification/tools-native")
        .join(format!("{label}-{}", uuid::Uuid::new_v4()));
    ensure_local_path(&path)?;
    std::fs::create_dir_all(&path).map_err(io_error)?;
    Ok(path)
}

#[cfg(test)]
mod publish_tests {
    use super::*;
    #[test]
    fn publishes_without_hard_links_and_never_overwrites() -> Result<()> {
        let root = test_root("publish-no-replace")?;
        let source = root.join("ready.tmp");
        let target = root.join("download.exe");
        std::fs::write(&source, b"verified-content").map_err(io_error)?;
        publish_owned_file(&source, &target)?;
        assert!(!source.exists());
        assert_eq!(
            std::fs::read(&target).map_err(io_error)?,
            b"verified-content"
        );
        std::fs::write(&source, b"another-task").map_err(io_error)?;
        assert!(publish_owned_file(&source, &target).is_err());
        assert_eq!(
            std::fs::read(&target).map_err(io_error)?,
            b"verified-content"
        );
        assert_eq!(std::fs::read(&source).map_err(io_error)?, b"another-task");
        Ok(())
    }
}
