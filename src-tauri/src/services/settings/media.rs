//! 媒体监测使用单个常驻 WinRT 适配进程；命令有 ACK 和超时，不把“已发送”当成功。
use crate::services::tools::{Result, error, platform};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, path::Path, sync::Arc, time::Duration};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    process::ChildStdin,
    sync::{Mutex, oneshot},
};
use tokio_util::sync::CancellationToken;

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Media {
    pub available: bool,
    pub title: String,
    pub artist: String,
    #[serde(default)]
    pub album: String,
    pub source: String,
    pub status: String,
    pub error: Option<String>,
    #[serde(default)]
    pub position_seconds: Option<f64>,
    #[serde(default)]
    pub duration_seconds: Option<f64>,
}
impl Media {
    fn valid(&self) -> bool {
        [&self.title, &self.artist, &self.album, &self.source]
            .iter()
            .all(|s| s.len() <= 4096 && !s.chars().any(char::is_control))
            && [self.position_seconds, self.duration_seconds]
                .iter()
                .flatten()
                .all(|s| s.is_finite() && (0.0..=10000000.0).contains(s))
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Message {
    r#type: String,
    id: String,
    media: Media,
    error: Option<String>,
}
type Pending = Arc<Mutex<HashMap<String, oneshot::Sender<Result<Media>>>>>;
pub struct MediaService {
    pub snapshot: Arc<Mutex<Media>>,
    input: Arc<Mutex<Option<ChildStdin>>>,
    pending: Pending,
    worker: Mutex<Option<(CancellationToken, tokio::task::JoinHandle<()>)>>,
    serial: Mutex<()>,
}
impl Default for MediaService {
    fn default() -> Self {
        Self {
            snapshot: Arc::new(Mutex::new(Media::default())),
            input: Arc::new(Mutex::new(None)),
            pending: Arc::new(Mutex::new(HashMap::new())),
            worker: Mutex::new(None),
            serial: Mutex::new(()),
        }
    }
}
impl MediaService {
    pub async fn stop(&self) -> Result<()> {
        let _guard = self.serial.lock().await;
        if let Some((token, mut task)) = self.worker.lock().await.take() {
            token.cancel();
            if tokio::time::timeout(Duration::from_secs(3), &mut task)
                .await
                .is_err()
            {
                task.abort();
                let _ = task.await;
            }
        }
        *self.input.lock().await = None;
        *self.snapshot.lock().await = Media::default();
        Ok(())
    }
    pub async fn ensure(&self, root: &Path) -> Result<()> {
        let _guard = self.serial.lock().await;
        if self
            .worker
            .lock()
            .await
            .as_ref()
            .is_some_and(|(_, handle)| !handle.is_finished())
        {
            return Ok(());
        }
        let mut child = platform::spawn_embedded(
            root,
            "settings-media",
            &[std::process::id().to_string()],
            include_str!("media.ps1"),
        )
        .await?;
        let input = child
            .stdin
            .take()
            .ok_or_else(|| error("媒体命令通道创建失败"))?;
        let output = child
            .stdout
            .take()
            .ok_or_else(|| error("媒体状态通道创建失败"))?;
        let errors = child
            .stderr
            .take()
            .ok_or_else(|| error("媒体错误通道创建失败"))?;
        *self.input.lock().await = Some(input);
        let token = CancellationToken::new();
        let cancellation = token.clone();
        let snapshot = self.snapshot.clone();
        let pending = self.pending.clone();
        let input = self.input.clone();
        let handle = tokio::spawn(async move {
            let stderr = tokio::spawn(async move {
                let mut bytes = Vec::new();
                let _ = errors.take(16_384).read_to_end(&mut bytes).await;
                bytes
            });
            let mut lines = BufReader::new(output).lines();
            let mut failure = "媒体监测已停止".to_owned();
            loop {
                tokio::select! {
                    ()=cancellation.cancelled()=>break,
                    line=lines.next_line()=>match line {
                        Ok(Some(line)) if line.len()<=16_384 => match serde_json::from_str::<Message>(&line) {
                            Ok(value) if value.media.valid() => {
                                if value.r#type=="state" {*snapshot.lock().await=value.media;}
                                else if value.r#type=="ack" && let Some(sender)=pending.lock().await.remove(&value.id) {
                                    let result=match value.error {Some(message)=>Err(error(message)),None=>{*snapshot.lock().await=value.media.clone();Ok(value.media)}};
                                    let _=sender.send(result);
                                }
                            },
                            _ => {failure="媒体监测返回无效数据".into();break;}
                        },
                        _ => break,
                    }
                }
            }
            let _ = child.kill().await;
            let _ = child.wait().await;
            let _ = stderr.await;
            *input.lock().await = None;
            for (_, sender) in pending.lock().await.drain() {
                let _ = sender.send(Err(error(&failure)));
            }
            if !cancellation.is_cancelled() {
                *snapshot.lock().await = Media {
                    error: Some(failure),
                    ..Media::default()
                };
            }
        });
        *self.worker.lock().await = Some((token, handle));
        Ok(())
    }
    pub async fn control(&self, root: &Path, action: &str) -> Result<Media> {
        if !matches!(action, "previous" | "next" | "play-pause") {
            return Err(error("未知媒体动作"));
        }
        self.ensure(root).await?;
        let id = uuid::Uuid::new_v4().to_string();
        let (sender, receiver) = oneshot::channel();
        {
            let mut pending = self.pending.lock().await;
            if pending.len() >= 16 {
                return Err(error("媒体操作过于频繁，请稍后再试"));
            }
            pending.insert(id.clone(), sender);
        }
        let bytes = serde_json::to_vec(&serde_json::json!({"id":id,"action":action}))
            .map_err(|_| error("媒体命令无效"))?;
        let sent = async {
            let mut input = self.input.lock().await;
            let input = input.as_mut().ok_or_else(|| error("媒体监测尚未就绪"))?;
            input
                .write_all(&bytes)
                .await
                .map_err(|_| error("媒体命令发送失败"))?;
            input
                .write_all(b"\n")
                .await
                .map_err(|_| error("媒体命令发送失败"))
        }
        .await;
        if let Err(cause) = sent {
            self.pending.lock().await.remove(&id);
            return Err(cause);
        }
        let result = tokio::time::timeout(Duration::from_secs(12), receiver).await;
        self.pending.lock().await.remove(&id);
        result
            .map_err(|_| error("媒体控制超时，请核对播放器实际状态"))?
            .map_err(|_| error("媒体监测连接中断"))?
    }
}
