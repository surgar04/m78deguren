//! 本地游戏唯一索引。扫描只读所有磁盘；数据、图标和任务状态只写入应用档案。
pub mod catalog;
pub mod scan;
pub mod types;
use crate::services::{
    home::HomeState,
    tools::{Result, ensure_local_path, error, io_error, save_json},
};
use std::{
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::Duration,
};
use tauri::Manager;
use tokio::sync::{Mutex, RwLock};
use tokio_util::sync::CancellationToken;
use types::*;
pub struct OtherGamesState {
    pub root: PathBuf,
    pub snapshot: RwLock<Snapshot>,
    pub serial: Mutex<()>,
    pub scanning: AtomicBool,
    pub progress: Arc<AtomicU64>,
    pub cancellation: Mutex<CancellationToken>,
}
impl OtherGamesState {
    pub fn new(root: &Path) -> Result<Self> {
        let root = root.join("home/other-games");
        ensure_local_path(&root)?;
        std::fs::create_dir_all(&root).map_err(io_error)?;
        let loaded = (|| -> Result<Snapshot> {
            Ok(
                if let Some(text) = scan::read_small(&root.join("index.json"), 2 * 1024 * 1024) {
                    let mut value: Snapshot = serde_json::from_str(&text)
                        .map_err(|_| error("其他游戏索引损坏，原件已保留"))?;
                    if value.games.len() > 128 || value.roots.len() > 64 {
                        return Err(error("其他游戏索引超过限制"));
                    }
                    for game in &value.games {
                        validate_game(game)?
                    }
                    if value.running {
                        value.running = false;
                        value.complete = false;
                        value.message = "上次扫描被中断，可重新搜索。".into()
                    }
                    value
                } else {
                    Snapshot::default()
                },
            )
        })();
        let snapshot = match loaded {
            Ok(value) => value,
            Err(cause) => {
                let file = root.join("index.json");
                if file.is_file() {
                    std::fs::rename(
                        &file,
                        root.join(format!(
                            "index-invalid-{}.json",
                            chrono::Utc::now().timestamp_millis()
                        )),
                    )
                    .map_err(io_error)?;
                }
                Snapshot {
                    message: format!("索引无法读取，已保留原件，可重新搜索：{cause}"),
                    ..Snapshot::default()
                }
            }
        };
        Ok(Self {
            root,
            snapshot: RwLock::new(snapshot),
            serial: Mutex::new(()),
            scanning: AtomicBool::new(false),
            progress: Arc::new(AtomicU64::new(0)),
            cancellation: Mutex::new(CancellationToken::new()),
        })
    }
    pub async fn current(&self) -> Snapshot {
        let mut value = self.snapshot.read().await.clone();
        for game in &mut value.games {
            game.available = tokio::fs::metadata(&game.path)
                .await
                .is_ok_and(|meta| meta.is_file());
        }
        if self.scanning.load(Ordering::SeqCst) {
            value.running = true;
            value.visited = self.progress.load(Ordering::Relaxed)
        }
        value
    }
    pub async fn start(&self, app: tauri::AppHandle, deep: bool) -> Result<Snapshot> {
        if self
            .scanning
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return Err(error("已有游戏搜索任务正在运行"));
        }
        self.progress.store(0, Ordering::Relaxed);
        *self.cancellation.lock().await = CancellationToken::new();
        {
            let mut view = self.snapshot.write().await;
            view.running = true;
            view.mode = if deep { "deep" } else { "quick" }.into();
            view.message = "正在读取安装记录、快捷方式与启动器配置…".into();
            view.warnings.clear();
        }
        let result = self.current().await;
        tauri::async_runtime::spawn(async move {
            let state = app.state::<OtherGamesState>();
            let outcome = state.run(&app, deep).await;
            if let Err(cause) = outcome {
                let mut value = state.snapshot.write().await;
                value.running = false;
                value.complete = false;
                value.message = cause.to_string();
                let _ = save_json(&state.root.join("index.json"), &*value).await;
            }
            state.scanning.store(false, Ordering::SeqCst);
        });
        Ok(result)
    }
    async fn run(&self, app: &tauri::AppHandle, deep: bool) -> Result<()> {
        let _guard = self.serial.lock().await;
        let value = crate::services::tools::platform::run_embedded(
            &self.root,
            "games-hints",
            &[],
            Duration::from_secs(50),
            include_str!("windows.ps1"),
        )
        .await?;
        let mut hints: Hints =
            serde_json::from_value(value).map_err(|_| error("安装位置探测结果无效"))?;
        let previous = self.snapshot.read().await.clone();
        // 已知游戏及用户指定目录优先；深度搜索也先处理快速来源。
        let mut roots: Vec<Hint> = previous
            .games
            .iter()
            .map(|game| Hint {
                path: game.path.clone(),
                family: game.family.clone(),
                region: if game
                    .evidence
                    .iter()
                    .any(|e| e == "用户针对当前安装实例确认")
                {
                    game.region.clone()
                } else {
                    Region::Unknown
                },
                source: "用户针对当前安装实例确认".into(),
                steam_app_id: game.steam_app_id,
            })
            .collect();
        roots.extend(previous.roots.iter().map(|path| Hint {
            path: path.clone(),
            source: "用户选择目录".into(),
            ..Hint::default()
        }));
        roots.append(&mut hints.roots);
        let steam = app.state::<crate::services::steam::SteamState>();
        // 主动扫描不能依赖用户是否已经打开过 Steam 页面，先刷新其本地安装清单。
        if let Ok(snapshot) = steam.refresh(false).await {
            for game in snapshot.games.iter().filter(|game| game.installed) {
                if let Some(path) = &game.install_path
                    && let Some(profile) = catalog::steam_family(game.app_id, &game.name)
                {
                    let region =
                        if [2507950, 3513350, 4732690, 1671200, 4508340].contains(&game.app_id) {
                            Region::Global
                        } else {
                            Region::Unknown
                        };
                    roots.push(Hint {
                        path: path.clone(),
                        region,
                        source: format!("Steam 安装清单 {}", game.app_id),
                        steam_app_id: Some(game.app_id),
                        family: profile.id.into(),
                    });
                }
            }
        }
        // 受控地解析启动器保存的安装路径，不读取任意 JSON 或递归账号文件。
        let configs = roots.clone();
        let extra = tauri::async_runtime::spawn_blocking(move || config_paths(&configs))
            .await
            .map_err(|_| error("启动器配置解析任务失败"))?;
        roots.extend(extra);
        if deep {
            roots.extend(hints.drives.iter().map(|path| Hint {
                path: path.clone(),
                source: "固定磁盘深度搜索".into(),
                ..Hint::default()
            }));
        }
        let cancel = self.cancellation.lock().await.clone();
        let progress = self.progress.clone();
        let mut walked =
            tauri::async_runtime::spawn_blocking(move || scan::walk(roots, deep, cancel, progress))
                .await
                .map_err(|_| error("游戏搜索线程失败"))?;
        let hg_paths: Vec<String> = walked
            .found
            .iter()
            .filter(|found| {
                catalog::by_exe(&found.path.file_name().unwrap_or_default().to_string_lossy())
                    .is_some_and(|profile| matches!(profile.id, "arknights" | "endfield"))
            })
            .map(|found| found.path.to_string_lossy().into_owned())
            .collect();
        if !hg_paths.is_empty()
            && let Ok(value) = crate::services::tools::platform::run_embedded(
                &self.root,
                "game-configs",
                &hg_paths,
                Duration::from_secs(30),
                include_str!("windows.ps1"),
            )
            .await
            && let Ok(metadata) = serde_json::from_value::<Vec<Hint>>(value)
        {
            for hint in metadata {
                if hint.region != Region::Unknown
                    && let Some(found) = walked.found.iter_mut().find(|found| {
                        found
                            .path
                            .to_string_lossy()
                            .eq_ignore_ascii_case(&hint.path)
                    })
                {
                    found.hint.region = hint.region;
                    found.hint.family = hint.family;
                    found.hint.source = hint.source;
                }
            }
        }
        let home = app.state::<HomeState>();
        let mut games = Vec::new();
        let mut seen = std::collections::HashSet::new();
        let mut warnings = hints.warnings;
        for found in walked.found {
            if self.cancellation.lock().await.is_cancelled() {
                break;
            }
            let profile =
                catalog::by_exe(&found.path.file_name().unwrap_or_default().to_string_lossy())
                    .ok_or_else(|| error("未知游戏候选"))?;
            let steam_app_id = found.hint.steam_app_id;
            let (path, region, evidence, launcher, version) =
                tauri::async_runtime::spawn_blocking(move || -> Result<_> {
                    let path = scan::normalize(&found.path)?;
                    let path = if profile.id == "wuthering" {
                        path.ancestors()
                            .skip(1)
                            .take(5)
                            .map(|parent| parent.join("Wuthering Waves.exe"))
                            .find(|path| scan::pe(path))
                            .unwrap_or(path)
                    } else {
                        path
                    };
                    let (region, evidence) = scan::region(&path, profile.id, &found.hint);
                    let launcher = scan::launcher(&path, profile);
                    let version = path
                        .parent()
                        .and_then(|parent| scan::read_small(&parent.join("config.ini"), 65536))
                        .and_then(|text| {
                            text.lines().find_map(|line| {
                                line.trim()
                                    .strip_prefix("game_version=")
                                    .map(|v| v.chars().take(80).collect::<String>())
                            })
                        })
                        .unwrap_or_default();
                    Ok((path, region, evidence, launcher, version))
                })
                .await
                .map_err(|_| error("游戏元数据读取失败"))??;
            if !seen.insert(path.to_string_lossy().to_lowercase()) {
                continue;
            }
            let region_label = region_label(&region);
            let name = format!("{} · {}", profile.name, region_label);
            let id = match home.register_detected(&path, &name, app).await {
                Ok(id) => id,
                Err(cause) => {
                    warnings.push(cause.to_string());
                    continue;
                }
            };
            games.push(Game {
                id,
                family: profile.id.into(),
                name: profile.name.into(),
                region,
                evidence,
                path: path.to_string_lossy().into_owned(),
                launcher,
                steam_app_id,
                version,
                available: true,
                detected_at: chrono::Utc::now().timestamp_millis(),
            });
        }
        // 未找到不等同于已卸载：扫描超时/权限不足时保留旧实例，并在界面显示不可用状态。
        for mut game in previous.games {
            if seen.contains(&game.path.to_lowercase()) {
                continue;
            }
            game.available = tokio::fs::try_exists(&game.path).await.unwrap_or(false);
            games.push(game);
        }
        games.truncate(128);
        games.sort_by(|a, b| a.name.cmp(&b.name).then_with(|| a.path.cmp(&b.path)));
        warnings.truncate(32);
        let value = Snapshot {
            games,
            scanned_at: Some(chrono::Utc::now().timestamp_millis()),
            running: false,
            mode: if deep { "deep" } else { "quick" }.into(),
            visited: walked.visited,
            skipped: walked.skipped,
            complete: walked.complete,
            message: if walked.complete {
                "搜索完成，已同步到首页快捷启动。"
            } else {
                "已保留找到的结果；达到扫描限额或已取消，可指定目录继续搜索。"
            }
            .into(),
            warnings,
            roots: previous.roots,
        };
        save_json(&self.root.join("index.json"), &value).await?;
        *self.snapshot.write().await = value;
        home.refresh_game_worker(app).await;
        Ok(())
    }
    pub async fn choose_root(&self, app: &tauri::AppHandle) -> Result<Snapshot> {
        if self.scanning.load(Ordering::SeqCst) {
            return Err(error("请先停止当前扫描"));
        }
        use tauri_plugin_dialog::DialogExt;
        let own = app.clone();
        let picked = tauri::async_runtime::spawn_blocking(move || {
            own.dialog().file().blocking_pick_folder()
        })
        .await
        .map_err(|_| error("目录选择器启动失败"))?;
        if let Some(file) = picked {
            let path = file.into_path().map_err(|_| error("本地目录无效"))?;
            let path = tauri::async_runtime::spawn_blocking(move || scan::normalize(&path))
                .await
                .map_err(|_| error("目录验证失败"))??;
            let mut value = self.snapshot.write().await;
            if value.roots.len() >= 64 {
                return Err(error("最多保存 64 个搜索目录"));
            }
            let path = path.to_string_lossy().into_owned();
            if !value.roots.contains(&path) {
                value.roots.push(path)
            }
            save_json(&self.root.join("index.json"), &*value).await?;
        }
        Ok(self.current().await)
    }
    pub async fn confirm_region(
        &self,
        app: &tauri::AppHandle,
        id: &str,
        region: Region,
    ) -> Result<Snapshot> {
        if self.scanning.load(Ordering::SeqCst) {
            return Err(error("请等待搜索结束后修改区服"));
        }
        let _guard = self.serial.lock().await;
        let mut value = self.snapshot.read().await.clone();
        let game = value
            .games
            .iter_mut()
            .find(|g| g.id == id)
            .ok_or_else(|| error("游戏实例不存在"))?;
        game.region = region;
        game.evidence = vec!["用户针对当前安装实例确认".into()];
        let name = format!("{} · {}", game.name, region_label(&game.region));
        app.state::<HomeState>().rename_detected(id, &name).await?;
        save_json(&self.root.join("index.json"), &value).await?;
        *self.snapshot.write().await = value;
        Ok(self.current().await)
    }
    pub async fn launch_target(&self, id: &str) -> Result<(PathBuf, Option<u32>)> {
        let value = self.snapshot.read().await;
        let game = value
            .games
            .iter()
            .find(|game| game.id == id)
            .ok_or_else(|| error("检测到的游戏记录不存在，请重新扫描"))?;
        validate_game(game)?;
        let path = PathBuf::from(game.launcher.as_ref().unwrap_or(&game.path));
        let actual = path.clone();
        let client = PathBuf::from(&game.path);
        if !tauri::async_runtime::spawn_blocking(move || scan::pe(&actual) && scan::pe(&client))
            .await
            .map_err(|_| error("游戏启动文件验证失败"))?
        {
            return Err(error("游戏或启动器已移动，请重新扫描或手动定位"));
        }
        Ok((path, game.steam_app_id))
    }
    /// 删除首页快捷方式不等于卸载游戏。库内启动时按真实路径修复关联，再复用启动服务。
    pub async fn launch(&self, app: &tauri::AppHandle, id: &str) -> Result<()> {
        if uuid::Uuid::parse_str(id).is_err() || self.scanning.load(Ordering::SeqCst) {
            return Err(error("游戏实例无效或正在搜索，请稍后重试"));
        }
        let _guard = self.serial.lock().await;
        let mut value = self.snapshot.read().await.clone();
        let game = value
            .games
            .iter_mut()
            .find(|game| game.id == id)
            .ok_or_else(|| error("游戏实例不存在，请重新搜索"))?;
        validate_game(game)?;
        let home = app.state::<HomeState>();
        let registered = home
            .store
            .lock()
            .await
            .shortcuts
            .iter()
            .any(|row| row.id == game.id && row.path.eq_ignore_ascii_case(&game.path));
        let target_id = if !registered {
            game.id = home
                .register_detected(
                    Path::new(&game.path),
                    &format!("{} · {}", game.name, region_label(&game.region)),
                    app,
                )
                .await?;
            let repaired_id = game.id.clone();
            save_json(&self.root.join("index.json"), &value).await?;
            *self.snapshot.write().await = value;
            repaired_id
        } else {
            game.id.clone()
        };
        home.launch(&target_id, true, app).await?;
        Ok(())
    }
}
pub fn region_label(region: &Region) -> &'static str {
    match region {
        Region::Cn => "国服",
        Region::Global => "国际服",
        Region::Jp => "国际服·日本",
        Region::Kr => "国际服·韩国",
        Region::Tw => "国际服·繁中",
        Region::Unknown => "区服待确认",
    }
}
fn validate_game(game: &Game) -> Result<()> {
    if uuid::Uuid::parse_str(&game.id).is_err()
        || catalog::by_id(&game.family).is_none()
        || !crate::services::home::types::exe_path_valid(&game.path)
        || game
            .launcher
            .as_ref()
            .is_some_and(|path| !crate::services::home::types::exe_path_valid(path))
    {
        return Err(error("本地游戏实例结构无效"));
    }
    Ok(())
}
/// 固定配置文件中只提取绝对路径字段；大小/层级/数量均受限，不解析用户账号缓存。
fn config_paths(hints: &[Hint]) -> Vec<Hint> {
    let started = std::time::Instant::now();
    let mut result = Vec::new();
    let mut queue = std::collections::VecDeque::new();
    let mut seen = std::collections::HashSet::new();
    for hint in hints {
        let path = PathBuf::from(&hint.path);
        let folder = if path.is_file() {
            path.parent().map(Path::to_owned)
        } else {
            Some(path)
        };
        if let Some(folder) = folder {
            queue.push_back((folder, 0_u8, hint.clone()))
        }
    }
    while let Some((folder, depth, hint)) = queue.pop_front() {
        if seen.len() > 5000 || result.len() > 2048 || started.elapsed() > Duration::from_secs(20) {
            break;
        }
        if !seen.insert(folder.to_string_lossy().to_lowercase()) {
            continue;
        }
        for file in [
            "config.ini",
            "config.json",
            "kr_starter_game.json",
            "launcherDownloadConfig.json",
            "Config/Config.ini",
            "game_install_path.json",
        ] {
            if let Some(text) = scan::read_small(&folder.join(file), 262144) {
                let mut values = Vec::new();
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
                    json_paths(&json, 0, &mut values)
                } else {
                    for line in text.lines() {
                        if let Some((key, value)) = line.split_once('=')
                            && key.to_lowercase().contains("path")
                        {
                            values.push(value.trim().trim_matches('"').replace("\\\\", "\\"))
                        }
                    }
                }
                for path in values {
                    if path.len() <= 4096
                        && path.as_bytes().get(1) == Some(&b':')
                        && Path::new(&path).is_absolute()
                    {
                        let mut item = Hint {
                            path,
                            source: format!("启动器配置 {file}"),
                            ..hint.clone()
                        };
                        let channel = folder.to_string_lossy().to_lowercase();
                        if file == "kr_starter_game.json"
                            && channel.contains("g153")
                            && channel.contains("c50004")
                        {
                            item.region = Region::Global;
                            item.family = "wuthering".into();
                            item.source = "库洛国际渠道 G153/C50004".into();
                        }
                        result.push(item)
                    }
                }
            }
        }
        if depth < 4
            && let Ok(entries) = std::fs::read_dir(&folder)
        {
            for entry in entries.flatten().take(512) {
                let path = entry.path();
                let name = entry.file_name().to_string_lossy().to_lowercase();
                if entry.file_type().is_ok_and(|t| t.is_dir())
                    && (!matches!(
                        name.as_str(),
                        "windows" | "users" | "node_modules" | ".cache" | ".tools"
                    ) && (depth < 1
                        || name.contains("launcher")
                        || name.starts_with('g')
                        || name.starts_with('c')
                        || name == "games"
                        || name == "config"))
                {
                    queue.push_back((path, depth + 1, hint.clone()))
                }
            }
        }
    }
    result
}
fn json_paths(value: &serde_json::Value, depth: u8, out: &mut Vec<String>) {
    if depth > 12 || out.len() > 256 {
        return;
    }
    match value {
        serde_json::Value::Object(map) => {
            for (key, value) in map {
                if (key.to_lowercase().contains("path") || key == "installDir")
                    && let Some(path) = value.as_str()
                {
                    out.push(path.to_owned())
                }
                json_paths(value, depth + 1, out)
            }
        }
        serde_json::Value::Array(rows) => {
            for row in rows.iter().take(128) {
                json_paths(row, depth + 1, out)
            }
        }
        _ => {}
    }
}
