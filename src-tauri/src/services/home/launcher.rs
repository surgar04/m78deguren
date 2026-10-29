//! 程序路径只由原生选择器登记；IPC 启动只接受 UUID，不接收任意路径或命令行参数。
use super::*;
use base64::Engine;
use tauri::Manager;
use tokio::io::AsyncReadExt;

pub(crate) async fn validate_exe(path: &Path) -> Result<PathBuf> {
    let normalized = tokio::fs::canonicalize(path)
        .await
        .map_err(|_| error("程序已不存在或无法访问，请重新选择"))?;
    // canonicalize 在 Windows 返回设备前缀；仅在操作系统规范化后移除该固定前缀。
    let text = normalized.to_string_lossy();
    let ordinary = text.strip_prefix("\\\\?\\").unwrap_or(&text);
    if !exe_path_valid(ordinary) {
        return Err(error("只允许本机绝对路径的 EXE 程序"));
    }
    let normalized = PathBuf::from(ordinary);
    let mut input = tokio::fs::File::open(&normalized).await.map_err(io_error)?;
    if !input.metadata().await.map_err(io_error)?.is_file() {
        return Err(error("选择的目标不是普通文件"));
    }
    let mut header = [0_u8; 64];
    input
        .read_exact(&mut header)
        .await
        .map_err(|_| error("程序头不完整"))?;
    if &header[..2] != b"MZ" {
        return Err(error("选择的文件不是 Windows 可执行程序"));
    }
    use tokio::io::AsyncSeekExt;
    let offset = u32::from_le_bytes(header[60..64].try_into().map_err(|_| error("程序头无效"))?);
    input
        .seek(std::io::SeekFrom::Start(u64::from(offset)))
        .await
        .map_err(io_error)?;
    let mut pe = [0_u8; 4];
    input
        .read_exact(&mut pe)
        .await
        .map_err(|_| error("PE 头无效"))?;
    if pe != *b"PE\0\0" {
        return Err(error("选择的文件没有有效 PE 头"));
    }
    Ok(normalized)
}
impl HomeState {
    pub async fn choose(&self, app: &tauri::AppHandle) -> Result<Option<Draft>> {
        use tauri_plugin_dialog::DialogExt;
        let app = app.clone();
        let file = tauri::async_runtime::spawn_blocking(move || {
            app.dialog()
                .file()
                .add_filter("Windows 可执行程序", &["exe"])
                .blocking_pick_file()
        })
        .await
        .map_err(|_| error("程序选择器启动失败"))?;
        let Some(file) = file else { return Ok(None) };
        let path = validate_exe(&file.into_path().map_err(|_| error("程序路径无效"))?).await?;
        let icon = crate::services::tools::platform::run_embedded(
            &self.root,
            "home-icon",
            &[path.to_string_lossy().into_owned()],
            Duration::from_secs(15),
            &runtime::source(),
        )
        .await
        .ok()
        .and_then(|value| value.as_str().map(str::to_owned))
        .filter(|data| data.len() < 524_288 && data.starts_with("data:image/png;base64,"));
        let draft = Draft {
            ticket: uuid::Uuid::new_v4().to_string(),
            name: path
                .file_stem()
                .map(|v| v.to_string_lossy().chars().take(60).collect())
                .unwrap_or_else(|| "程序".into()),
            path: path.to_string_lossy().into_owned(),
            icon,
        };
        let mut drafts = self.drafts.lock().await;
        drafts.retain(|(at, _)| at.elapsed() < Duration::from_secs(600));
        if drafts.len() >= 8 {
            drafts.remove(0);
        }
        drafts.push((Instant::now(), draft.clone()));
        Ok(Some(draft))
    }
    pub async fn add(
        &self,
        ticket: &str,
        name: &str,
        is_game: bool,
        expected: &str,
        app: &tauri::AppHandle,
    ) -> Result<Snapshot> {
        if !name_valid(name) {
            return Err(error("程序名称需要 1–60 个非控制字符"));
        }
        let _guard = self.serial.lock().await;
        let draft = self
            .drafts
            .lock()
            .await
            .iter()
            .find(|(at, draft)| draft.ticket == ticket && at.elapsed() < Duration::from_secs(600))
            .map(|(_, draft)| draft.clone())
            .ok_or_else(|| error("程序选择已过期，请重新选择"))?;
        let path = validate_exe(Path::new(&draft.path)).await?;
        let id = uuid::Uuid::new_v4().to_string();
        let mut next = self.store.lock().await.clone();
        next.shortcuts.push(Shortcut {
            id: id.clone(),
            name: name.trim().into(),
            path: path.to_string_lossy().into_owned(),
            is_game,
            last_launched: None,
            managed_game: false,
        });
        next.validate()?;
        if let Some(icon) = draft.icon {
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(icon.trim_start_matches("data:image/png;base64,"))
                .map_err(|_| error("图标编码无效"))?;
            let directory = self.root.join("icons");
            crate::services::tools::check_local_path(&directory).await?;
            tokio::fs::create_dir_all(&directory)
                .await
                .map_err(io_error)?;
            tokio::fs::write(directory.join(format!("{id}.png")), bytes)
                .await
                .map_err(io_error)?;
        }
        if let Err(cause) = self.commit(expected, next).await {
            let _ = tokio::fs::remove_file(self.root.join(format!("icons/{id}.png"))).await;
            return Err(cause);
        }
        self.drafts
            .lock()
            .await
            .retain(|(_, row)| row.ticket != ticket);
        self.refresh_worker_if_running(app).await;
        self.snapshot().await
    }
    pub async fn icon(&self, id: &str) -> Result<Option<String>> {
        if !self
            .store
            .lock()
            .await
            .shortcuts
            .iter()
            .any(|row| row.id == id)
        {
            return Err(error("快捷启动项目不存在"));
        }
        let path = self.root.join(format!("icons/{id}.png"));
        crate::services::tools::check_local_path(&path).await?;
        let Ok(bytes) = read_limited(&path, 393_216).await else {
            return Ok(None);
        };
        if bytes.len() > 393_216 || !bytes.starts_with(&[137, 80, 78, 71, 13, 10, 26, 10]) {
            return Err(error("图标缓存无效"));
        }
        Ok(Some(format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        )))
    }
    pub async fn remove(
        &self,
        id: &str,
        expected: &str,
        app: &tauri::AppHandle,
    ) -> Result<Snapshot> {
        let _guard = self.serial.lock().await;
        let mut next = self.store.lock().await.clone();
        if !next.shortcuts.iter().any(|row| row.id == id) {
            return Err(error("快捷启动项目不存在"));
        }
        next.shortcuts.retain(|row| row.id != id);
        self.commit(expected, next).await?;
        let _ = tokio::fs::remove_file(self.root.join(format!("icons/{id}.png"))).await;
        self.refresh_worker_if_running(app).await;
        self.snapshot().await
    }
    pub async fn reorder(&self, ids: &[String], expected: &str) -> Result<Snapshot> {
        let _guard = self.serial.lock().await;
        let mut next = self.store.lock().await.clone();
        if ids.len() != next.shortcuts.len()
            || ids.iter().collect::<std::collections::HashSet<_>>().len() != ids.len()
        {
            return Err(error("排序必须恰好包含当前全部项目"));
        }
        next.shortcuts = ids
            .iter()
            .map(|id| {
                next.shortcuts
                    .iter()
                    .find(|row| row.id == *id)
                    .cloned()
                    .ok_or_else(|| error("排序项目已变化，请刷新"))
            })
            .collect::<Result<Vec<_>>>()?;
        self.commit(expected, next).await?;
        self.snapshot().await
    }
    pub async fn launch(
        &self,
        id: &str,
        consent: bool,
        app: &tauri::AppHandle,
    ) -> Result<Snapshot> {
        if !consent {
            return Err(error("请确认启动所选程序"));
        }
        let _guard = self.serial.lock().await;
        let mut next = self.store.lock().await.clone();
        let before = revision(&next)?;
        let row = next
            .shortcuts
            .iter_mut()
            .find(|row| row.id == id)
            .ok_or_else(|| error("快捷启动项目不存在"))?;
        let (target, steam_app_id) = if row.managed_game {
            app.state::<crate::services::other_games::OtherGamesState>()
                .launch_target(id)
                .await?
        } else {
            (PathBuf::from(&row.path), None)
        };
        let path = validate_exe(&target).await?;
        let pid = if let Some(app_id) = steam_app_id {
            app.state::<crate::services::steam::SteamState>()
                .launch("run", Some(app_id))
                .await?;
            None
        } else {
            let mut command = tokio::process::Command::new(&path);
            command
                .current_dir(path.parent().ok_or_else(|| error("程序目录无效"))?)
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null());
            // 发布版继承用户真实环境，才能读取其游戏存档、登录态和程序配置。
            // 仅开发验收额外隔离被启动程序，避免写入本机 C 盘；该规则不能成为产品默认行为。
            for key in ["TEMP", "TMP", "APPDATA", "LOCALAPPDATA", "USERPROFILE"]
                .into_iter()
                .filter(|_| crate::storage_policy::restricted_to_d())
            {
                let directory = self.root.join("launch-data").join(id).join(key);
                crate::services::tools::check_local_path(&directory).await?;
                tokio::fs::create_dir_all(&directory)
                    .await
                    .map_err(io_error)?;
                command.env(key, directory);
            }
            match command.spawn() {
                Ok(mut child) => {
                    let pid = child.id();
                    tokio::spawn(async move {
                        let _ = child.wait().await;
                    });
                    pid
                }
                Err(cause)
                    if cause.raw_os_error() == Some(740)
                        && row.managed_game
                        && !crate::storage_policy::restricted_to_d() =>
                {
                    let environment = serde_json::to_string(
                        &crate::services::settings::maintenance::launch_environment(),
                    )
                    .map_err(|_| error("启动环境编码失败"))?;
                    let value = crate::services::tools::platform::run_embedded(
                        &self.root,
                        "home-launch",
                        &[path.to_string_lossy().into_owned(), environment],
                        Duration::from_secs(180),
                        &runtime::source(),
                    )
                    .await?;
                    value["pid"]
                        .as_u64()
                        .and_then(|pid| u32::try_from(pid).ok())
                }
                Err(_) => return Err(error("程序未能启动；请检查文件、权限或官方启动器状态")),
            }
        };
        let is_game = row.is_game;
        row.last_launched = Some(chrono::Utc::now().timestamp_millis());
        self.commit(&before, next).await.map_err(|_| {
            error("程序启动请求已提交，但启动记录未能保存；请勿重复点击，检查数据目录及日志")
        })?;
        let policy = self.store.lock().await.policy.clone();
        if is_game && (policy.auto_game_mode || policy.disable_win_in_game) {
            let control = async {
                self.ensure_worker(app).await?;
                self.configure_worker_with_pid(app, pid).await
            }
            .await;
            if let Err(cause) = control {
                self.status.write().await.message =
                    format!("程序已提交启动，但游戏控制未生效：{cause}");
            }
        }
        self.snapshot().await
    }
}
