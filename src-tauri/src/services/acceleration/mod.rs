//! 官方客户端协作入口：不实现 VPN/TUN，不访问私有 API，不把进程存在视为线路连通。
mod native;
pub mod types;
use crate::services::{
    other_games::{OtherGamesState, types::Region},
    tools::{Result, ensure_local_path, error, io_error, save_json},
};
use std::{
    path::{Path, PathBuf},
    time::Duration,
};
use tauri::{Emitter, Manager};
use tokio::sync::Mutex;
use types::*;
struct Inner {
    config: Config,
    clients: Vec<Client>,
    session: Option<Session>,
    warnings: Vec<String>,
}
pub struct AccelerationState {
    root: PathBuf,
    inner: Mutex<Inner>,
}
fn revision(config: &Config) -> Result<String> {
    use sha2::{Digest, Sha256};
    Ok(format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(config).map_err(|_| error("加速偏好编码失败"))?)
    ))
}
fn validate_client(client: &Client) -> Result<()> {
    if !crate::services::home::types::exe_path_valid(&client.path)
        || client.publisher != "厦门科臻赛科技有限公司"
        || client.sha256.len() != 64
        || !client.sha256.bytes().all(|b| b.is_ascii_hexdigit())
        || client.version.len() > 128
    {
        return Err(error("客户端登记信息无效，请重新定位"));
    }
    Ok(())
}
impl AccelerationState {
    pub fn new(data: &Path) -> Result<Self> {
        let root = data.join("acceleration");
        ensure_local_path(&root)?;
        std::fs::create_dir_all(&root).map_err(io_error)?;
        let file = root.join("config.json");
        let mut warnings = Vec::new();
        let config = if file.is_file() {
            let loaded = (|| -> Result<Config> {
                use std::io::Read;
                let mut bytes = Vec::new();
                std::fs::File::open(&file)
                    .map_err(io_error)?
                    .take(16385)
                    .read_to_end(&mut bytes)
                    .map_err(io_error)?;
                if bytes.len() > 16384 {
                    return Err(error("加速偏好过大"));
                }
                let config: Config =
                    serde_json::from_slice(&bytes).map_err(|_| error("加速偏好损坏"))?;
                if let Some(client) = &config.client {
                    validate_client(client)?;
                }
                Ok(config)
            })();
            match loaded {
                Ok(config) => config,
                Err(_) => {
                    std::fs::rename(
                        &file,
                        root.join(format!(
                            "config-invalid-{}.json",
                            chrono::Utc::now().timestamp_millis()
                        )),
                    )
                    .map_err(io_error)?;
                    warnings.push("偏好文件无法读取，已保留原件，请重新定位客户端。".into());
                    Config::default()
                }
            }
        } else {
            Config::default()
        };
        Ok(Self {
            root,
            inner: Mutex::new(Inner {
                config,
                clients: Vec::new(),
                session: None,
                warnings,
            }),
        })
    }
    pub async fn snapshot(&self) -> Result<Snapshot> {
        let rows = native::processes().await?;
        let inner = self.inner.lock().await;
        view(&inner, &rows)
    }
    pub async fn discover(&self) -> Result<Snapshot> {
        let mut inner = self.inner.lock().await;
        require_idle(&inner)?;
        let path = inner
            .config
            .client
            .as_ref()
            .map(|c| c.path.clone())
            .unwrap_or_default();
        let found: Discovery = serde_json::from_value(
            native::run(&self.root, "acceleration-discover", &[path]).await?,
        )
        .map_err(|_| error("QuickFox 检测结果无效"))?;
        for client in &found.clients {
            validate_client(client)?;
        }
        inner.clients = found.clients;
        inner.warnings = found.warnings;
        view(&inner, &native::processes().await?)
    }
    pub async fn select(&self, index: usize, hash: &str, expected: &str) -> Result<Snapshot> {
        let mut inner = self.inner.lock().await;
        require_idle(&inner)?;
        check_revision(&inner, expected)?;
        let client = inner
            .clients
            .get(index)
            .filter(|client| client.sha256 == hash)
            .cloned()
            .ok_or_else(|| error("候选客户端已失效，请重新检测"))?;
        let actual = native::verify(&self.root, &client.path).await?;
        if client != actual {
            return Err(error("客户端已更新，请重新检测后选择"));
        }
        let config = Config {
            client: Some(actual),
            ..inner.config.clone()
        };
        save_json(&self.root.join("config.json"), &config).await?;
        inner.config = config;
        view(&inner, &native::processes().await?)
    }
    pub async fn choose(&self, app: &tauri::AppHandle) -> Result<Snapshot> {
        use tauri_plugin_dialog::DialogExt;
        // 选择器等待期间不占用状态锁，防止取消/监测被阻塞。提交时重新验证会话。
        let expected = revision(&self.inner.lock().await.config)?;
        let handle = app.clone();
        let file = tauri::async_runtime::spawn_blocking(move || {
            handle
                .dialog()
                .file()
                .add_filter("QuickFox 客户端", &["exe"])
                .blocking_pick_file()
        })
        .await
        .map_err(|_| error("客户端选择器不可用"))?;
        let Some(file) = file else {
            return self.snapshot().await;
        };
        let path = file.into_path().map_err(|_| error("客户端路径无效"))?;
        let actual = native::verify(&self.root, &path.to_string_lossy()).await?;
        validate_client(&actual)?;
        let mut inner = self.inner.lock().await;
        require_idle(&inner)?;
        check_revision(&inner, &expected)?;
        let config = Config {
            client: Some(actual.clone()),
            ..inner.config.clone()
        };
        save_json(&self.root.join("config.json"), &config).await?;
        inner.config = config;
        if !inner.clients.contains(&actual) {
            if inner.clients.len() >= 8 {
                inner.clients.pop();
            }
            inner.clients.push(actual);
        }
        view(&inner, &native::processes().await?)
    }
    pub async fn remind(&self, enabled: bool, expected: &str) -> Result<Snapshot> {
        let mut inner = self.inner.lock().await;
        check_revision(&inner, expected)?;
        let config = Config {
            remind_on_exit: enabled,
            ..inner.config.clone()
        };
        save_json(&self.root.join("config.json"), &config).await?;
        inner.config = config;
        view(&inner, &native::processes().await?)
    }
    async fn verified(&self, inner: &Inner) -> Result<Client> {
        let saved = inner
            .config
            .client
            .as_ref()
            .ok_or_else(|| error("请先检测并选择官方客户端"))?;
        let actual = native::verify(&self.root, &saved.path).await?;
        if saved != &actual {
            return Err(error("QuickFox 已更新或路径变化，请重新检测并选择"));
        }
        Ok(actual)
    }
    async fn open_verified(&self, client: &Client) -> Result<()> {
        // 由客户端自身处理单实例激活，不结束厂商服务、不附带未公开的控制参数。
        native::run(
            &self.root,
            "acceleration-open",
            &[client.path.clone(), client.sha256.clone()],
        )
        .await?;
        Ok(())
    }
    pub async fn open(&self) -> Result<Snapshot> {
        let inner = self.inner.lock().await;
        let client = self.verified(&inner).await?;
        self.open_verified(&client).await?;
        drop(inner);
        self.snapshot().await
    }
    pub async fn prepare(&self, app: &tauri::AppHandle, game_id: &str) -> Result<Snapshot> {
        if uuid::Uuid::parse_str(game_id).is_err() {
            return Err(error("游戏标识无效"));
        }
        let mut inner = self.inner.lock().await;
        require_idle(&inner)?;
        let game = app
            .state::<OtherGamesState>()
            .current()
            .await
            .games
            .into_iter()
            .find(|g| g.id == game_id && g.available && g.region == Region::Cn)
            .ok_or_else(|| error("请选择已检测且区服已确认的国服游戏"))?;
        // 再验证启动目标，避免对已卸载游戏开启加速器。
        let launch_target = app
            .state::<OtherGamesState>()
            .launch_target(game_id)
            .await?;
        let client = self.verified(&inner).await?;
        let rows = native::processes().await?;
        if native::instance(&rows, &game.path).is_some() {
            return Err(error("游戏已运行，请先退出游戏，再开启加速后重新启动"));
        }
        if native::instance(&rows, &client.path).is_none() {
            self.open_verified(&client).await?;
        }
        inner.session = Some(Session {
            id: uuid::Uuid::new_v4().to_string(),
            game_id: game_id.into(),
            game_name: game.name,
            phase: Phase::Waiting,
            message: "请在 QuickFox 登录并启用游戏模式；完成后确认本次启动。".into(),
            created_at: chrono::Utc::now().timestamp(),
            confirmed_at: None,
            client_instance: native::instance(&rows, &client.path),
            game_path: game.path,
            launch_target: (
                launch_target.0.to_string_lossy().into_owned(),
                launch_target.1,
            ),
            client,
            misses: 0,
        });
        let snapshot = view(&inner, &rows)?;
        let watch_id = snapshot
            .session
            .as_ref()
            .map(|s| s.id.clone())
            .ok_or_else(|| error("准备会话未创建"))?;
        drop(inner);
        let handle = app.clone();
        tauri::async_runtime::spawn(async move {
            watch(handle, watch_id).await;
        });
        Ok(snapshot)
    }
    pub async fn cancel(&self, id: &str) -> Result<Snapshot> {
        let mut inner = self.inner.lock().await;
        let session = session_mut(&mut inner, id)?;
        if session.phase != Phase::Waiting {
            return Err(error(
                "启动已提交或准备已结束，不能通过取消结束正在运行的程序",
            ));
        }
        session.phase = Phase::Cancelled;
        session.confirmed_at = None;
        session.message = "已取消准备，未启动游戏；如已启用加速，请在 QuickFox 中断开。".into();
        view(&inner, &native::processes().await?)
    }
    pub async fn stop_tracking(&self, id: &str) -> Result<Snapshot> {
        let mut inner = self.inner.lock().await;
        let session = session_mut(&mut inner, id)?;
        session.phase = Phase::Cancelled;
        session.confirmed_at = None;
        session.message =
            "已停止本次跟踪。此操作不会退出游戏或断开加速，请在 QuickFox 内按需断开。".into();
        view(&inner, &native::processes().await?)
    }
    pub async fn confirm(
        &self,
        app: &tauri::AppHandle,
        id: &str,
        consent: bool,
    ) -> Result<Snapshot> {
        if !consent {
            return Err(error("请先在官方客户端启用游戏模式，再明确确认本次启动"));
        }
        let mut inner = self.inner.lock().await;
        let rows = native::processes().await?;
        let session = session_mut(&mut inner, id)?;
        advance(session, &rows, chrono::Utc::now().timestamp());
        if session.phase != Phase::Waiting {
            return Err(error("准备已失效或启动已提交，请重新准备"));
        }
        let actual = match native::verify(&self.root, &session.client.path).await {
            Ok(client) => client,
            Err(cause) => {
                session.phase = Phase::Failed;
                session.message = "客户端身份无法重新验证，请重新检测后准备。".into();
                return Err(cause);
            }
        };
        if actual != session.client {
            session.phase = Phase::Failed;
            session.message = "客户端已更新，请重新检测。".into();
            return Err(error("客户端身份发生变化，请重新检测"));
        }
        if session.client_instance.is_none() {
            return Err(error("尚未检测到已验证客户端的进程，请等待打开或重新检测"));
        }
        let game = app
            .state::<OtherGamesState>()
            .current()
            .await
            .games
            .into_iter()
            .find(|g| {
                g.id == session.game_id
                    && g.path == session.game_path
                    && g.region == Region::Cn
                    && g.available
            })
            .ok_or_else(|| error("游戏或区服记录发生变化，请取消后重新准备"))?;
        if native::instance(&rows, &game.path).is_some() {
            return Err(error("游戏已经运行，未重复提交启动请求"));
        }
        let current_target = app
            .state::<OtherGamesState>()
            .launch_target(&game.id)
            .await?;
        if current_target.0.to_string_lossy() != session.launch_target.0
            || current_target.1 != session.launch_target.1
        {
            session.phase = Phase::Failed;
            session.message = "游戏启动器或平台关联发生变化，请重新准备。".into();
            return Err(error("游戏启动目标发生变化，请重新准备"));
        }
        session.phase = Phase::LaunchRequested;
        session.confirmed_at = Some(chrono::Utc::now().timestamp());
        session.message =
            "本次启动已由用户确认；正在等待游戏进程，登录和更新请在启动器中完成。".into();
        // 状态先消费票据，再提交既有启动服务；即使双击/重放 IPC，也不会重复启动。
        let result = app.state::<OtherGamesState>().launch(app, &game.id).await;
        if let Err(cause) = result {
            session.phase = Phase::Failed;
            session.message =
                format!("游戏启动请求失败：{cause}；请在 QuickFox 检查是否需要断开。");
            return Err(cause);
        }
        view(&inner, &rows)
    }
}
fn require_idle(inner: &Inner) -> Result<()> {
    if inner.session.as_ref().is_some_and(|s| s.phase.active()) {
        return Err(error("已有游戏准备或监测会话，请先完成或取消"));
    }
    Ok(())
}
fn check_revision(inner: &Inner, expected: &str) -> Result<()> {
    if revision(&inner.config)? != expected {
        return Err(error("偏好已在其他位置修改，请刷新后重试"));
    }
    Ok(())
}
fn session_mut<'a>(inner: &'a mut Inner, id: &str) -> Result<&'a mut Session> {
    inner
        .session
        .as_mut()
        .filter(|s| s.id == id)
        .ok_or_else(|| error("准备会话不存在或已替换"))
}
fn view(inner: &Inner, rows: &native::Processes) -> Result<Snapshot> {
    Ok(Snapshot {
        config: inner.config.clone(),
        revision: revision(&inner.config)?,
        clients: inner.clients.clone(),
        client_running: inner
            .config
            .client
            .as_ref()
            .is_some_and(|c| native::instance(rows, &c.path).is_some()),
        session: inner.session.clone(),
        warnings: inner.warnings.clone(),
    })
}
/// 进程状态与人工确认分别记录；即使游戏已运行，也不输出“加速生效”或虚构 Ping。
fn advance(session: &mut Session, rows: &native::Processes, now: i64) {
    if !session.phase.active() {
        return;
    }
    let actual = native::instance(rows, &session.client.path);
    if let Some(previous) = session.client_instance {
        if actual != Some(previous) {
            session.phase = Phase::Failed;
            session.confirmed_at = None;
            session.message =
                "QuickFox 已退出或重启，本次准备失效；游戏未被强制结束，请检查网络后重新准备。"
                    .into();
            return;
        }
    } else if let Some(actual) = actual {
        session.client_instance = Some(actual);
    }
    match session.phase {
        Phase::Waiting => {
            if now - session.created_at > 600 || (actual.is_none() && now - session.created_at > 40)
            {
                session.phase = Phase::Failed;
                session.message =
                    "等待客户端或确认超时，未启动游戏；请检查官方客户端后重新准备。".into();
            }
        }
        Phase::LaunchRequested => {
            if native::instance(rows, &session.game_path).is_some() {
                session.phase = Phase::Playing;
                session.misses = 0;
                session.message =
                    "已检测到游戏运行；实际加速及延迟请以 QuickFox 和游戏内读数为准。".into();
            } else if now - session.confirmed_at.unwrap_or(now) > 600 {
                session.phase = Phase::Failed;
                session.message =
                    "未在十分钟内检测到游戏，请检查启动器；如不继续游玩，请在 QuickFox 中断开。"
                        .into();
            }
        }
        Phase::Playing => {
            if native::instance(rows, &session.game_path).is_none() {
                session.misses = session.misses.saturating_add(1);
            } else {
                session.misses = 0;
            }
            // 连续三次未出现才提示结束，避免启动器重启游戏时瞬间闪断。
            if session.misses >= 3 {
                session.phase = Phase::Finished;
                session.message =
                    "游戏已结束。请按需回到 QuickFox 断开加速，臻境不会关闭客户端或重置系统网络。"
                        .into();
            }
        }
        _ => {}
    }
}
async fn watch(app: tauri::AppHandle, id: String) {
    loop {
        tokio::time::sleep(Duration::from_secs(2)).await;
        let state = app.state::<AccelerationState>();
        let rows = match native::processes().await {
            Ok(rows) => rows,
            Err(_) => continue,
        };
        let mut inner = state.inner.lock().await;
        let remind = inner.config.remind_on_exit;
        let Some(session) = inner.session.as_mut() else {
            break;
        };
        if session.id != id {
            break;
        }
        if !session.phase.active() {
            break;
        }
        let before = session.phase.clone();
        advance(session, &rows, chrono::Utc::now().timestamp());
        if session.phase != before {
            let _ = app.emit_to("main", "acceleration-changed", ());
            if remind && (session.phase == Phase::Finished || session.phase == Phase::Failed) {
                let _ = app.emit_to("main", "settings-notice", session.message.clone());
            }
        }
        if !session.phase.active() {
            break;
        }
    }
}
#[cfg(test)]
mod tests;
