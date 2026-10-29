//! 向导仅主窗口可调用；系统写入使用扫描得到的标识、逐项确认和统一关键任务锁。
use crate::{
    error::AppError,
    services::{
        onboarding::{Identity, Job, OnboardingState},
        settings::SettingsState,
        tools::{self, Result, error, save_json},
    },
};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::Manager;

#[derive(Deserialize)]
#[serde(tag = "operation", rename_all = "kebab-case", deny_unknown_fields)]
pub enum Request {
    Back {},
    Status {},
    Advance {
        step: String,
    },
    Storage {},
    StorageElevate {
        consent: bool,
    },
    PartitionPrepare {
        gib: u64,
    },
    PartitionApply {
        token: String,
        confirmation: String,
        #[serde(rename = "backupConfirmed")]
        backup_confirmed: bool,
        consent: bool,
    },
    DiskRecovery {},
    MigrationPrepare {
        drive: String,
    },
    MigrationApply {
        token: String,
        confirmation: String,
        #[serde(rename = "cleanupSource")]
        cleanup_source: bool,
        consent: bool,
    },
    MigrationRecovery {},
    Hardware {},
    Drivers {},
    DriverRecovery {},
    DriverBackups {},
    DriverApply {
        id: String,
        consent: bool,
    },
    Identity {
        #[serde(rename = "steamId")]
        steam_id: Option<String>,
    },
    SteamPick {},
    SteamPrepare {},
    SteamInstall {
        token: String,
        drive: String,
        consent: bool,
    },
    JobAcknowledge {
        consent: bool,
    },
}
fn json<T: Serialize>(value: T) -> Result<serde_json::Value> {
    serde_json::to_value(value).map_err(|_| error("向导返回结构无效"))
}
fn installation_info(mut value: serde_json::Value) -> Result<serde_json::Value> {
    let exe = std::env::current_exe().map_err(tools::io_error)?;
    value["installationPath"] = json(exe.parent().map(|path| path.to_string_lossy().into_owned()))?;
    let system = std::env::var("SystemRoot").unwrap_or_default();
    value["installedOnSystem"] = json(
        exe.to_string_lossy().get(..2).map(str::to_ascii_lowercase)
            == system.get(..2).map(str::to_ascii_lowercase),
    )?;
    Ok(value)
}
#[tauri::command]
pub async fn onboarding_execute(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, OnboardingState>,
    request: Request,
) -> std::result::Result<serde_json::Value, AppError> {
    if window.label() != "main" {
        return Err(error("辅助窗口没有首次启动管理权限"));
    }
    let app = window.app_handle().clone();
    match request {
        Request::Back {} => {
            let runtime = app.state::<tools::ToolsState>().runtimes.snapshot().await;
            if matches!(state.job.lock().await.phase.as_str(), "running" | "unknown")
                || matches!(
                    runtime.phase.as_str(),
                    "downloading" | "verifying" | "installing" | "unknown"
                )
            {
                return Err(error("请先完成或核实当前操作"));
            }
            json(state.back().await?)
        }
        Request::MigrationPrepare { drive } => {
            crate::services::onboarding::migration::prepare(&app, drive).await
        }
        Request::MigrationApply {
            token,
            confirmation,
            cleanup_source,
            consent,
        } => {
            crate::services::onboarding::migration::apply(
                &app,
                token,
                confirmation,
                cleanup_source,
                consent,
            )
            .await?;
            json(())
        }
        Request::MigrationRecovery {} => {
            let bytes = tokio::fs::read(state.root.join("migration-recovery.json"))
                .await
                .map_err(|_| error("尚未生成迁移恢复记录"))?;
            if bytes.len() > 8192 {
                return Err(error("迁移恢复位置无效"));
            }
            let path: std::path::PathBuf =
                serde_json::from_slice(&bytes).map_err(|_| error("迁移恢复位置无效"))?;
            tools::check_local_path(&path).await?;
            use tauri_plugin_opener::OpenerExt;
            app.opener()
                .open_path(path.to_string_lossy().into_owned(), None::<&str>)
                .map_err(|_| error("恢复目录无法打开"))?;
            json(())
        }
        Request::StorageElevate { consent } => {
            installation_info(crate::services::onboarding::disk::elevated(&app, consent).await?)
        }
        Request::PartitionPrepare { gib } => {
            crate::services::onboarding::disk::prepare(&state, gib).await
        }
        Request::PartitionApply {
            token,
            confirmation,
            backup_confirmed,
            consent,
        } => json(
            crate::services::onboarding::disk::apply(
                &app,
                token,
                confirmation,
                backup_confirmed,
                consent,
            )
            .await?,
        ),
        Request::DiskRecovery {} => {
            let system = std::path::PathBuf::from(
                std::env::var_os("SystemRoot").ok_or_else(|| error("Windows 目录不可用"))?,
            )
            .join("System32");
            let mut command = tokio::process::Command::new(system.join("mmc.exe"));
            command.arg(system.join("diskmgmt.msc"));
            #[cfg(windows)]
            command.creation_flags(0x0800_0000);
            command.spawn().map_err(|_| error("磁盘管理无法打开"))?;
            json(())
        }
        Request::Status {} => json(
            serde_json::json!({"progress":state.progress.lock().await.clone(),"job":state.job.lock().await.clone(),"restrictedMode":crate::storage_policy::restricted_to_d()}),
        ),
        Request::JobAcknowledge { consent } => {
            if !consent {
                return Err(error("请先在 Windows 中核实上次操作结果"));
            }
            let _guard = state.serial.lock().await;
            let mut job = state.job.lock().await.clone();
            if job.phase != "unknown" && job.phase != "failed" {
                return Err(error("当前没有需要核实的失败操作"));
            }
            job.phase = "acknowledged".into();
            job.message = "已由用户确认检查系统实际状态；没有自动重放操作。".into();
            save_json(&state.root.join("job.json"), &job).await?;
            *state.job.lock().await = job.clone();
            json(job)
        }
        Request::Advance { step } => {
            let runtime = app.state::<tools::ToolsState>().runtimes.snapshot().await;
            if matches!(state.job.lock().await.phase.as_str(), "running" | "unknown")
                || matches!(
                    runtime.phase.as_str(),
                    "downloading" | "verifying" | "installing" | "unknown"
                )
            {
                return Err(error("请等待当前操作完成或确认其实际结果后继续"));
            }
            json(state.advance(&step).await?)
        }
        Request::SteamPrepare {} => crate::services::onboarding::installers::prepare(&app).await,
        Request::SteamInstall {
            token,
            drive,
            consent,
        } => json(
            crate::services::onboarding::installers::install(&app, token, drive, consent).await?,
        ),
        Request::Storage {} => {
            let cached = state.storage.lock().await.clone().filter(|v| {
                v["expiresAt"]
                    .as_i64()
                    .is_some_and(|until| until > chrono::Utc::now().timestamp_millis())
            });
            let value = if let Some(cached) = cached {
                cached["public"].clone()
            } else {
                state
                    .platform("storage", &[], Duration::from_secs(45))
                    .await?
            };
            installation_info(value)
        }
        Request::Hardware {} => {
            let hardware = app.state::<crate::services::hardware::Hardware>();
            hardware.start().await?;
            for _ in 0..90 {
                let snapshot = hardware.read().await;
                if !snapshot.devices.is_empty() {
                    save_json(&state.root.join("hardware.json"), &snapshot.devices).await?;
                    return json(snapshot.devices);
                }
                tokio::time::sleep(Duration::from_millis(500)).await;
            }
            Err(error("硬件扫描未完成，请重试或稍后在硬件页检查"))
        }
        Request::Drivers {} => {
            if crate::storage_policy::restricted_to_d() {
                return state
                    .platform("gpu-info", &[], Duration::from_secs(30))
                    .await;
            }
            let value = state
                .platform("drivers", &[], Duration::from_secs(300))
                .await?;
            save_json(&state.root.join("drivers.json"), &value).await?;
            *state.drivers.lock().await = Some(value.clone());
            Ok(value)
        }
        Request::DriverRecovery {} => {
            let system = std::path::PathBuf::from(
                std::env::var_os("SystemRoot").ok_or_else(|| error("Windows 目录不可用"))?,
            )
            .join("System32");
            let mut command = tokio::process::Command::new(system.join("mmc.exe"));
            command.arg(system.join("devmgmt.msc"));
            #[cfg(windows)]
            command.creation_flags(0x0800_0000);
            command.spawn().map_err(|_| error("设备管理器无法打开"))?;
            json(())
        }
        Request::DriverBackups {} => {
            let path = state.root.join("driver-backups");
            tools::check_local_path(&path).await?;
            if !tokio::fs::try_exists(&path)
                .await
                .map_err(tools::io_error)?
            {
                return Err(error("尚未生成驱动备份"));
            }
            use tauri_plugin_opener::OpenerExt;
            app.opener()
                .open_path(path.to_string_lossy().into_owned(), None::<&str>)
                .map_err(|_| error("驱动备份目录无法打开"))?;
            json(())
        }
        Request::DriverApply { id, consent } => {
            if crate::storage_policy::restricted_to_d() {
                return Err(error("开发验收模式禁止实际安装显卡驱动"));
            }
            if matches!(state.job.lock().await.phase.as_str(), "running" | "unknown") {
                return Err(error("请先核实上次系统操作的结果"));
            }
            if !consent {
                return Err(error("必须逐项确认驱动更新、许可与恢复方式"));
            }
            uuid::Uuid::parse_str(&id).map_err(|_| error("驱动标识无效"))?;
            let cached = state
                .drivers
                .lock()
                .await
                .clone()
                .ok_or_else(|| error("请先扫描显卡驱动"))?;
            let revision = cached["updates"]
                .as_array()
                .and_then(|rows| rows.iter().find(|row| row["id"].as_str() == Some(&id)))
                .and_then(|row| row["revision"].as_u64())
                .ok_or_else(|| error("驱动不属于本次扫描结果"))?;
            let settings = app.state::<SettingsState>();
            let _critical = crate::services::settings::runtime::Critical::acquire(&settings)?;
            let _serial = state.serial.lock().await;
            *state.job.lock().await = Job {
                phase: "running".into(),
                kind: "driver".into(),
                message: "正在等待管理员授权并由 Windows Update 下载、安装；请勿断电。".into(),
                restart_required: false,
            };
            save_json(&state.root.join("job.json"), &*state.job.lock().await).await?;
            let result = state
                .platform(
                    "driver-apply",
                    &[
                        id,
                        revision.to_string(),
                        state.root.to_string_lossy().into_owned(),
                    ],
                    Duration::from_secs(3600),
                )
                .await;
            let job = match result {
                Ok(value) => Job {
                    phase: "complete".into(),
                    kind: "driver".into(),
                    message: value["message"].as_str().unwrap_or("驱动操作已结束").into(),
                    restart_required: value["restartRequired"].as_bool().unwrap_or(false),
                },
                Err(cause) => Job {
                    phase: "unknown".into(),
                    kind: "driver".into(),
                    message: cause.to_string(),
                    restart_required: false,
                },
            };
            save_json(&state.root.join("job.json"), &job).await?;
            *state.job.lock().await = job.clone();
            json(job)
        }
        Request::SteamPick {} => {
            use tauri_plugin_dialog::DialogExt;
            let selected = tauri::async_runtime::spawn_blocking(move || {
                app.dialog()
                    .file()
                    .set_title("选择 Steam 安装目录（包含 steam.exe）")
                    .blocking_pick_folder()
            })
            .await
            .map_err(|_| error("目录选择器无法打开"))?;
            if let Some(folder) = selected {
                let path = folder.into_path().map_err(|_| error("Steam 目录无效"))?;
                let checked = path.clone();
                tauri::async_runtime::spawn_blocking(move || {
                    crate::storage_policy::validate_local_path(&checked, false)
                })
                .await
                .map_err(|_| error("Steam 目录校验任务失败"))?
                .map_err(|_| error("Steam 目录不是安全的本地路径"))?;
                if !tokio::fs::metadata(path.join("steam.exe"))
                    .await
                    .is_ok_and(|value| value.is_file())
                {
                    return Err(error("此目录不含 steam.exe"));
                }
                save_json(
                    &state
                        .root
                        .parent()
                        .ok_or_else(|| error("档案目录无效"))?
                        .join("steam/location.json"),
                    &path,
                )
                .await?;
            }
            json(())
        }
        Request::Identity { steam_id } => {
            let _serial = state.serial.lock().await;
            let mut progress = state.progress.lock().await.clone();
            if !progress.complete && progress.stage != "identity" {
                return Err(error("请先完成向导前面的步骤"));
            }
            progress.identity = if let Some(id) = steam_id {
                let steam = app.state::<crate::services::steam::SteamState>();
                let snapshot = steam.refresh(true).await?;
                let account = snapshot
                    .accounts
                    .iter()
                    .find(|account| account.id == id)
                    .ok_or_else(|| {
                        error("账号不属于本机 Steam 记录，请在 Steam 客户端登录后刷新")
                    })?;
                let name = if account.name.is_empty() {
                    &account.account_name
                } else {
                    &account.name
                };
                Some(Identity {
                    steam_id: id,
                    name: name.chars().filter(|c| !c.is_control()).take(40).collect(),
                })
            } else {
                None
            };
            progress.complete = true;
            progress.completed.insert("identity".into());
            progress.stage = "done".into();
            json(state.persist(progress).await?)
        }
    }
}
