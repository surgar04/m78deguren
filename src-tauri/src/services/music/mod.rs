//! 音乐服务在首次进入播放器时才启动；主窗口之外不能管理账户、本地库或全屏状态。
pub mod catalog;
pub mod desktop;
mod host;
mod protocol;
mod sandbox;
#[cfg(debug_assertions)]
pub mod verification;
use crate::services::tools::{Result, error, io_error};
pub use protocol::respond;
use serde_json::Value;
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};
use tokio::sync::{Mutex, Semaphore, oneshot, watch};

pub struct MusicState {
    pub root: PathBuf,
    pub desktop: desktop::DesktopLyrics,
    host: Mutex<Option<Arc<host::Host>>>,
    requests: Semaphore,
    endpoint: Mutex<Option<(u16, String)>>,
    pub catalog: Mutex<catalog::Catalog>,
    pub slots: Semaphore,
    pub sandbox_gate: Mutex<()>,
    pub sandbox_ready: watch::Sender<(String, bool)>,
    pub sandbox_results: Mutex<HashMap<String, oneshot::Sender<Value>>>,
    pub embeds: Mutex<HashMap<String, String>>,
    pub http: reqwest::Client,
}
impl MusicState {
    pub fn new(root: &Path) -> Result<Self> {
        let root = root.join("music");
        crate::services::tools::ensure_local_path(&root)?;
        for folder in ["covers", "lyrics", "tmp"] {
            std::fs::create_dir_all(root.join(folder)).map_err(io_error)?;
        }
        let catalog = match catalog::Catalog::load(&root) {
            Ok(value) => value,
            Err(_) => {
                let backup = root.join(format!("library-recovery-{}.json", uuid::Uuid::new_v4()));
                std::fs::rename(root.join("library.json"), backup).map_err(io_error)?;
                catalog::Catalog {
                    warning: "音乐索引无法读取，已保留恢复副本。可以重新导入；原始音频未修改。"
                        .into(),
                    ..Default::default()
                }
            }
        };
        Ok(Self {
            catalog: Mutex::new(catalog),
            desktop: desktop::DesktopLyrics::new(&root)?,
            root,
            host: Mutex::new(None),
            requests: Semaphore::new(16),
            endpoint: Mutex::new(None),
            slots: Semaphore::new(4),
            sandbox_gate: Mutex::new(()),
            sandbox_ready: watch::channel((String::new(), false)).0,
            sandbox_results: Mutex::new(HashMap::new()),
            embeds: Mutex::new(HashMap::new()),
            http: reqwest::Client::builder()
                .no_proxy()
                .redirect(reqwest::redirect::Policy::none())
                .connect_timeout(Duration::from_secs(3))
                .timeout(Duration::from_secs(45))
                .build()
                .map_err(|_| error("音乐流客户端初始化失败"))?,
        })
    }
    pub async fn rpc(&self, app: &tauri::AppHandle, request: Value) -> Result<Value> {
        if serde_json::to_vec(&request)
            .map_err(|_| error("音乐请求编码失败"))?
            .len()
            > 5 * 1024 * 1024
        {
            return Err(error("音乐请求过大"));
        }
        let _request = self
            .requests
            .acquire()
            .await
            .map_err(|_| error("音乐服务正在关闭"))?;
        let mut holder = self.host.lock().await;
        if holder.as_ref().is_some_and(|host| !host.available()) {
            *holder = None;
            *self.endpoint.lock().await = None;
        }
        if holder.is_none() {
            let opened = host::Host::start(&self.root, app.clone()).await?;
            *self.endpoint.lock().await = Some((opened.port, opened.secret.clone()));
            *holder = Some(Arc::new(opened));
        }
        let host = holder
            .as_ref()
            .ok_or_else(|| error("音乐服务不可用"))?
            .clone();
        drop(holder);
        match tokio::time::timeout(Duration::from_secs(90), host.request(request)).await {
            Ok(result) => result,
            Err(_) => {
                *self.endpoint.lock().await = None;
                let mut holder = self.host.lock().await;
                if holder
                    .as_ref()
                    .is_some_and(|current| Arc::ptr_eq(current, &host))
                {
                    *holder = None;
                }
                host.stop().await;
                Err(error("音乐平台请求超时，已重置服务，可重新尝试"))
            }
        }
    }
    pub async fn shutdown(&self) {
        if let Some(host) = self.host.lock().await.take() {
            host.stop().await;
        }
        *self.endpoint.lock().await = None;
    }
    pub async fn media_endpoint(&self) -> Option<(u16, String)> {
        self.endpoint.lock().await.clone()
    }
}
