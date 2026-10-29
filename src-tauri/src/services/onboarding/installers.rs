//! Steam 安装器仅来自官方固定地址，先校验 Valve 签名，再使用一次性票据执行。
use super::{Job, OnboardingState};
use crate::services::tools::{
    self, Result, ToolsState, downloads::DownloadInput, error, save_json,
};
use std::{path::PathBuf, time::Duration};
use tauri::Manager;
pub struct SteamPackage {
    pub token: String,
    pub path: PathBuf,
    pub hash: String,
    pub created: std::time::Instant,
}

pub async fn prepare(app: &tauri::AppHandle) -> Result<serde_json::Value> {
    let state = app.state::<OnboardingState>();
    let _serial = state.serial.lock().await;
    if matches!(state.job.lock().await.phase.as_str(), "running" | "unknown") {
        return Err(error("请先核实上次操作结果"));
    }
    let tools = app.state::<ToolsState>();
    let mut job = Job {
        phase: "running".into(),
        kind: "steam-download".into(),
        message: "正在从 Steam 官方服务器下载安装器并验证 Valve 签名。".into(),
        restart_required: false,
    };
    *state.job.lock().await = job.clone();
    save_json(&state.root.join("job.json"), &job).await?;
    let result = async {
        let id = tools
            .downloads
            .create(
                DownloadInput {
                    url: "https://cdn.fastly.steamstatic.com/client/installer/SteamSetup.exe"
                        .into(),
                    file_name: format!("SteamSetup-{}.exe", uuid::Uuid::new_v4()),
                    connections: 1,
                    limit_kib: 0,
                    expected_sha256: None,
                },
                tools.http.clone(),
            )
            .await?;
        let start = std::time::Instant::now();
        loop {
            let task = tools.downloads.task(&id).await?;
            return match task.status.as_str() {
                "complete" => {
                    let path = tools.downloads.final_path(&task);
                    let signature = tools::platform::run(
                        &tools.root,
                        "signature",
                        &[path.to_string_lossy().into_owned()],
                        Duration::from_secs(60),
                    )
                    .await?;
                    let publisher = signature["subject"].as_str().unwrap_or_default();
                    if signature["valid"].as_bool() != Some(true)
                        || !publisher.split(',').any(|field| {
                            matches!(field.trim(), "O=Valve Corp." | "O=Valve Corporation")
                        })
                    {
                        return Err(error("Steam 安装器未通过有效 Valve 签名验证，禁止执行"));
                    }
                    let token = uuid::Uuid::new_v4().to_string();
                    let hash = task
                        .sha256
                        .ok_or_else(|| error("Steam 安装器缺少 SHA256"))?;
                    *state.steam_package.lock().await = Some(SteamPackage {
                        token: token.clone(),
                        path,
                        hash,
                        created: std::time::Instant::now(),
                    });
                    Ok(serde_json::json!({"token":token,"publisher":publisher}))
                }
                "failed" | "cancelled" | "paused" => Err(error(task.message)),
                _ => {
                    if start.elapsed() > Duration::from_secs(1800) {
                        let _ = tools
                            .downloads
                            .control(&id, "pause", tools.http.clone())
                            .await;
                        return Err(error("Steam 下载超时，已请求暂停；可以稍后重试。"));
                    }
                    tokio::time::sleep(Duration::from_millis(500)).await;
                    continue;
                }
            };
        }
    }
    .await;
    match &result {
        Ok(_) => {
            job.phase = "ready".into();
            job.message = "官方安装器已验证；选择安装盘并确认后才运行。".into()
        }
        Err(cause) => {
            job.phase = "failed".into();
            job.message = cause.to_string()
        }
    }
    save_json(&state.root.join("job.json"), &job).await?;
    *state.job.lock().await = job;
    result
}
pub async fn install(
    app: &tauri::AppHandle,
    token: String,
    drive: String,
    consent: bool,
) -> Result<Job> {
    if crate::storage_policy::restricted_to_d() {
        return Err(error("开发验收模式禁止实际安装 Steam"));
    }
    if !consent || drive.len() != 1 || !drive.bytes().all(|b| b.is_ascii_uppercase()) {
        return Err(error("请选择有效磁盘并确认 Steam 安装"));
    }
    let state = app.state::<OnboardingState>();
    let _serial = state.serial.lock().await;
    if matches!(state.job.lock().await.phase.as_str(), "running" | "unknown") {
        return Err(error("请先核实上次操作结果"));
    }
    let settings = app.state::<crate::services::settings::SettingsState>();
    let _critical = crate::services::settings::runtime::Critical::acquire(&settings)?;
    let package = state
        .steam_package
        .lock()
        .await
        .take()
        .ok_or_else(|| error("请重新准备 Steam 官方安装器"))?;
    if package.token != token || package.created.elapsed() > Duration::from_secs(900) {
        return Err(error("Steam 安装票据无效"));
    }
    let target = PathBuf::from(format!("{drive}:\\Steam"));
    tools::check_local_path(&target).await?;
    tools::check_local_path(&package.path).await?;
    let locked = package.path.clone();
    // 校验到安装器退出期间禁止改写或删除文件，覆盖 UAC 等待造成的时间窗口。
    let _guard = tauri::async_runtime::spawn_blocking(move || {
        let mut options = std::fs::OpenOptions::new();
        options.read(true);
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            options.share_mode(1);
        }
        options.open(locked).map_err(tools::io_error)
    })
    .await
    .map_err(|_| error("Steam 安装器锁定任务失败"))??;
    let mut job = Job {
        phase: "running".into(),
        kind: "steam-install".into(),
        message: "正在安装 Steam；首次客户端更新及 Steam 登录由官方客户端完成。".into(),
        restart_required: false,
    };
    *state.job.lock().await = job.clone();
    save_json(&state.root.join("job.json"), &job).await?;
    let result = state
        .platform(
            "steam-install",
            &[
                package.path.to_string_lossy().into_owned(),
                package.hash,
                target.to_string_lossy().into_owned(),
            ],
            Duration::from_secs(1800),
        )
        .await;
    match result {
        Ok(_) => {
            job.phase = "complete".into();
            job.message = "Steam 安装已完成。".into();
            save_json(
                &state
                    .root
                    .parent()
                    .ok_or_else(|| error("档案目录无效"))?
                    .join("steam/location.json"),
                &target,
            )
            .await?;
        }
        Err(cause) => {
            job.phase = "unknown".into();
            job.message = cause.to_string();
        }
    }
    save_json(&state.root.join("job.json"), &job).await?;
    *state.job.lock().await = job.clone();
    Ok(job)
}
