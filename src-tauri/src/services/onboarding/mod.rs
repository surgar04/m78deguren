//! 首次启动状态由后端持久化；页面刷新不会丢失进度，也不会重放系统操作。
use crate::services::tools::{Result, ensure_local_path, error, io_error, save_json};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeSet,
    path::{Path, PathBuf},
    time::Duration,
};
use tokio::sync::Mutex;
pub mod disk;
pub mod installers;
pub mod migration;

pub const STEPS: [&str; 7] = [
    "storage",
    "migration",
    "hardware",
    "drivers",
    "runtimes",
    "steam",
    "appearance",
];
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Identity {
    pub steam_id: String,
    pub name: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Progress {
    pub version: u8,
    pub complete: bool,
    pub stage: String,
    pub completed: BTreeSet<String>,
    pub identity: Option<Identity>,
}
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Job {
    pub phase: String,
    pub kind: String,
    pub message: String,
    pub restart_required: bool,
}
pub struct OnboardingState {
    pub root: PathBuf,
    pub progress: Mutex<Progress>,
    pub serial: Mutex<()>,
    pub job: Mutex<Job>,
    pub drivers: Mutex<Option<serde_json::Value>>,
    pub steam_package: Mutex<Option<installers::SteamPackage>>,
    pub storage: Mutex<Option<serde_json::Value>>,
    pub partition: Mutex<Option<disk::Lease>>,
    pub migration: Mutex<Option<migration::Lease>>,
}
impl OnboardingState {
    pub fn new(root: &Path) -> Result<Self> {
        let directory = root.join("onboarding");
        ensure_local_path(&directory)?;
        std::fs::create_dir_all(&directory).map_err(io_error)?;
        let file = directory.join("progress.json");
        let progress = if file.exists() {
            let bytes = std::fs::read(&file).map_err(io_error)?;
            if bytes.len() > 65536 {
                return Err(error("首次启动进度文件过大，请保留原件后检查"));
            }
            let value: Progress = serde_json::from_slice(&bytes)
                .map_err(|_| error("首次启动进度损坏，请保留原件后检查"))?;
            if value.version != 1
                || !(STEPS.contains(&value.stage.as_str())
                    || matches!(value.stage.as_str(), "identity" | "done"))
                || value
                    .completed
                    .iter()
                    .any(|step| !STEPS.contains(&step.as_str()) && step != "identity")
            {
                return Err(error("首次启动进度结构无效"));
            }
            value
        } else {
            // 已有使用记录的升级用户保留原入口；全新用户必须先进入独立向导。
            let existing = root.join("settings/config.json").is_file()
                || root.join("home/shortcuts.json").is_file()
                || root.join("hardware/history").is_dir();
            Progress {
                version: 1,
                complete: existing,
                stage: if existing { "done" } else { "storage" }.into(),
                completed: BTreeSet::new(),
                identity: None,
            }
        };
        if !file.exists() {
            std::fs::write(
                &file,
                serde_json::to_vec_pretty(&progress).map_err(|_| error("向导状态编码失败"))?,
            )
            .map_err(io_error)?;
        }
        let mut job = std::fs::read(directory.join("job.json"))
            .ok()
            .filter(|v| v.len() <= 65536)
            .and_then(|v| serde_json::from_slice::<Job>(&v).ok())
            .unwrap_or_default();
        if job.phase == "running" {
            job.phase = "unknown".into();
            job.message = format!(
                "上次操作被中断，结果尚未确认；请检查系统状态，不会自动重复执行。原记录：{}",
                job.message
            );
        }
        Ok(Self {
            root: directory,
            progress: Mutex::new(progress),
            serial: Mutex::new(()),
            job: Mutex::new(job),
            drivers: Mutex::new(None),
            steam_package: Mutex::new(None),
            storage: Mutex::new(None),
            partition: Mutex::new(None),
            migration: Mutex::new(None),
        })
    }
    pub async fn persist(&self, value: Progress) -> Result<Progress> {
        save_json(&self.root.join("progress.json"), &value).await?;
        *self.progress.lock().await = value.clone();
        Ok(value)
    }
    pub async fn advance(&self, step: &str) -> Result<Progress> {
        let _guard = self.serial.lock().await;
        let mut value = self.progress.lock().await.clone();
        if value.complete || value.stage != step {
            return Err(error("向导阶段已变化，请刷新后重试"));
        }
        let position = STEPS
            .iter()
            .position(|entry| *entry == step)
            .ok_or_else(|| error("不能跳过身份确认或未知阶段"))?;
        value.completed.insert(step.into());
        value.stage = STEPS
            .get(position + 1)
            .copied()
            .unwrap_or("identity")
            .into();
        self.persist(value).await
    }
    pub async fn back(&self) -> Result<Progress> {
        let _guard = self.serial.lock().await;
        let mut value = self.progress.lock().await.clone();
        if value.complete {
            return Err(error("向导已完成"));
        }
        let position = if value.stage == "identity" {
            STEPS.len()
        } else {
            STEPS
                .iter()
                .position(|v| *v == value.stage)
                .ok_or_else(|| error("向导阶段无效"))?
        };
        let previous = position
            .checked_sub(1)
            .and_then(|i| STEPS.get(i))
            .ok_or_else(|| error("当前已是第一步"))?;
        value.stage = (*previous).into();
        *self.partition.lock().await = None;
        *self.migration.lock().await = None;
        self.persist(value).await
    }
    pub async fn platform(
        &self,
        operation: &str,
        args: &[String],
        timeout: Duration,
    ) -> Result<serde_json::Value> {
        super::tools::platform::run_embedded(
            &self.root,
            operation,
            args,
            timeout,
            include_str!("windows.ps1"),
        )
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fresh_progress_requires_ordered_steps() -> Result<()> {
        tauri::async_runtime::block_on(async {
            let root = crate::services::tools::test_root("onboarding-progress")?;
            let state = OnboardingState::new(&root)?;
            assert!(!state.progress.lock().await.complete);
            assert!(state.advance("steam").await.is_err());
            for step in STEPS {
                state.advance(step).await?;
            }
            assert_eq!(state.progress.lock().await.stage, "identity");
            assert!(!OnboardingState::new(&root)?.progress.lock().await.complete);
            Ok(())
        })
    }
}
