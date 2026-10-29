//! 分辨率切换是一个有期限的事务。独立看门狗负责自动恢复，窗口关闭或 Rust 进程退出均不能跳过恢复。
use super::{Result, error, io_error, platform, save_json};
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, BufReader},
    sync::Mutex,
};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Target {
    pub id: String,
    pub width: u32,
    pub height: u32,
    pub refresh: u32,
}
impl Target {
    pub fn validate(&self) -> Result<()> {
        if self.id.len() != 64
            || !self.id.bytes().all(|v| v.is_ascii_hexdigit())
            || !(320..=16384).contains(&self.width)
            || !(200..=16384).contains(&self.height)
            || !(20..=1000).contains(&self.refresh)
        {
            return Err(error("显示模式参数无效"));
        }
        Ok(())
    }
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub id: Option<String>,
    pub phase: String,
    pub remaining: u32,
    pub message: String,
}
pub struct DisplayService {
    pub snapshot: Arc<Mutex<Snapshot>>,
    control: Mutex<Option<PathBuf>>,
    serial: Mutex<()>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Recovery {
    pub id: String,
    pub monitor: String,
    pub width: u32,
    pub height: u32,
    pub refresh: u32,
    pub state: String,
}
/// 历史只返回经过校验的备份；恢复同样走 15 秒确认，不能直接绕过驱动测试。
pub async fn history(root: &Path) -> Result<Vec<Recovery>> {
    use sha2::{Digest, Sha256};
    let directory = root.join("display-switch");
    super::check_local_path(&directory).await?;
    let mut entries = match tokio::fs::read_dir(directory).await {
        Ok(value) => value,
        Err(cause) if cause.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(cause) => return Err(io_error(cause)),
    };
    let mut rows = Vec::new();
    let mut examined = 0;
    while let Some(entry) = entries.next_entry().await.map_err(io_error)? {
        examined += 1;
        if examined > 4096 {
            break;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        let Some(id) = name
            .strip_suffix(".json.backup.json")
            .filter(|id| uuid::Uuid::parse_str(id).is_ok())
        else {
            continue;
        };
        let path = entry.path();
        super::check_local_path(&path).await?;
        let meta = entry.metadata().await.map_err(io_error)?;
        if !meta.is_file() || meta.len() > 16384 {
            continue;
        }
        let value: serde_json::Value =
            match serde_json::from_slice(&tokio::fs::read(path).await.map_err(io_error)?) {
                Ok(value) => value,
                Err(_) => continue,
            };
        let Some(identity) = value["identity"]
            .as_str()
            .filter(|value| !value.is_empty() && value.len() < 1024)
        else {
            continue;
        };
        let target: Target = match serde_json::from_value(
            serde_json::json!({"id":format!("{:x}",Sha256::digest(identity.as_bytes())),"width":value["width"],"height":value["height"],"refresh":value["refresh"]}),
        ) {
            Ok(value) => value,
            Err(_) => continue,
        };
        if target.validate().is_err() {
            continue;
        }
        rows.push((
            meta.modified().ok(),
            Recovery {
                id: id.into(),
                monitor: target.id,
                width: target.width,
                height: target.height,
                refresh: target.refresh,
                state: value["state"].as_str().unwrap_or("unknown").into(),
            },
        ));
    }
    rows.sort_by_key(|row| std::cmp::Reverse(row.0));
    Ok(rows.into_iter().take(50).map(|(_, row)| row).collect())
}
impl Default for DisplayService {
    fn default() -> Self {
        Self {
            snapshot: Arc::new(Mutex::new(Snapshot {
                id: None,
                phase: "idle".into(),
                remaining: 0,
                message: String::new(),
            })),
            control: Mutex::new(None),
            serial: Mutex::new(()),
        }
    }
}
impl DisplayService {
    pub async fn switch(&self, root: &Path, target: Target, consent: bool) -> Result<()> {
        target.validate()?;
        if !consent {
            return Err(error("请确认显示模式修改"));
        }
        let _guard = self.serial.lock().await;
        if ["preparing", "confirming"].contains(&self.snapshot.lock().await.phase.as_str()) {
            return Err(error("请先完成当前显示模式确认"));
        }
        let value =
            platform::run_system(root, "displays", &[], std::time::Duration::from_secs(30)).await?;
        #[derive(Deserialize)]
        struct Monitors {
            monitors: Vec<Monitor>,
        }
        #[derive(Deserialize)]
        struct Monitor {
            id: String,
            device: String,
            identity: String,
        }
        let monitors: Monitors =
            serde_json::from_value(value).map_err(|_| error("显示器列表无效"))?;
        let monitor = monitors
            .monitors
            .into_iter()
            .find(|value| value.id == target.id)
            .ok_or_else(|| error("显示器已变化，请刷新"))?;
        let directory = root.join("display-switch");
        super::check_local_path(&directory).await?;
        tokio::fs::create_dir_all(&directory)
            .await
            .map_err(io_error)?;
        let id = uuid::Uuid::new_v4().to_string();
        let control = directory.join(format!("{id}.json"));
        let payload = serde_json::json!({"device":monitor.device,"identity":monitor.identity,"width":target.width,"height":target.height,"refresh":target.refresh});
        let mut child = platform::spawn_display_watch(
            root,
            &[
                payload.to_string(),
                control.to_string_lossy().into_owned(),
                std::process::id().to_string(),
            ],
        )
        .await?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| error("显示恢复服务无法建立连接"))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| error("显示恢复服务无法读取错误"))?;
        *self.control.lock().await = Some(control);
        *self.snapshot.lock().await = Snapshot {
            id: Some(id),
            phase: "preparing".into(),
            remaining: 15,
            message: "正在验证驱动并准备切换…".into(),
        };
        let snapshot = self.snapshot.clone();
        tokio::spawn(async move {
            let errors = tokio::spawn(async move {
                let mut data = Vec::new();
                let _ = stderr.take(16384).read_to_end(&mut data).await;
                String::from_utf8_lossy(&data).into_owned()
            });
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                #[derive(Deserialize)]
                struct Update {
                    phase: String,
                    remaining: u32,
                    message: String,
                }
                if line.len() > 4096 {
                    break;
                }
                if let Ok(value) = serde_json::from_str::<Update>(&line)
                    && ["confirming", "kept", "restored", "failed"].contains(&value.phase.as_str())
                    && value.remaining <= 15
                {
                    let mut state = snapshot.lock().await;
                    state.phase = value.phase;
                    state.remaining = value.remaining;
                    state.message = value.message;
                }
            }
            let status = child.wait().await;
            let details = errors.await.unwrap_or_default();
            let mut state = snapshot.lock().await;
            if !matches!(status,Ok(code) if code.success())
                || ["preparing", "confirming"].contains(&state.phase.as_str())
            {
                state.phase = "failed".into();
                state.message = "显示模式恢复服务异常，请核实显示设置与 应用备份".into();
            }
            if !details.is_empty() {
                log::warn!("显示模式服务：{details}");
            }
        });
        Ok(())
    }
    pub async fn decide(&self, id: &str, keep: bool) -> Result<()> {
        let _guard = self.serial.lock().await;
        let state = self.snapshot.lock().await;
        if state.id.as_deref() != Some(id) || state.phase != "confirming" {
            return Err(error("显示确认已结束，请重新读取状态"));
        }
        let path = self
            .control
            .lock()
            .await
            .clone()
            .ok_or_else(|| error("显示模式确认入口不可用"))?;
        save_json(
            &path,
            &serde_json::json!({"decision":if keep{"keep"}else{"revert"}}),
        )
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_invalid_modes() {
        let target = Target {
            id: "a".repeat(64),
            width: 1920,
            height: 1080,
            refresh: 60,
        };
        assert!(target.validate().is_ok());
        assert!(
            Target {
                refresh: 0,
                ..target
            }
            .validate()
            .is_err()
        );
    }
}
