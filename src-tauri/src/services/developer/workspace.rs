//! 开发工作区仅接受原生选择的空目录或本应用已登记的工作区，不接收命令、仓库或分支参数。
use crate::services::tools::{Result, error, io_error, platform, save_json};
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    time::{Duration, Instant},
};
use tauri::Manager;
use tokio::{io::AsyncReadExt, sync::Mutex};

pub const BRANCH: &str = "codex/develop";
pub const REPOSITORY: &str = "https://github.com/surgar04/m78deguren.git";
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Phase {
    Idle,
    Selected,
    Preparing,
    Ready,
    ActionRequired,
    Failed,
    Cancelled,
    Deferred,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Status {
    pub phase: Phase,
    pub message: String,
    pub root: Option<String>,
    pub branch: String,
    pub commit: Option<String>,
    pub prompt_required: bool,
    pub ticket: Option<String>,
}
impl Default for Status {
    fn default() -> Self {
        Self {
            phase: Phase::Idle,
            message: "选择一个空目录，准备源码和隔离的开发环境".into(),
            root: None,
            branch: BRANCH.into(),
            commit: None,
            prompt_required: true,
            ticket: None,
        }
    }
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Receipt {
    build: String,
    root: Option<String>,
    complete: bool,
    deferred: bool,
    commit: Option<String>,
}
struct Selection {
    path: PathBuf,
    ticket: String,
    created: Instant,
}
pub struct WorkspaceState {
    directory: PathBuf,
    status: Mutex<Status>,
    selection: Mutex<Option<Selection>>,
    running: Mutex<Option<PathBuf>>,
    pub serial: Mutex<()>,
}

/// 目录拥有权标记只用于保护用户文件，不用于开发者身份授权。
pub async fn validate_directory(path: &Path) -> Result<()> {
    crate::services::tools::check_local_path(path).await?;
    crate::storage_policy::validate_data_root(path).map_err(io_error)?;
    if path.as_os_str().to_string_lossy().len() > 180 {
        return Err(error("工作区路径过长，请选择较短目录"));
    }
    let mut entries = tokio::fs::read_dir(path).await.map_err(io_error)?;
    let empty = entries.next_entry().await.map_err(io_error)?.is_none();
    if !empty {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Marker {
            repository: String,
            branch: String,
        }
        let marker = read_bounded(&path.join(".zhenjing-workspace.json"), 2048).await?;
        let marker: Marker =
            serde_json::from_slice(&marker).map_err(|_| error("请选择空目录，不覆盖已有文件"))?;
        if marker.repository != REPOSITORY || marker.branch != BRANCH {
            return Err(error("该目录不属于臻境开发工作区"));
        }
    }
    Ok(())
}
async fn read_bounded(path: &Path, maximum: u64) -> Result<Vec<u8>> {
    crate::services::tools::check_local_path(path).await?;
    let mut bytes = vec![];
    tokio::fs::File::open(path)
        .await
        .map_err(io_error)?
        .take(maximum + 1)
        .read_to_end(&mut bytes)
        .await
        .map_err(io_error)?;
    if bytes.len() as u64 > maximum {
        return Err(error("开发工作区状态超过大小限制"));
    }
    Ok(bytes)
}
impl WorkspaceState {
    pub async fn is_running(&self) -> bool {
        self.running.lock().await.is_some()
    }
    pub fn new(root: &Path) -> Self {
        Self {
            directory: root.join("settings"),
            status: Mutex::new(Status::default()),
            selection: Mutex::new(None),
            running: Mutex::new(None),
            serial: Mutex::new(()),
        }
    }
    pub async fn snapshot(&self) -> Result<Status> {
        let mut status = self.status.lock().await;
        if matches!(status.phase, Phase::Idle)
            && let Ok(bytes) =
                read_bounded(&self.directory.join("developer-workspace.json"), 4096).await
            && let Ok(receipt) = serde_json::from_slice::<Receipt>(&bytes)
            && receipt.build == super::build_version()
        {
            let present = if let Some(root) = receipt.root.as_ref() {
                validate_directory(Path::new(root)).await.is_ok()
                    && tokio::fs::metadata(Path::new(root).join("source/.git/HEAD"))
                        .await
                        .is_ok()
            } else {
                false
            };
            let complete = receipt.complete && present;
            status.root = receipt.root;
            status.commit = receipt.commit;
            status.prompt_required = !(complete || receipt.deferred);
            status.phase = if complete {
                Phase::Ready
            } else if receipt.deferred {
                Phase::Deferred
            } else {
                Phase::Idle
            };
            status.message = if complete {
                "开发环境已准备，可打开工作区"
            } else {
                "可随时继续准备开发工作区"
            }
            .into();
        }
        Ok(status.clone())
    }
    async fn remember(&self, status: &Status, deferred: bool) -> Result<()> {
        save_json(
            &self.directory.join("developer-workspace.json"),
            &Receipt {
                build: super::build_version(),
                root: status.root.clone(),
                complete: matches!(status.phase, Phase::Ready),
                deferred,
                commit: status.commit.clone(),
            },
        )
        .await
    }
    pub async fn select(&self, path: PathBuf) -> Result<Status> {
        if self.running.lock().await.is_some() {
            return Err(error("工作区准备中，请先取消或等待完成"));
        }
        validate_directory(&path).await?;
        let ticket = uuid::Uuid::new_v4().to_string();
        *self.selection.lock().await = Some(Selection {
            path: path.clone(),
            ticket: ticket.clone(),
            created: Instant::now(),
        });
        let status = Status { phase: Phase::Selected, root: Some(path.to_string_lossy().into_owned()), ticket: Some(ticket), message: "将从固定仓库的 codex/develop 拉取源码，按锁文件安装项目内工具和依赖；已有修改不会被覆盖".into(), ..Status::default() };
        *self.status.lock().await = status.clone();
        Ok(status)
    }
    pub async fn defer(&self) -> Result<Status> {
        if self.running.lock().await.is_some() {
            return Err(error("请先取消正在执行的准备任务"));
        }
        let mut status = self.status.lock().await;
        *self.selection.lock().await = None;
        status.ticket = None;
        status.prompt_required = false;
        status.phase = Phase::Deferred;
        self.remember(&status, true).await?;
        Ok(status.clone())
    }
    pub async fn cancel(&self) -> Result<()> {
        if let Some(path) = self.running.lock().await.as_ref() {
            save_json(&path.join("cancel.json"), &true).await?;
        }
        Ok(())
    }
    pub async fn start(
        &self,
        app: &tauri::AppHandle,
        ticket: &str,
        consent: bool,
    ) -> Result<Status> {
        if !consent {
            return Err(error("请确认源码目录及开发环境准备计划"));
        }
        if self.running.lock().await.is_some() {
            return Err(error("已有工作区任务正在执行"));
        }
        let selection = self
            .selection
            .lock()
            .await
            .take()
            .ok_or_else(|| error("请先选择工作区目录"))?;
        if selection.ticket != ticket || selection.created.elapsed() > Duration::from_secs(600) {
            return Err(error("目录选择已过期，请重新选择"));
        }
        validate_directory(&selection.path).await?;
        let task = self
            .directory
            .join("developer-tasks")
            .join(uuid::Uuid::new_v4().to_string());
        crate::services::tools::check_local_path(&task).await?;
        tokio::fs::create_dir_all(&task).await.map_err(io_error)?;
        *self.running.lock().await = Some(task.clone());
        let status = Status {
            phase: Phase::Preparing,
            ticket: None,
            message: "正在准备便携 Git 并获取开发分支…".into(),
            ..self.status.lock().await.clone()
        };
        *self.status.lock().await = status.clone();
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let state = app.state::<WorkspaceState>();
            let args = vec![
                selection.path.to_string_lossy().into_owned(),
                task.to_string_lossy().into_owned(),
                std::process::id().to_string(),
            ];
            let work = platform::run_embedded(
                &task,
                "developer-workspace",
                &args,
                Duration::from_secs(7200),
                include_str!("workspace.ps1"),
            );
            tokio::pin!(work);
            let result = loop {
                tokio::select! {
                    result = &mut work => break result,
                    _ = tokio::time::sleep(Duration::from_secs(1)) => {
                        if !super::enabled() { let _ = state.cancel().await; break Err(error("开发者身份已失效，已停止准备任务")); }
                    }
                }
            };
            if result.is_err() {
                let _ = state.cancel().await;
            }
            let mut status = state.status.lock().await;
            match result.and_then(|value| {
                serde_json::from_value::<Report>(value).map_err(|_| error("工作区返回格式无效"))
            }) {
                Ok(report) => {
                    status.phase = report.phase;
                    status.message = report.message.chars().take(1024).collect();
                    status.commit = report.commit;
                    status.prompt_required = !matches!(status.phase, Phase::Ready);
                }
                Err(cause) => {
                    status.phase = Phase::Failed;
                    status.message = cause.to_string();
                }
            }
            let _ = state.remember(&status, false).await;
            *state.running.lock().await = None;
        });
        Ok(status)
    }
    pub async fn progress(&self) -> Result<Status> {
        let mut status = self.snapshot().await?;
        if let Some(task) = self.running.lock().await.as_ref()
            && let Ok(bytes) = read_bounded(&task.join("progress.json"), 4096).await
            && let Ok(report) = serde_json::from_slice::<Report>(&bytes)
        {
            status.message = report.message.chars().take(1024).collect();
        }
        Ok(status)
    }
    pub async fn open(&self, app: &tauri::AppHandle, logs: bool) -> Result<()> {
        use tauri_plugin_opener::OpenerExt;
        let status = self.snapshot().await?;
        let root = PathBuf::from(status.root.ok_or_else(|| error("尚未选择工作区"))?);
        validate_directory(&root).await?;
        let target = if logs {
            root.join(".zhenjing-setup")
        } else {
            root.join("source")
        };
        crate::services::tools::check_local_path(&target).await?;
        app.opener()
            .open_path(target.to_string_lossy().into_owned(), None::<&str>)
            .map_err(|_| error("无法打开工作区目录"))
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Report {
    phase: Phase,
    message: String,
    commit: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn only_empty_or_managed_directories_are_accepted()
    -> std::result::Result<(), Box<dyn std::error::Error>> {
        let root = tempfile::tempdir_in(std::env::var_os("TEMP").ok_or("missing TEMP")?)?;
        validate_directory(root.path()).await?;
        tokio::fs::write(root.path().join("important.txt"), b"keep").await?;
        assert!(validate_directory(root.path()).await.is_err());
        assert_eq!(
            tokio::fs::read(root.path().join("important.txt")).await?,
            b"keep"
        );
        save_json(
            &root.path().join(".zhenjing-workspace.json"),
            &serde_json::json!({"repository":REPOSITORY,"branch":BRANCH}),
        )
        .await?;
        validate_directory(root.path()).await?;
        assert!(
            serde_json::from_str::<Report>(
                r#"{"phase":"ready","message":"ok","commit":null,"command":"execute"}"#
            )
            .is_err()
        );
        Ok(())
    }
}
