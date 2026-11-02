//! 已验证更新的后台安装编排。UI 查询不触发安装；隐藏主窗口后仍由原生任务监控下载完成。
//! 每次实际安装前持久化尝试记录，防止 MSI 失败重启旧版后进入反复退出/安装的循环。
use super::{SettingsState, maintenance, runtime};
use crate::services::{
    hardware::Hardware,
    home::HomeState,
    onboarding::OnboardingState,
    tools::{Result, ToolsState, error, io_error, save_json},
};
use serde::{Deserialize, Serialize};
use std::{path::Path, time::Duration};
use tauri::{Emitter, Manager};
use tokio::io::AsyncReadExt;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Attempt {
    version: String,
    sha256: String,
    ticket: String,
}
impl Attempt {
    fn matches(&self, version: &str, sha256: &str) -> bool {
        self.version == version && self.sha256 == sha256
    }
}

/// 记录损坏时停止自动安装；不能把读取失败等同于“从未尝试”，否则可能形成重启循环。
async fn read_attempt(directory: &Path) -> Result<Option<Attempt>> {
    let file = directory.join("update-attempt.json");
    crate::services::tools::ensure_local_path(&file)?;
    match tokio::fs::metadata(&file).await {
        Err(cause) if cause.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(cause) => return Err(io_error(cause)),
        Ok(metadata) if !metadata.is_file() || metadata.len() > 4096 => {
            return Err(error("更新尝试记录不合法，请查看更新日志后手动重试"));
        }
        Ok(_) => {}
    }
    // 即使外部进程在 metadata 之后扩展文件，读取也不会越过记录的固定上限。
    let mut bytes = Vec::new();
    tokio::fs::File::open(file)
        .await
        .map_err(io_error)?
        .take(4097)
        .read_to_end(&mut bytes)
        .await
        .map_err(io_error)?;
    if bytes.len() > 4096 {
        return Err(error("更新尝试记录超过大小上限"));
    }
    let value: Attempt = serde_json::from_slice(&bytes)
        .map_err(|_| error("更新尝试记录损坏，已停止重复自动安装"))?;
    if semver::Version::parse(&value.version).is_err()
        || uuid::Uuid::parse_str(&value.ticket).is_err()
        || value.sha256.len() != 64
        || !value.sha256.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return Err(error("更新尝试记录身份无效，已停止重复自动安装"));
    }
    Ok(Some(value))
}

fn installation_allowed(debug: bool, restricted: bool) -> bool {
    !debug && !restricted
}

/// 检查真正的 MSI 安装标记，开发运行和只读验收均不会启动 msiexec 或退出当前实例。
async fn ensure_installed(exe: &Path) -> Result<()> {
    if !installation_allowed(
        cfg!(debug_assertions),
        std::env::var("ZHENJING_RESTRICT_WRITES_TO_D").as_deref() == Ok("1"),
    ) {
        return Err(error(
            "开发/验收环境不执行真实更新安装；已保留验证后的更新包",
        ));
    }
    let marker = exe
        .parent()
        .ok_or_else(|| error("应用位置无效"))?
        .join("zhenjing-install.ini");
    let size = tokio::fs::metadata(&marker)
        .await
        .map_err(|_| error("自动更新仅适用于 MSI 安装版"))?
        .len();
    if size > 16384 {
        return Err(error("安装标记过大"));
    }
    let marker = tokio::fs::read_to_string(marker).await.map_err(io_error)?;
    if !marker.lines().any(|line| line.trim() == "Format=msi") {
        return Err(error("自动更新仅适用于 MSI 安装版，请从发布页面安装 MSI"));
    }
    Ok(())
}

/// 自动升级等待游戏、首次向导及有状态工具空闲，不抢占用户正在进行的会话。
async fn ensure_idle(app: &tauri::AppHandle) -> Result<()> {
    if !app
        .state::<OnboardingState>()
        .progress
        .lock()
        .await
        .complete
    {
        return Err(error("更新已就绪，首次启动向导完成后自动安装"));
    }
    if app.state::<HomeState>().status.read().await.game_running
        || app
            .state::<Hardware>()
            .game
            .read()
            .await
            .get("processId")
            .and_then(|value| value.as_u64())
            .is_some_and(|pid| pid > 0)
    {
        return Err(error("更新已就绪，游戏结束后自动安装"));
    }
    runtime::ensure_quiet(app).await
}

/// 自动流程和用户“立即安装/重试”共用同一路径；token 只指向原生验证后的安装包。
/// explicit_retry 仅允许用户主动重试已失败的同版本，不跳过签名、摘要、空闲或开发隔离检查。
pub async fn apply(app: &tauri::AppHandle, token: &str, explicit_retry: bool) -> Result<()> {
    let state = app.state::<SettingsState>();
    let _critical = runtime::Critical::acquire(&state)?;
    ensure_idle(app).await?;
    let exe = std::env::current_exe().map_err(io_error)?;
    ensure_installed(&exe).await?;
    let status = state
        .update
        .status(&app.state::<ToolsState>().downloads)
        .await?;
    if !explicit_retry
        && read_attempt(&state.root.join("settings"))
            .await?
            .is_some_and(|attempt| {
                attempt.matches(
                    status.latest_version.as_deref().unwrap_or_default(),
                    status.sha256.as_deref().unwrap_or_default(),
                )
            })
    {
        return Err(error(
            "此版本已尝试安装但尚未完成；请查看维护日志后点击重试安装",
        ));
    }
    let (source, release) = state.update.consume(token).await?;
    // 在退出主进程之前重新核对磁盘内容；维护助手持有文件锁后还会再核验一次。
    let path = source.clone();
    let digest = release.sha256.clone();
    let bytes = release.bytes;
    tauri::async_runtime::spawn_blocking(move || {
        super::storage::verify_file(&path, &digest, bytes)
    })
    .await
    .map_err(|_| error("更新包复核任务中断"))??;
    let data = state.root.clone();
    let control =
        tauri::async_runtime::spawn_blocking(move || super::storage::control_directory(&data))
            .await
            .map_err(|_| error("维护目录检查失败"))??;
    let ticket = uuid::Uuid::new_v4().to_string();
    let plan = maintenance::Plan {
        ticket: ticket.clone(),
        kind: "update".into(),
        owner: std::process::id(),
        exe,
        data_root: state.root.clone(),
        control,
        restore_id: None,
        source: Some(source),
        sha256: Some(release.sha256.clone()),
        bytes: Some(release.bytes),
        version: Some(release.version.clone()),
        lock_file: super::storage::ownership_path(&state.root)?,
        launch_environment: maintenance::launch_environment(),
    };
    // 先落盘再启动助手；即使安装器、宿主或电脑意外退出，也不会自动反复尝试同一份包。
    save_json(
        &state.root.join("settings/update-attempt.json"),
        &Attempt {
            version: release.version,
            sha256: release.sha256,
            ticket,
        },
    )
    .await?;
    state.update.installing().await;
    let _ = app.emit("settings-update-changed", ());
    if let Err(cause) = maintenance::launch(app, plan).await {
        state.update.install_failed(&cause.to_string()).await;
        let _ = app.emit_to(
            "main",
            "settings-notice",
            format!("更新安装未完成：{cause}；可在关于页查看安装日志并重试"),
        );
        return Err(cause);
    }
    Ok(())
}

/// 空闲时只等待通知，下载中每两秒读取一次原生任务状态；不会重复下载或启动第二套计时采样。
pub fn boot(app: &tauri::AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let state = app.state::<SettingsState>();
        tokio::time::sleep(Duration::from_secs(8)).await;
        loop {
            let pending = state.update.has_pending().await;
            if pending {
                match state
                    .update
                    .status(&app.state::<ToolsState>().downloads)
                    .await
                {
                    Ok(status) if status.phase == "ready" => {
                        if let Some(token) = status.token
                            && let Err(cause) = apply(&app, &token, false).await
                            && state.update.install_message(&cause.to_string()).await
                        {
                            let _ = app.emit("settings-update-changed", ());
                        }
                    }
                    Err(cause) if state.update.install_message(&cause.to_string()).await => {
                        let _ = app.emit("settings-update-changed", ());
                    }
                    _ => {}
                }
            }
            tokio::select! {
                _ = state.update.wake.notified() => {},
                _ = tokio::time::sleep(Duration::from_secs(if pending { 2 } else { 60 })) => {},
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn development_and_acceptance_never_install() {
        assert!(!installation_allowed(true, false));
        assert!(!installation_allowed(false, true));
        assert!(installation_allowed(false, false));
    }
    #[tokio::test]
    async fn install_attempt_survives_restart_and_corruption_fails_closed() -> Result<()> {
        let root = crate::services::tools::test_root("update-attempt")?;
        assert!(read_attempt(&root).await?.is_none());
        let attempt = Attempt {
            version: "9.0.0".into(),
            sha256: "a".repeat(64),
            ticket: uuid::Uuid::new_v4().to_string(),
        };
        save_json(&root.join("update-attempt.json"), &attempt).await?;
        let persisted = read_attempt(&root)
            .await?
            .ok_or_else(|| error("记录丢失"))?;
        assert!(persisted.matches("9.0.0", &"a".repeat(64)));
        assert!(!persisted.matches("9.0.1", &"a".repeat(64)));
        assert!(!persisted.matches("9.0.0", &"b".repeat(64)));
        tokio::fs::write(root.join("update-attempt.json"), b"broken")
            .await
            .map_err(io_error)?;
        assert!(read_attempt(&root).await.is_err());
        Ok(())
    }
}
