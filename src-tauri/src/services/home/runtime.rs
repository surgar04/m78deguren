//! 常驻助手有独立父进程看门狗；主进程异常退出时仍能释放钩子并恢复进程原值。
use super::*;
use std::collections::HashMap;
use tauri::Manager;
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    sync::oneshot,
};
type Replies = Arc<Mutex<HashMap<String, oneshot::Sender<Result<()>>>>>;
#[derive(Default)]
pub(super) struct Worker {
    serial: Mutex<()>,
    input: Mutex<Option<tokio::process::ChildStdin>>,
    task: Mutex<Option<tokio::task::JoinHandle<()>>>,
    replies: Replies,
}
pub(super) fn source() -> String {
    include_str!("native.ps1").to_owned()
}
async fn bounded_line(
    reader: &mut BufReader<tokio::process::ChildStdout>,
) -> Result<Option<String>> {
    let mut bytes = Vec::new();
    loop {
        let buffered = reader.fill_buf().await.map_err(io_error)?;
        if buffered.is_empty() {
            return if bytes.is_empty() {
                Ok(None)
            } else {
                Err(error("原生状态消息被截断"))
            };
        }
        let count = buffered
            .iter()
            .position(|byte| *byte == b'\n')
            .map_or(buffered.len(), |index| index + 1);
        if bytes.len() + count > 32768 {
            return Err(error("原生状态消息超过限制"));
        }
        let ended = buffered[count - 1] == b'\n';
        bytes.extend_from_slice(&buffered[..count]);
        reader.consume(count);
        if ended {
            return String::from_utf8(bytes)
                .map(Some)
                .map_err(|_| error("原生状态编码无效"));
        }
    }
}
impl Worker {
    async fn send(&self, mut value: serde_json::Value) -> Result<()> {
        let id = uuid::Uuid::new_v4().to_string();
        value["id"] = id.clone().into();
        let (sender, receiver) = oneshot::channel();
        self.replies.lock().await.insert(id.clone(), sender);
        let write = tokio::time::timeout(Duration::from_secs(10), async {
            let mut input = self.input.lock().await;
            let input = input.as_mut().ok_or_else(|| error("游戏控制助手未运行"))?;
            let mut bytes =
                serde_json::to_vec(&value).map_err(|_| error("游戏控制配置编码失败"))?;
            if bytes.len() > 1_000_000 {
                return Err(error("游戏识别名单超过助手大小限制，请减少登记项目"));
            }
            bytes.push(b'\n');
            input.write_all(&bytes).await.map_err(io_error)?;
            input.flush().await.map_err(io_error)
        })
        .await
        .unwrap_or_else(|_| Err(error("游戏控制通道写入超时")));
        if let Err(cause) = write {
            self.replies.lock().await.remove(&id);
            return Err(cause);
        }
        let result = tokio::time::timeout(Duration::from_secs(25), receiver).await;
        self.replies.lock().await.remove(&id);
        result
            .map_err(|_| error("游戏控制助手响应超时，请检查状态与恢复记录"))?
            .map_err(|_| error("游戏控制助手连接已关闭"))?
    }
    pub async fn stop(&self) -> Result<()> {
        let _guard = self.serial.lock().await;
        if self.input.lock().await.is_none() {
            return Ok(());
        }
        let result = self.send(serde_json::json!({"stop":true})).await;
        self.input.lock().await.take();
        if let Some(mut task) = self.task.lock().await.take() {
            // 不杀恢复助手：即便超时，也由独立看门狗在父进程退出后继续恢复。
            if tokio::time::timeout(Duration::from_secs(5), &mut task)
                .await
                .is_err()
            {
                log::warn!("首页恢复助手仍在完成恢复");
            }
        }
        result
    }
}
impl HomeState {
    pub async fn boot(&self, app: &tauri::AppHandle) -> Result<()> {
        let _guard = self.serial.lock().await;
        let result = async {
            self.ensure_worker(app).await?;
            self.configure_worker(app, None, false).await
        }
        .await;
        if let Err(cause) = &result {
            self.status.write().await.message = cause.to_string();
        }
        if result.is_ok() {
            let app = app.clone();
            *self.watch.lock().await = Some(tokio::spawn(async move {
                loop {
                    tokio::time::sleep(Duration::from_secs(30)).await;
                    let state = app.state::<HomeState>();
                    let policy = state.store.lock().await.policy.clone();
                    if policy.auto_game_mode
                        || policy.disable_win_in_game
                        || state.status.read().await.manual
                        || app
                            .state::<crate::services::quick_launch::QuickLaunchState>()
                            .enabled
                            .load(std::sync::atomic::Ordering::SeqCst)
                    {
                        // 目录和滤镜名单变化无需重启；串行提交，不能与用户的单项确认互相覆盖。
                        let _guard = state.serial.lock().await;
                        if let Err(cause) = state.configure_worker(&app, None, false).await {
                            state.status.write().await.message = cause.to_string();
                        }
                    }
                }
            }));
        }
        result
    }
    // 显式 Future 边界切断“助手事件 → 启动游戏 → 确认助手”的 Send 推导递归。
    pub(super) fn ensure_worker<'a>(
        &'a self,
        _app: &'a tauri::AppHandle,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + 'a>> {
        Box::pin(async move {
            let _guard = self.worker.serial.lock().await;
            if self
                .worker
                .task
                .lock()
                .await
                .as_ref()
                .is_some_and(|task| !task.is_finished())
            {
                return Ok(());
            }
            self.worker.input.lock().await.take();
            let mut child = crate::services::tools::platform::spawn_embedded(
                &self.root,
                "home-runtime",
                &[
                    std::process::id().to_string(),
                    self.root.to_string_lossy().into_owned(),
                ],
                &source(),
            )
            .await?;
            let input = child
                .stdin
                .take()
                .ok_or_else(|| error("游戏控制输入通道不可用"))?;
            let stdout = child
                .stdout
                .take()
                .ok_or_else(|| error("游戏控制输出通道不可用"))?;
            let stderr = child
                .stderr
                .take()
                .ok_or_else(|| error("游戏控制错误通道不可用"))?;
            let status = self.status.clone();
            let replies = self.worker.replies.clone();
            let app = _app.clone();
            let task = tokio::spawn(async move {
                let errors = tokio::spawn(async move {
                    let mut bytes = Vec::new();
                    let _ = stderr.take(32768).read_to_end(&mut bytes).await;
                    String::from_utf8_lossy(&bytes).into_owned()
                });
                // 按有界行读取；错误/超长输出不能使 UI 误认为控制仍有效。
                let mut lines = BufReader::new(stdout);
                while let Ok(Some(line)) = bounded_line(&mut lines).await {
                    if line.len() > 32768 {
                        break;
                    }
                    let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) else {
                        continue;
                    };
                    if value["kind"] == "status" {
                        if let Ok(next) =
                            serde_json::from_value::<Runtime>(value["runtime"].clone())
                        {
                            *status.write().await = next;
                        }
                    } else if value["kind"] == "wheel-launch" {
                        if let Some(index) = value["slot"].as_u64().filter(|index| *index < 8) {
                            let app = app.clone();
                            tauri::async_runtime::spawn(async move {
                                use tauri::Emitter;
                                if let Err(cause) = app
                                    .state::<crate::services::quick_launch::QuickLaunchState>()
                                    .wheel_dispatch(&app, index as usize)
                                    .await
                                {
                                    let _ = crate::services::settings::runtime::show_main(&app);
                                    let _ =
                                        app.emit_to("main", "settings-notice", cause.to_string());
                                }
                            });
                        }
                    } else if value["kind"] == "wheel-state" {
                        if let Ok(next) = serde_json::from_value::<
                            crate::services::quick_launch::Runtime,
                        >(value["runtime"].clone())
                        {
                            *app.state::<crate::services::quick_launch::QuickLaunchState>()
                                .runtime
                                .write()
                                .await = next;
                        }
                    } else if value["kind"] == "ack"
                        && let Some(id) = value["id"].as_str()
                        && let Some(sender) = replies.lock().await.remove(id)
                    {
                        let result = if value["ok"] == true {
                            Ok(())
                        } else {
                            Err(error(
                                value["message"].as_str().unwrap_or("游戏控制请求失败"),
                            ))
                        };
                        let _ = sender.send(result);
                    }
                }
                // stdout 关闭后不主动 kill，留给原生 finally 完成恢复。
                let _ = child.wait().await;
                if let Ok(details) = errors.await
                    && !details.is_empty()
                {
                    log::warn!("首页游戏控制助手: {details}");
                }
                let mut current = status.write().await;
                current.ready = false;
                current.effective = false;
                current.win_key_blocked = false;
                current.message = "游戏控制助手已退出，必要时可使用恢复入口".into();
                *app.state::<crate::services::quick_launch::QuickLaunchState>()
                    .runtime
                    .write()
                    .await = crate::services::quick_launch::Runtime {
                    ready: false,
                    visible: false,
                    message: "轮盘助手已退出，可关闭再启用轮盘重试".into(),
                };
                for (_, sender) in replies.lock().await.drain() {
                    let _ = sender.send(Err(error("游戏控制助手已退出")));
                }
            });
            *self.worker.input.lock().await = Some(input);
            *self.worker.task.lock().await = Some(task);
            Ok(())
        })
    }
    pub(super) async fn configure_worker(
        &self,
        app: &tauri::AppHandle,
        manual: Option<bool>,
        restore: bool,
    ) -> Result<()> {
        self.configure(app, manual, restore, None).await
    }
    pub(super) async fn configure_worker_with_pid(
        &self,
        app: &tauri::AppHandle,
        pid: Option<u32>,
    ) -> Result<()> {
        self.configure(app, None, false, pid).await
    }
    async fn configure(
        &self,
        app: &tauri::AppHandle,
        manual: Option<bool>,
        restore: bool,
        pid: Option<u32>,
    ) -> Result<()> {
        let store = self.store.lock().await.clone();
        let tools = app.state::<crate::services::tools::ToolsState>();
        let rules = tools
            .filters
            .snapshot
            .lock()
            .await
            .config
            .rules
            .iter()
            .map(|rule| rule.process.clone())
            .take(512)
            .collect::<Vec<_>>();
        let steam = app.state::<crate::services::steam::SteamState>();
        let directories = steam
            .game_directories(
                store.policy.auto_game_mode
                    || store.policy.disable_win_in_game
                    || manual == Some(true),
            )
            .await;
        let wheel = app
            .state::<crate::services::quick_launch::QuickLaunchState>()
            .native_config(app)
            .await;
        self.worker.send(serde_json::json!({"manual":manual,"restore":restore,"autoGameMode":store.policy.auto_game_mode,"disableWinInGame":store.policy.disable_win_in_game,"paths":store.shortcuts.iter().filter(|row|row.is_game).map(|row|row.path.clone()).collect::<Vec<_>>(),"directories":directories,"names":rules,"launched":pid.into_iter().collect::<Vec<_>>(),"wheel":wheel})).await
    }
    pub(super) async fn refresh_worker_if_running(&self, app: &tauri::AppHandle) {
        if self.worker.input.lock().await.is_some()
            && let Err(cause) = self.configure_worker(app, None, false).await
        {
            self.status.write().await.message = cause.to_string();
        }
    }
    pub async fn configure_quick_launch(&self, app: &tauri::AppHandle) -> Result<()> {
        self.ensure_worker(app).await?;
        self.configure_worker(app, None, false).await
    }
    pub async fn preview_wheel(&self, app: &tauri::AppHandle) -> Result<()> {
        self.configure_quick_launch(app).await?;
        self.worker
            .send(serde_json::json!({"wheelPreview":true}))
            .await
    }
    pub async fn restore(&self, consent: bool, app: &tauri::AppHandle) -> Result<Snapshot> {
        if !consent {
            return Err(error("请确认恢复上次记录的进程设置"));
        }
        let _guard = self.serial.lock().await;
        self.ensure_worker(app).await?;
        let mut store = self.store.lock().await.clone();
        let before = revision(&store)?;
        store.policy = Policy::default();
        self.commit(&before, store).await?;
        self.configure_worker(app, Some(false), true).await?;
        self.snapshot().await
    }
}
