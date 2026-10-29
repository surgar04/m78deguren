//! 连点器只通过显式用户动作启动。配置可持久化，活动状态不会跨启动恢复。
use super::{Result, error, platform, save_json};
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    sync::Mutex,
};
use tokio_util::sync::CancellationToken;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClickConfig {
    pub button: String,
    pub interval_ms: u32,
    pub key: u16,
    pub control: bool,
    pub alt: bool,
    pub shift: bool,
}
impl Default for ClickConfig {
    fn default() -> Self {
        Self {
            button: "left".into(),
            interval_ms: 100,
            key: 119,
            control: false,
            alt: false,
            shift: false,
        }
    }
}
impl ClickConfig {
    pub fn validate(&self) -> Result<()> {
        let key = matches!(self.key,4..=6|32|65..=90|112..=123);
        if !matches!(self.button.as_str(), "left" | "right")
            || !(4..=60_000).contains(&self.interval_ms)
            || !key
        {
            return Err(error("连点参数无效：支持左右键、4–60000毫秒和白名单热键"));
        }
        Ok(())
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClickSnapshot {
    pub config: ClickConfig,
    pub armed: bool,
    pub running: bool,
    pub clicks: u64,
    pub message: String,
}
pub struct ClickService {
    file: PathBuf,
    pub snapshot: Arc<Mutex<ClickSnapshot>>,
    generation: Mutex<Option<(CancellationToken, tokio::task::JoinHandle<()>)>>,
    serial: Mutex<()>,
    input: Arc<Mutex<Option<tokio::process::ChildStdin>>>,
}
impl ClickService {
    pub fn load(root: &Path) -> Self {
        let file = root.join("autoclicker.json");
        let config = std::fs::read(&file)
            .ok()
            .and_then(|data| serde_json::from_slice::<ClickConfig>(&data).ok())
            .filter(|value| value.validate().is_ok())
            .unwrap_or_default();
        Self {
            file,
            snapshot: Arc::new(Mutex::new(ClickSnapshot {
                config,
                armed: false,
                running: false,
                clicks: 0,
                message: String::new(),
            })),
            generation: Mutex::new(None),
            serial: Mutex::new(()),
            input: Arc::new(Mutex::new(None)),
        }
    }

    pub async fn configure(
        &self,
        root: &Path,
        config: ClickConfig,
        enabled: bool,
        immediate: bool,
    ) -> Result<()> {
        config.validate()?;
        let _guard = self.serial.lock().await;
        // 停止旧服务再切换配置，杜绝多个独立点击循环同时运行。
        if let Some((token, mut handle)) = self.generation.lock().await.take() {
            token.cancel();
            if tokio::time::timeout(std::time::Duration::from_secs(3), &mut handle)
                .await
                .is_err()
            {
                handle.abort();
                let _ = handle.await;
            }
        }
        save_json(&self.file, &config).await?;
        *self.snapshot.lock().await = ClickSnapshot {
            config: config.clone(),
            armed: false,
            running: false,
            clicks: 0,
            message: String::new(),
        };
        if !enabled {
            return Ok(());
        }
        let mut payload = serde_json::to_value(&config).map_err(|_| error("连点配置无效"))?;
        payload["immediate"] = serde_json::Value::Bool(immediate);
        // 普通热键统一由设置服务持有；子进程仅保留 Esc 紧急停止和受限 stdin 控制。
        payload["externalHotkeys"] = serde_json::Value::Bool(true);
        let args = vec![
            serde_json::to_string(&payload).map_err(|_| error("连点配置无效"))?,
            std::process::id().to_string(),
        ];
        let mut child = platform::spawn_input(root, &args).await?;
        *self.input.lock().await = Some(
            child
                .stdin
                .take()
                .ok_or_else(|| error("连点控制通道创建失败"))?,
        );
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| error("无法读取连点状态"))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| error("无法读取连点错误"))?;
        let token = CancellationToken::new();
        let controller = token.clone();
        let snapshot = self.snapshot.clone();
        let input = self.input.clone();
        snapshot.lock().await.message = "正在启动输入服务…".into();
        let handle = tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            let errors = tokio::spawn(async move {
                let mut bytes = Vec::new();
                let _ = stderr.take(16_384).read_to_end(&mut bytes).await;
                String::from_utf8_lossy(&bytes).into_owned()
            });
            let mut failure = None;
            loop {
                tokio::select! {
                    ()=token.cancelled()=>{let _=child.kill().await;break;}
                    line=lines.next_line()=>match line {
                        Ok(Some(line)) if line.len()<=1024=>{
                            #[derive(Deserialize)] struct State {running:bool,clicks:u64,ready:bool,message:String}
                            match serde_json::from_str::<State>(&line) {
                                Ok(value)=>{let mut current=snapshot.lock().await; if !token.is_cancelled(){current.running=value.running;current.clicks=value.clicks;current.armed=value.ready;current.message=value.message;}}
                                Err(_)=>{failure=Some("连点服务返回了无效状态".to_owned());break;}
                            }
                        }
                        Ok(None)=>{failure=Some("连点服务已退出；请检查系统输入权限".to_owned());break;}
                        _=>{failure=Some("连点服务连接中断".to_owned());break;}
                    }
                }
            }
            let _ = child.kill().await;
            let _ = child.wait().await;
            *input.lock().await = None;
            if let Ok(details) = errors.await
                && !details.is_empty()
            {
                log::warn!("连点服务: {details}");
            }
            // 旧代取消不能覆盖新配置已经产生的状态。
            if !token.is_cancelled() {
                let mut current = snapshot.lock().await;
                current.armed = false;
                current.running = false;
                if let Some(message) = failure {
                    current.message = message;
                }
            }
        });
        *self.generation.lock().await = Some((controller, handle));
        Ok(())
    }
    pub async fn toggle(&self) -> Result<()> {
        if !self.snapshot.lock().await.armed {
            return Err(error("请先在连点器中确认并启用待命；不会自动启动点击"));
        }
        let mut input = self.input.lock().await;
        let pipe = input.as_mut().ok_or_else(|| error("连点控制通道不可用"))?;
        tokio::time::timeout(
            std::time::Duration::from_secs(1),
            pipe.write_all(b"toggle\n"),
        )
        .await
        .map_err(|_| error("连点控制响应超时"))?
        .map_err(|_| error("连点服务已断开"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_unbounded_clicking_and_unsafe_keys() -> Result<()> {
        let mut config = ClickConfig::default();
        config.validate()?;
        config.interval_ms = 0;
        assert!(config.validate().is_err());
        config.interval_ms = 4;
        config.key = 1;
        assert!(config.validate().is_err());
        config.key = 119;
        config.validate()?;
        Ok(())
    }
}
