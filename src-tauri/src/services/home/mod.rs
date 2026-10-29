//! 首页原生聚合：程序白名单、内容服务、可恢复的游戏模式与按游戏生效的 Win 键钩子。
mod content;
mod launcher;
mod runtime;
pub mod types;
use crate::services::tools::{Result, ensure_local_path, error, io_error, save_json};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::{Mutex, RwLock};
use types::*;

pub struct HomeState {
    pub root: PathBuf,
    pub store: Mutex<Store>,
    pub serial: Mutex<()>,
    pub status: Arc<RwLock<Runtime>>,
    worker: runtime::Worker,
    drafts: Mutex<Vec<(Instant, Draft)>>,
    http: reqwest::Client,
    content_lock: Mutex<()>,
    quote_lock: Mutex<()>,
    announcement_lock: Mutex<()>,
    quote_at: Mutex<Option<Instant>>,
    picture_at: Mutex<Option<Instant>>,
    watch: Mutex<Option<tokio::task::JoinHandle<()>>>,
}
fn revision(store: &Store) -> Result<String> {
    use sha2::{Digest, Sha256};
    Ok(format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(store).map_err(|_| error("首页配置编码失败"))?)
    ))
}
impl HomeState {
    /// 自动识别与手动快捷启动共用同一条记录；根据规范化路径去重，不建立第二份启动列表。
    pub async fn register_detected(
        &self,
        path: &Path,
        name: &str,
        app: &tauri::AppHandle,
    ) -> Result<String> {
        let path = launcher::validate_exe(path).await?;
        let _guard = self.serial.lock().await;
        let mut store = self.store.lock().await.clone();
        let before = revision(&store)?;
        let text = path.to_string_lossy().into_owned();
        let id = if let Some(row) = store
            .shortcuts
            .iter_mut()
            .find(|row| row.path.eq_ignore_ascii_case(&text))
        {
            row.managed_game = true;
            row.is_game = true;
            row.id.clone()
        } else {
            let id = uuid::Uuid::new_v4().to_string();
            store.shortcuts.push(Shortcut {
                id: id.clone(),
                name: name.chars().take(60).collect(),
                path: text,
                is_game: true,
                last_launched: None,
                managed_game: true,
            });
            id
        };
        store.validate()?;
        let cached = read_limited(&self.root.join(format!("icons/{id}.png")), 393216)
            .await
            .is_ok_and(|bytes| bytes.starts_with(b"\x89PNG\r\n\x1a\n"));
        let icon = if cached {
            None
        } else {
            crate::services::tools::platform::run_embedded(
                &self.root,
                "home-icon",
                &[path.to_string_lossy().into_owned()],
                Duration::from_secs(15),
                &runtime::source(),
            )
            .await
            .ok()
            .and_then(|v| v.as_str().map(str::to_owned))
        };
        if let Some(icon) =
            icon.filter(|v| v.starts_with("data:image/png;base64,") && v.len() < 524288)
        {
            use base64::Engine;
            if let Ok(bytes) = base64::engine::general_purpose::STANDARD
                .decode(icon.trim_start_matches("data:image/png;base64,"))
            {
                let folder = self.root.join("icons");
                crate::services::tools::check_local_path(&folder).await?;
                tokio::fs::create_dir_all(&folder).await.map_err(io_error)?;
                tokio::fs::write(folder.join(format!("{id}.png")), bytes)
                    .await
                    .map_err(io_error)?;
            }
        }
        self.commit(&before, store).await?;
        // 扫描结束后统一刷新原生配置，避免每找到一个游戏都重新采样进程。
        let _ = app;
        Ok(id)
    }
    pub async fn rename_detected(&self, id: &str, name: &str) -> Result<()> {
        let _guard = self.serial.lock().await;
        let mut store = self.store.lock().await.clone();
        let before = revision(&store)?;
        if let Some(row) = store.shortcuts.iter_mut().find(|row| row.id == id) {
            row.name = name.chars().take(60).collect();
            self.commit(&before, store).await?;
        }
        Ok(())
    }
    pub async fn refresh_game_worker(&self, app: &tauri::AppHandle) {
        self.refresh_worker_if_running(app).await;
    }
    pub fn new(data: &Path) -> Result<Self> {
        let root = data.join("home");
        ensure_local_path(&root)?;
        std::fs::create_dir_all(&root).map_err(io_error)?;
        let file = root.join("workspace.json");
        ensure_local_path(&file)?;
        let read = std::fs::File::open(&file).and_then(|file| {
            use std::io::Read;
            let mut bytes = Vec::new();
            file.take(1_048_577).read_to_end(&mut bytes)?;
            Ok(bytes)
        });
        let store = match read {
            Ok(bytes) if bytes.len() <= 1_048_576 => {
                let value: Store = serde_json::from_slice(&bytes)
                    .map_err(|_| error("首页配置损坏；原文件已保留，请检查备份"))?;
                value.validate()?;
                value
            }
            Ok(_) => return Err(error("首页配置超过大小限制")),
            Err(cause) if cause.kind() == std::io::ErrorKind::NotFound => Store::default(),
            Err(cause) => return Err(io_error(cause)),
        };
        let http = reqwest::Client::builder()
            .https_only(true)
            .connect_timeout(Duration::from_secs(6))
            .timeout(Duration::from_secs(20))
            .redirect(reqwest::redirect::Policy::custom(|attempt| {
                if attempt.previous().len() < 3 && allowed_url(attempt.url()) {
                    attempt.follow()
                } else {
                    attempt.stop()
                }
            }))
            .user_agent(concat!("zhenjing/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|_| error("首页网络服务初始化失败"))?;
        Ok(Self {
            root,
            store: Mutex::new(store),
            serial: Mutex::new(()),
            status: Arc::new(RwLock::new(Runtime::default())),
            worker: runtime::Worker::default(),
            drafts: Mutex::new(Vec::new()),
            http,
            content_lock: Mutex::new(()),
            quote_lock: Mutex::new(()),
            announcement_lock: Mutex::new(()),
            quote_at: Mutex::new(None),
            picture_at: Mutex::new(None),
            watch: Mutex::new(None),
        })
    }
    pub async fn snapshot(&self) -> Result<Snapshot> {
        let store = self.store.lock().await.clone();
        Ok(Snapshot {
            username: std::env::var("USERNAME")
                .ok()
                .filter(|v| name_valid(v))
                .unwrap_or_else(|| "本机用户".into()),
            revision: revision(&store)?,
            policy: store.policy,
            shortcuts: store.shortcuts,
            runtime: self.status.read().await.clone(),
        })
    }
    async fn commit(&self, expected: &str, candidate: Store) -> Result<()> {
        candidate.validate()?;
        let mut current = self.store.lock().await;
        if revision(&current)? != expected {
            return Err(error("首页数据已变化，请刷新后重新操作"));
        }
        save_json(&self.root.join("workspace.json"), &candidate).await?;
        *current = candidate;
        Ok(())
    }
    pub async fn policy(
        &self,
        key: &str,
        enabled: bool,
        consent: bool,
        app: &tauri::AppHandle,
    ) -> Result<Snapshot> {
        if !consent {
            return Err(error("请逐项确认游戏控制策略"));
        }
        let _guard = self.serial.lock().await;
        let mut store = self.store.lock().await.clone();
        let before = revision(&store)?;
        let previous = store.clone();
        self.ensure_worker(app).await?;
        // 配置持久化后发送完整状态；发送失败时保留可见错误，不伪装为已生效。
        match key {
            "autoGameMode" => store.policy.auto_game_mode = enabled,
            "disableWinInGame" => store.policy.disable_win_in_game = enabled,
            _ => return Err(error("未知游戏控制策略")),
        }
        self.commit(&before, store).await?;
        if let Err(cause) = self.configure_worker(app, None, false).await {
            let current = revision(&*self.store.lock().await)?;
            if self.commit(&current, previous).await.is_err() {
                return Err(error(format!(
                    "{cause}；策略回滚失败，请关闭控制并检查恢复记录"
                )));
            }
            let _ = self.configure_worker(app, None, false).await;
            return Err(cause);
        }
        self.snapshot().await
    }
    pub async fn manual(
        &self,
        enabled: bool,
        consent: bool,
        app: &tauri::AppHandle,
    ) -> Result<Snapshot> {
        if !consent {
            return Err(error("请确认游戏模式操作"));
        }
        let _guard = self.serial.lock().await;
        self.ensure_worker(app).await?;
        self.configure_worker(app, Some(enabled), false).await?;
        self.snapshot().await
    }
    pub async fn shutdown(&self) -> Result<()> {
        if let Some(task) = self.watch.lock().await.take() {
            task.abort();
            let _ = task.await;
        }
        self.worker.stop().await
    }
}
/// 所有本地缓存也按流式上限读取，不能先分配整个文件再验证大小。
async fn read_limited(path: &Path, limit: usize) -> Result<Vec<u8>> {
    use tokio::io::AsyncReadExt;
    crate::services::tools::check_local_path(path).await?;
    let file = tokio::fs::File::open(path)
        .await
        .map_err(|_| error("缓存未生成或不可读取"))?;
    let mut bytes = Vec::new();
    file.take(limit as u64 + 1)
        .read_to_end(&mut bytes)
        .await
        .map_err(io_error)?;
    if bytes.len() > limit {
        return Err(error("缓存超过大小限制"));
    }
    Ok(bytes)
}
fn allowed_url(url: &reqwest::Url) -> bool {
    url.scheme() == "https"
        && url.port_or_known_default() == Some(443)
        && matches!(
            url.host_str(),
            Some("api.github.com" | "v1.hitokoto.cn" | "picsum.photos" | "fastly.picsum.photos")
        )
        && url.username().is_empty()
        && url.password().is_none()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn executable_and_store_boundary() {
        for path in ["C:/Games/game.exe", "D:/游戏/start.exe"] {
            assert!(exe_path_valid(path));
        }
        for path in [
            "game.exe",
            "D:game.exe",
            "\\\\host\\game.exe",
            "D:/../game.exe",
            "D:/run.cmd",
            "D:/x.exe:ads",
        ] {
            assert!(!exe_path_valid(path));
        }
        let row = Shortcut {
            id: uuid::Uuid::new_v4().to_string(),
            name: "游戏".into(),
            path: "D:/游戏/start.exe".into(),
            is_game: true,
            last_launched: None,
            managed_game: false,
        };
        assert!(
            Store {
                shortcuts: vec![row.clone(), row],
                ..Store::default()
            }
            .validate()
            .is_err()
        );
    }
    #[test]
    fn network_boundary_does_not_allow_arbitrary_redirects() -> Result<()> {
        for url in [
            "http://picsum.photos",
            "https://127.0.0.1",
            "https://api.github.com:444",
            "https://picsum.photos.evil.test",
        ] {
            assert!(!allowed_url(
                &reqwest::Url::parse(url).map_err(|_| error("测试 URL 无效"))?
            ));
        }
        Ok(())
    }
    #[tokio::test]
    async fn persisted_order_and_revision_never_accept_stale_or_missing_ids() -> Result<()> {
        let project = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .ok_or_else(|| error("测试项目路径无效"))?;
        let root = project
            .join(".cache/verification")
            .join(format!("home-test-{}", uuid::Uuid::new_v4()));
        let state = HomeState::new(&root)?;
        let before = state.snapshot().await?.revision;
        let mut next = Store::default();
        for name in ["一", "二"] {
            next.shortcuts.push(Shortcut {
                id: uuid::Uuid::new_v4().to_string(),
                name: name.into(),
                path: format!("D:/Games/{name}.exe"),
                is_game: true,
                last_launched: None,
                managed_game: false,
            });
        }
        state.commit(&before, next.clone()).await?;
        assert!(state.commit(&before, Store::default()).await.is_err());
        let current = state.snapshot().await?;
        let ids = current
            .shortcuts
            .iter()
            .rev()
            .map(|row| row.id.clone())
            .collect::<Vec<_>>();
        assert!(
            state
                .reorder(&[ids[0].clone(), ids[0].clone()], &current.revision)
                .await
                .is_err()
        );
        state.reorder(&ids, &current.revision).await?;
        drop(state);
        let reloaded = HomeState::new(&root)?;
        assert_eq!(
            reloaded
                .snapshot()
                .await?
                .shortcuts
                .iter()
                .map(|row| row.id.clone())
                .collect::<Vec<_>>(),
            ids
        );
        drop(reloaded);
        ensure_local_path(&root)?;
        tokio::fs::remove_dir_all(&root).await.map_err(io_error)?;
        Ok(())
    }
}
