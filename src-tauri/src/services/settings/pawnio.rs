//! PawnIO 使用固定版本、SHA256 与有效发布者签名；准备和执行分离，绝不自动安装验收。
use crate::services::tools::{
    Result, ToolsState,
    downloads::{DownloadInput, DownloadManager},
    error, io_error, platform,
};
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::Mutex;

pub const SOURCE: &str = include_str!("native.ps1");
const URL: &str =
    "https://github.com/namazso/PawnIO.Setup/releases/download/2.2.0/PawnIO_setup.exe";
const HASH: &str = "1f519a22e47187f70a1379a48ca604981c4fcf694f4e65b734aaa74a9fba3032";
struct Prepared {
    token: String,
    path: PathBuf,
    created: Instant,
}
#[derive(Default)]
pub struct PawnService {
    prepared: Mutex<Option<Prepared>>,
    serial: Mutex<()>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PawnPrepared {
    token: String,
    expires_in_seconds: u64,
    version: &'static str,
    sha256: &'static str,
    publisher: String,
    installed: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PawnStatus {
    installed: bool,
    version: Option<String>,
    service: String,
    error: Option<String>,
}
pub async fn run(
    root: &Path,
    operation: &str,
    value: serde_json::Value,
    timeout: Duration,
) -> Result<serde_json::Value> {
    platform::run_embedded(
        root,
        operation,
        &[serde_json::to_string(&value).map_err(|_| error("原生设置参数无效"))?],
        timeout,
        SOURCE,
    )
    .await
}
pub async fn status(root: &Path) -> Result<serde_json::Value> {
    run(
        root,
        "pawn-status",
        serde_json::Value::Null,
        Duration::from_secs(30),
    )
    .await
}
impl PawnService {
    pub async fn prepare(
        &self,
        root: &Path,
        manager: Arc<DownloadManager>,
        http: reqwest::Client,
    ) -> Result<PawnPrepared> {
        let _guard = self.serial.lock().await;
        let current: PawnStatus = serde_json::from_value(status(root).await?)
            .map_err(|_| error("PawnIO 检测结构不合法"))?;
        if let Some(cause) = current.error {
            return Err(error(cause));
        }
        if current.service.len() > 200
            || current
                .version
                .as_ref()
                .is_some_and(|version| version.len() > 100)
        {
            return Err(error("PawnIO 检测字段异常"));
        }
        let cached = manager.list().await.into_iter().find(|task| {
            task.url == URL
                && task.status == "complete"
                && task.sha256.as_deref() == Some(HASH)
                && task.max_bytes == Some(3_410_960)
        });
        let id = if let Some(cached) = cached {
            cached.id
        } else {
            manager
                .create_bounded(
                    DownloadInput {
                        url: URL.into(),
                        file_name: "PawnIO-2.2.0-setup.exe".into(),
                        connections: 2,
                        limit_kib: 0,
                        expected_sha256: Some(HASH.into()),
                    },
                    http,
                    Some(3_410_960),
                )
                .await?
        };
        let started = Instant::now();
        let path = loop {
            let task = manager.task(&id).await?;
            match task.status.as_str() {
                "complete" => break manager.final_path(&task),
                "failed" | "cancelled" | "paused" => return Err(error(task.message)),
                _ => {}
            }
            if started.elapsed() > Duration::from_secs(180) {
                let _ = manager
                    .control(
                        &id,
                        "pause",
                        crate::services::tools::downloads::http_client()?,
                    )
                    .await;
                return Err(error("PawnIO 下载超时，任务已暂停"));
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        };
        let check = path.clone();
        tauri::async_runtime::spawn_blocking(move || {
            super::storage::verify_file(&check, HASH, 3_410_960)
        })
        .await
        .map_err(|_| error("PawnIO 核验任务失败"))??;
        let signature = platform::run(
            root,
            "signature",
            &[path.to_string_lossy().into_owned()],
            Duration::from_secs(45),
        )
        .await?;
        let publisher = signature["subject"].as_str().unwrap_or_default();
        if signature["valid"].as_bool() != Some(true)
            || !publisher.split(',').any(|part| part.trim() == "O=namazso")
        {
            return Err(error("PawnIO 发布者签名验证失败，禁止执行"));
        }
        let token = uuid::Uuid::new_v4().to_string();
        *self.prepared.lock().await = Some(Prepared {
            token: token.clone(),
            path,
            created: Instant::now(),
        });
        Ok(PawnPrepared {
            token,
            expires_in_seconds: 600,
            version: "2.2.0",
            sha256: HASH,
            publisher: "namazso".into(),
            installed: current.installed,
        })
    }
    pub async fn apply(
        &self,
        root: &Path,
        token: &str,
        install: bool,
        consent: bool,
    ) -> Result<serde_json::Value> {
        if !consent {
            return Err(error("必须逐项确认 PawnIO 驱动操作"));
        }
        uuid::Uuid::parse_str(token).map_err(|_| error("驱动确认凭据无效"))?;
        let _guard = self.serial.lock().await;
        let mut slot = self.prepared.lock().await;
        if !slot.as_ref().is_some_and(|item| {
            item.token == token && item.created.elapsed() < Duration::from_secs(600)
        }) {
            return Err(error("驱动确认凭据已失效，请重新准备"));
        }
        let prepared = slot.take().ok_or_else(|| error("驱动凭据已经使用"))?;
        drop(slot);
        let id = uuid::Uuid::new_v4().to_string();
        let backup = root.join("pawnio-backups").join(&id);
        crate::services::tools::check_local_path(&backup).await?;
        tokio::fs::create_dir_all(&backup).await.map_err(io_error)?;
        run(
            root,
            "pawn-apply",
            serde_json::json!({"id":id,"file":prepared.path,"backup":backup,"install":install}),
            Duration::from_secs(900),
        )
        .await
    }
}
pub async fn autostart_status(root: &Path, data: &Path) -> Result<serde_json::Value> {
    let exe = std::env::current_exe().map_err(io_error)?;
    run(
        root,
        "autostart-status",
        serde_json::json!({"exe":exe,"dataRoot":data}),
        Duration::from_secs(30),
    )
    .await
}
pub async fn autostart_set(
    tools: &ToolsState,
    data: &Path,
    enabled: bool,
    consent: bool,
) -> Result<serde_json::Value> {
    if !consent {
        return Err(error("必须确认此项开机启动变更"));
    }
    let exe = std::env::current_exe().map_err(io_error)?;
    crate::services::tools::check_local_path(&exe).await?;
    run(&tools.root,"autostart-set",serde_json::json!({"exe":exe,"dataRoot":data,"enabled":enabled,"backups":data.join("settings/autostart-backups")}),Duration::from_secs(30)).await
}
