//! 数据重置和应用更新由固定助手等待宿主退出后执行；不在 WebView 使用中删除配置。
use crate::services::tools::{Result, error, io_error, platform};
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    time::{Duration, Instant},
};
use tokio::sync::Mutex;

#[derive(Default)]
pub struct Maintenance {
    lease: Mutex<Option<Prepared>>,
}
struct Prepared {
    token: String,
    created: Instant,
    id: String,
    restore: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    token: String,
    expires_in_seconds: u64,
    data_root: String,
    backup_root: String,
    bytes: u64,
    restore: bool,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Backup {
    pub id: String,
    pub created_at: f64,
    pub path: String,
    pub data_root: String,
    pub state: String,
    pub message: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub ticket: String,
    pub kind: String,
    pub owner: u32,
    pub exe: PathBuf,
    pub data_root: PathBuf,
    pub control: PathBuf,
    pub restore_id: Option<String>,
    pub source: Option<PathBuf>,
    pub sha256: Option<String>,
    pub bytes: Option<u64>,
    pub version: Option<String>,
    pub lock_file: PathBuf,
    /// 助手自身在隔离目录运行，重启应用时恢复父进程的用户环境，避免污染外部游戏/Steam。
    pub launch_environment: std::collections::BTreeMap<String, String>,
}
pub fn launch_environment() -> std::collections::BTreeMap<String, String> {
    ["TEMP", "TMP", "APPDATA", "LOCALAPPDATA", "USERPROFILE"]
        .into_iter()
        .filter_map(|key| std::env::var(key).ok().map(|value| (key.to_owned(), value)))
        .collect()
}
impl Maintenance {
    pub async fn prepare(&self, root: &Path, restore: Option<String>) -> Result<Preview> {
        let data = root.to_owned();
        let control =
            tauri::async_runtime::spawn_blocking(move || super::storage::control_directory(&data))
                .await
                .map_err(|_| error("维护目录检查失败"))??;
        if let Some(id) = &restore {
            uuid::Uuid::parse_str(id).map_err(|_| error("备份标识无效"))?;
            let backups = backups(root).await?;
            if !backups
                .iter()
                .any(|backup| &backup.id == id && backup.state == "completed")
            {
                return Err(error("此备份不存在或尚未完整提交"));
            }
        }
        let data = root.to_owned();
        let footprint =
            tauri::async_runtime::spawn_blocking(move || super::storage::footprint(&data))
                .await
                .map_err(|_| error("数据统计任务失败"))??;
        let id = uuid::Uuid::new_v4().to_string();
        let token = uuid::Uuid::new_v4().to_string();
        *self.lease.lock().await = Some(Prepared {
            token: token.clone(),
            created: Instant::now(),
            id: id.clone(),
            restore: restore.clone(),
        });
        Ok(Preview {
            token,
            expires_in_seconds: 600,
            data_root: root.to_string_lossy().into_owned(),
            backup_root: control
                .join(format!("backup-{id}"))
                .to_string_lossy()
                .into_owned(),
            bytes: footprint.data_bytes,
            restore: restore.is_some(),
        })
    }
    pub async fn consume(
        &self,
        root: &Path,
        token: &str,
        restore: bool,
        consent: bool,
    ) -> Result<Plan> {
        if !consent {
            return Err(error("必须确认数据维护会重启应用"));
        }
        uuid::Uuid::parse_str(token).map_err(|_| error("维护凭据无效"))?;
        let mut current = self.lease.lock().await;
        if !current.as_ref().is_some_and(|lease| {
            lease.token == token
                && lease.created.elapsed() < Duration::from_secs(600)
                && lease.restore.is_some() == restore
        }) {
            return Err(error("维护预览过期或范围已改变，请重新预览"));
        }
        let lease = current.take().ok_or_else(|| error("维护凭据已经使用"))?;
        let data = root.to_owned();
        let control =
            tauri::async_runtime::spawn_blocking(move || super::storage::control_directory(&data))
                .await
                .map_err(|_| error("维护目录检查失败"))??;
        let exe = std::env::current_exe().map_err(io_error)?;
        crate::services::tools::check_local_path(&exe).await?;
        Ok(Plan {
            ticket: lease.id,
            kind: if restore { "restore" } else { "reset" }.into(),
            owner: std::process::id(),
            exe,
            data_root: root.to_owned(),
            control,
            restore_id: lease.restore,
            source: None,
            version: None,
            sha256: None,
            bytes: None,
            lock_file: super::storage::ownership_path(root)?,
            launch_environment: launch_environment(),
        })
    }
}
pub async fn backups(root: &Path) -> Result<Vec<Backup>> {
    let data = root.to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        let control = super::storage::control_directory(&data)?;
        let mut result = Vec::new();
        for entry in std::fs::read_dir(&control).map_err(io_error)? {
            let entry = entry.map_err(io_error)?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if !name.starts_with("backup-") {
                continue;
            }
            let id = name.trim_start_matches("backup-");
            if uuid::Uuid::parse_str(id).is_err() {
                continue;
            }
            let path = entry.path();
            crate::services::tools::ensure_local_path(&path)?;
            if let Ok(bytes) = std::fs::read(path.join("manifest.json")) {
                let record: Backup = serde_json::from_slice(&bytes)
                    .map_err(|_| error("维护备份清单损坏，未尝试恢复"))?;
                if record.id != id || record.path != path.to_string_lossy() {
                    return Err(error("维护备份身份不匹配"));
                }
                if record.data_root != data.to_string_lossy() {
                    continue;
                }
                result.push(record);
            }
        }
        result.sort_by(|a, b| b.created_at.total_cmp(&a.created_at));
        result.truncate(30);
        Ok(result)
    })
    .await
    .map_err(|_| error("备份枚举任务失败"))?
}
pub async fn launch(app: &tauri::AppHandle, plan: Plan) -> Result<()> {
    let ready = plan.control.join(format!("{}.helper-ready", plan.ticket));
    let args = vec![serde_json::to_string(&plan).map_err(|_| error("维护计划序列化失败"))?];
    let mut child = platform::spawn_embedded(
        &plan.control,
        "settings-maintenance",
        &args,
        include_str!("maintenance.ps1"),
    )
    .await?;
    let started = Instant::now();
    loop {
        if tokio::fs::try_exists(&ready).await.map_err(io_error)? {
            break;
        }
        if child.try_wait().map_err(io_error)?.is_some() {
            return Err(error("维护助手未通过启动检查，当前数据和程序未改动"));
        }
        if started.elapsed() > Duration::from_secs(12) {
            let _ = child.kill().await;
            return Err(error("维护助手未就绪，未退出应用"));
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    // 助手已经持有自身源码的只读锁。它等待本 PID 退出后才动目录/EXE。
    app.exit(0);
    Ok(())
}
pub async fn mark_boot_ready(root: &Path) -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let Some(index) = args
        .iter()
        .position(|argument| argument == "--maintenance-ticket")
    else {
        return Ok(());
    };
    let ticket = args
        .get(index + 1)
        .ok_or_else(|| error("启动健康检查标识缺失"))?;
    uuid::Uuid::parse_str(ticket).map_err(|_| error("启动健康检查标识无效"))?;
    let data = root.to_owned();
    let directory =
        tauri::async_runtime::spawn_blocking(move || super::storage::control_directory(&data))
            .await
            .map_err(|_| error("健康检查目录验证失败"))??;
    tokio::fs::write(
        directory.join(format!("{ticket}.app-ready")),
        env!("CARGO_PKG_VERSION"),
    )
    .await
    .map_err(io_error)
}
