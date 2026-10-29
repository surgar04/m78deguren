//! MSI 迁移使用本版本的 Ed25519 清单与完整安装包；不直接搬动已登记的 EXE。
use super::{Job, OnboardingState};
use crate::services::{
    settings::{SettingsState, update},
    tools::{
        self, Result,
        downloads::{DownloadInput, DownloadManager},
        error, io_error, save_json,
    },
};
use serde::Serialize;
use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, Instant},
};
use tauri::Manager;
use tokio::io::AsyncReadExt;
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub token: String,
    pub owner: u32,
    pub old_exe: PathBuf,
    pub old_data: PathBuf,
    pub old_lock: PathBuf,
    pub new_exe: PathBuf,
    pub new_data: PathBuf,
    pub control: PathBuf,
    pub package: PathBuf,
    pub sha256: String,
    pub version: String,
    pub product: String,
    pub launch_environment: std::collections::BTreeMap<String, String>,
    pub owned: Vec<String>,
    pub cleanup_source: bool,
}
pub struct Lease {
    pub plan: Plan,
    pub created: Instant,
}
async fn marker(folder: &Path) -> Result<String> {
    let file = tokio::fs::File::open(folder.join("zhenjing-install.ini"))
        .await
        .map_err(|_| error("当前不是可迁移的 MSI 安装；不会改动开发目录或散装 EXE"))?;
    let mut bytes = Vec::new();
    file.take(16385)
        .read_to_end(&mut bytes)
        .await
        .map_err(io_error)?;
    if bytes.len() > 16384 {
        return Err(error("MSI 安装标记过大"));
    }
    let text = if bytes.starts_with(&[0xff, 0xfe]) {
        String::from_utf16(
            &bytes[2..]
                .chunks_exact(2)
                .map(|p| u16::from_le_bytes([p[0], p[1]]))
                .collect::<Vec<_>>(),
        )
        .map_err(|_| error("MSI 标记编码错误"))?
    } else {
        String::from_utf8(bytes).map_err(|_| error("MSI 标记编码错误"))?
    };
    if !text.lines().any(|l| l.trim() == "Id=dev.zhenjing.desktop")
        || !text.lines().any(|l| l.trim() == "Format=msi")
    {
        return Err(error("MSI 安装身份不匹配"));
    }
    let id = text
        .lines()
        .find_map(|l| l.trim().strip_prefix("ProductCode="))
        .ok_or_else(|| error("MSI 产品标识缺失"))?;
    let id = uuid::Uuid::parse_str(id.trim_matches(['{', '}']))
        .map_err(|_| error("MSI 产品标识无效"))?;
    Ok(format!("{{{id}}}").to_uppercase())
}
pub async fn prepare(app: &tauri::AppHandle, drive: String) -> Result<serde_json::Value> {
    if crate::storage_policy::restricted_to_d() {
        return Err(error("开发验收禁止准备实际应用迁移"));
    }
    if drive.len() != 1 || !drive.bytes().all(|v| v.is_ascii_uppercase()) {
        return Err(error("迁移目标盘符无效"));
    }
    let state = app.state::<OnboardingState>();
    let _serial = state.serial.lock().await;
    if state.progress.lock().await.stage != "migration" {
        return Err(error("请在应用位置步骤中准备迁移"));
    }
    if matches!(state.job.lock().await.phase.as_str(), "running" | "unknown") {
        return Err(error("请先核实上次操作结果"));
    }
    let settings = app.state::<SettingsState>();
    let old_exe = std::env::current_exe().map_err(io_error)?;
    let folder = old_exe
        .parent()
        .ok_or_else(|| error("当前应用目录无效"))?
        .to_owned();
    let product = marker(&folder).await?;
    let current = old_exe.to_string_lossy();
    let system = std::env::var("SystemRoot").unwrap_or_default();
    if current.get(..2).map(str::to_ascii_lowercase) != system.get(..2).map(str::to_ascii_lowercase)
        || system
            .get(..1)
            .is_some_and(|v| v.eq_ignore_ascii_case(&drive))
    {
        return Err(error("仅迁移系统盘中的应用，目标必须为其他本地磁盘"));
    }
    let profile = settings.root.clone();
    let footprint = tauri::async_runtime::spawn_blocking(move || {
        crate::services::settings::storage::footprint(&profile)
    })
    .await
    .map_err(|_| error("迁移数据容量检查失败"))??;
    if footprint.skipped != 0 {
        return Err(error("部分数据无法读取，请检查权限后重新准备迁移"));
    }
    // 除真实数据外预留安装包、安装文件和恢复日志的空间；不能只按固定 2 GiB 判断。
    let required_bytes = footprint.data_bytes.saturating_add(2 * 1024 * 1024 * 1024);
    let location = state
        .platform(
            "migration-target",
            &[drive, required_bytes.to_string()],
            Duration::from_secs(30),
        )
        .await?;
    let base = PathBuf::from(
        location["path"]
            .as_str()
            .ok_or_else(|| error("迁移位置无效"))?,
    );
    let new_data = base.join("Data");
    let new_exe = base.join("Application/zhenjing.exe");
    tools::check_local_path(&new_data).await?;
    tools::check_local_path(&new_exe).await?;
    let control = base.join(".xinjing-maintenance");
    tools::check_local_path(&control).await?;
    tokio::fs::create_dir_all(&control)
        .await
        .map_err(io_error)?;
    let mut job = Job {
        phase: "running".into(),
        kind: "migration-download".into(),
        message: "正在验证当前版本的签名清单，并将完整 MSI 准备到目标盘。".into(),
        restart_required: false,
    };
    save_json(&state.root.join("job.json"), &job).await?;
    *state.job.lock().await = job.clone();
    let result=async {
        let url=format!("https://github.com/surgar04/m78deguren/releases/download/v{}/zhenjing-update.json",env!("CARGO_PKG_VERSION"));
        let response=settings.releases_http.get(url).send().await.map_err(|_|error("无法连接本版本发布页，请检查网络或稍后重试"))?.error_for_status().map_err(|_|error("当前版本的 Release 文件尚未发布，请先上传 MSI 和签名更新清单"))?;
        let envelope:update::Envelope=serde_json::from_slice(&update::response_bytes(response,131072).await?).map_err(|_|error("迁移清单格式无效"))?;
        let release=update::verify(&envelope)?;
        if release.version!=env!("CARGO_PKG_VERSION"){return Err(error("迁移只能使用与当前应用完全相同的版本"));}
        let manager_root=control.clone();let manager=Arc::new(tauri::async_runtime::spawn_blocking(move||DownloadManager::load(&manager_root)).await.map_err(|_|error("迁移下载器创建失败"))??);
        let id=manager.create_bounded(DownloadInput{url:release.url,file_name:format!("zhenjing-{}-migration.msi",release.version),connections:4,limit_kib:0,expected_sha256:Some(release.sha256.clone())},settings.releases_http.clone(),Some(release.bytes)).await?;
        let started=Instant::now();let package=loop{
            let task=manager.task(&id).await?;
            match task.status.as_str(){"complete"=>break manager.final_path(&task),"failed"|"cancelled"|"paused"=>return Err(error(task.message)),_=>{}}
            if started.elapsed()>Duration::from_secs(1800){let _=manager.control(&id,"pause",settings.releases_http.clone()).await;return Err(error("迁移安装包下载超时，已请求暂停；原应用未改动"));}
            tokio::time::sleep(Duration::from_millis(500)).await;
        };
        let metadata=state.platform("msi-info",&[package.to_string_lossy().into_owned()],Duration::from_secs(30)).await?;
        if metadata["product"].as_str()!=Some(&product)||metadata["version"].as_str()!=Some(env!("CARGO_PKG_VERSION"))||metadata["name"].as_str()!=Some("臻境")||metadata["manufacturer"].as_str()!=Some("Sur方糖")||metadata["upgrade"].as_str()!=Some("{C75C71A9-389D-4B49-9DD4-57D4625BD797}"){return Err(error("完整 MSI 的产品、版本或升级身份不匹配"));}
        let original=settings.root.clone();let old_lock=tauri::async_runtime::spawn_blocking(move||crate::services::settings::storage::ownership_path(&original)).await.map_err(|_|error("迁移档案锁检查失败"))??;
        let plan=Plan{token:uuid::Uuid::new_v4().to_string(),owner:std::process::id(),old_exe,old_data:settings.root.clone(),old_lock,new_exe,new_data,control,package,sha256:release.sha256,version:release.version,product,launch_environment:crate::services::settings::maintenance::launch_environment(),owned:crate::services::settings::storage::OWNED.iter().map(|v|(*v).into()).collect(),cleanup_source:true};
        save_json(&state.root.join("migration-recovery.json"),&plan.control).await?;
        let preview=serde_json::json!({"token":plan.token,"oldApplication":folder.to_string_lossy(),"newApplication":plan.new_exe.parent(),"oldData":plan.old_data,"newData":plan.new_data,"recoveryDirectory":plan.control,"expiresInSeconds":900});
        *state.migration.lock().await=Some(Lease{plan,created:Instant::now()});Ok(preview)
    }.await;
    match &result {
        Ok(_) => {
            job.phase = "ready".into();
            job.message = "迁移计划已准备；确认后将退出应用，通过 MSI 重新安装并验证新位置。".into()
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
pub async fn apply(
    app: &tauri::AppHandle,
    token: String,
    confirmation: String,
    cleanup_source: bool,
    consent: bool,
) -> Result<()> {
    if crate::storage_policy::restricted_to_d() {
        return Err(error("开发验收禁止真实 MSI 迁移"));
    }
    if !consent || confirmation != "迁移臻境" {
        return Err(error("请核对迁移方案并输入“迁移臻境”"));
    }
    let state = app.state::<OnboardingState>();
    let _serial = state.serial.lock().await;
    if state.progress.lock().await.stage != "migration"
        || matches!(state.job.lock().await.phase.as_str(), "running" | "unknown")
    {
        return Err(error("请在迁移步骤核实上次操作结果后重新准备"));
    }
    let settings = app.state::<SettingsState>();
    let _critical = crate::services::settings::runtime::Critical::acquire(&settings)?;
    let mut lease = state
        .migration
        .lock()
        .await
        .take()
        .ok_or_else(|| error("请先准备迁移计划"))?;
    if lease.plan.token != token || lease.created.elapsed() > Duration::from_secs(900) {
        return Err(error("迁移计划已失效，请重新准备"));
    }
    lease.plan.cleanup_source = cleanup_source;
    let ready = lease
        .plan
        .control
        .join(format!("{}.migration-ready", lease.plan.token));
    let args = vec![serde_json::to_string(&lease.plan).map_err(|_| error("迁移计划编码失败"))?];
    let mut child = tools::platform::spawn_embedded(
        &lease.plan.control,
        "migrate",
        &args,
        include_str!("migration.ps1"),
    )
    .await?;
    let started = Instant::now();
    loop {
        if tokio::fs::try_exists(&ready).await.map_err(io_error)? {
            break;
        }
        if child.try_wait().map_err(io_error)?.is_some() {
            return Err(error("迁移助手未就绪，应用及数据未改动"));
        }
        if started.elapsed() > Duration::from_secs(15) {
            let _ = child.kill().await;
            return Err(error("迁移助手检查超时，未退出应用"));
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    let job = Job {
        phase: "running".into(),
        kind: "migration".into(),
        message: format!("迁移恢复记录位于 {}", lease.plan.control.display()),
        restart_required: false,
    };
    if let Err(cause) = save_json(&state.root.join("job.json"), &job).await {
        let _ = child.kill().await;
        return Err(cause);
    }
    *state.job.lock().await = job;
    app.exit(0);
    Ok(())
}
