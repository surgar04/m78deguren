use super::{appinfo, types::*, vdf};
use crate::services::tools::{Result, error, io_error};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashSet},
    path::{Path, PathBuf},
};
use tokio::io::AsyncReadExt;

pub fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
pub async fn read(path: &Path, limit: u64) -> Result<Vec<u8>> {
    let file = tokio::fs::File::open(path).await.map_err(io_error)?;
    if file.metadata().await.map_err(io_error)?.len() > limit {
        return Err(error("Steam 文件超过读取上限"));
    }
    let mut bytes = Vec::new();
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .await
        .map_err(io_error)?;
    if bytes.len() as u64 > limit {
        return Err(error("Steam 文件读取期间增长过快"));
    }
    Ok(bytes)
}
pub async fn text(path: &Path, limit: u64) -> Result<String> {
    String::from_utf8(read(path, limit).await?).map_err(|_| error("Steam 配置编码不受支持"))
}
pub fn child_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 255
        && value != "."
        && value != ".."
        && !value.chars().any(|c| {
            c.is_control() || matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
        })
}
pub fn valid_id(id: &str) -> bool {
    id.len() == 17
        && id.bytes().all(|byte| byte.is_ascii_digit())
        && id.parse::<u64>().is_ok_and(|id| id > 76561197960265728)
}
pub async fn platform(root: &Path) -> Result<Platform> {
    let hint = tokio::fs::read(root.join("location.json"))
        .await
        .ok()
        .filter(|v| v.len() <= 8192)
        .and_then(|v| serde_json::from_slice::<String>(&v).ok())
        .unwrap_or_default();
    let value = crate::services::tools::platform::run_embedded(
        root,
        "steam-discover",
        &[hint],
        std::time::Duration::from_secs(45),
        include_str!("windows.ps1"),
    )
    .await?;
    serde_json::from_value(value).map_err(|_| error("Steam 平台探测响应无效"))
}
pub async fn snapshot(
    platform: &Platform,
    names: &tokio::sync::Mutex<Option<appinfo::NameCache>>,
) -> Result<Snapshot> {
    let mut result = Snapshot {
        captured_at: chrono::Utc::now().timestamp_millis(),
        inventory_source: "local-cache".into(),
        ..Snapshot::default()
    };
    let Some(path) = &platform.path else {
        return Ok(result);
    };
    let root = Path::new(path);
    if !root.is_absolute() || tokio::fs::metadata(root.join("steam.exe")).await.is_err() {
        return Err(error("Steam 安装目录无效"));
    }
    result.installed = true;
    result.path = Some(path.clone());
    result.running = platform.running;
    let login = text(&root.join("config/loginusers.vdf"), 2 * 1024 * 1024).await;
    match login {
        Ok(source) => {
            result.revision = digest(source.as_bytes());
            match vdf::parse(&source) {
                Ok(parsed) => {
                    if let Some(users) = parsed.get("users") {
                        for user in users
                            .children
                            .iter()
                            .filter(|user| valid_id(&user.key))
                            .take(128)
                        {
                            let active = platform.running
                                && platform.active_id.is_some_and(|active| {
                                    user.key.parse::<u64>().ok()
                                        == Some(76561197960265728 + u64::from(active))
                                });
                            result.accounts.push(Account {
                                id: user.key.clone(),
                                account_name: user.text("AccountName").chars().take(128).collect(),
                                name: user.text("PersonaName").chars().take(256).collect(),
                                active,
                                most_recent: user.text("MostRecent") == "1",
                                remember_password: user.text("RememberPassword") == "1",
                                last_login: user.number("Timestamp"),
                            });
                        }
                    }
                }
                Err(_) => result
                    .warnings
                    .push("Steam 本地账号列表损坏，未尝试修改。".into()),
            }
        }
        Err(_) => result
            .warnings
            .push("未读取到本机保存的 Steam 账号；请先在客户端登录。".into()),
    }
    result.current_account = result
        .accounts
        .iter()
        .find(|a| a.active)
        .or_else(|| result.accounts.iter().find(|a| a.most_recent))
        .or_else(|| {
            result
                .accounts
                .iter()
                .max_by_key(|account| account.last_login)
        })
        .map(|a| a.id.clone());
    if platform.running && !result.accounts.iter().any(|account| account.active) {
        result
            .warnings
            .push("未确认 Steam 正在使用的账号，游玩数据暂按最近本地账号读取。".into());
    }
    let mut paths = vec![root.to_path_buf()];
    let mut library_source = None;
    for candidate in ["steamapps/libraryfolders.vdf", "config/libraryfolders.vdf"] {
        if let Ok(source) = text(&root.join(candidate), 4 * 1024 * 1024).await {
            library_source = Some(source);
            break;
        }
    }
    if let Some(source) = library_source {
        match vdf::parse(&source) {
            Ok(parsed) => {
                if let Some(folders) = parsed.get("libraryfolders") {
                    for folder in &folders.children {
                        if folder.key.parse::<u32>().is_err() {
                            continue;
                        }
                        let value = if folder.children.is_empty() {
                            &folder.value
                        } else {
                            folder.text("path")
                        };
                        let path = PathBuf::from(value);
                        if path.is_absolute()
                            && !paths
                                .iter()
                                .any(|old| old.to_string_lossy().eq_ignore_ascii_case(value))
                        {
                            paths.push(path);
                        }
                        if paths.len() >= 64 {
                            break;
                        }
                    }
                }
            }
            Err(_) => result
                .warnings
                .push("游戏库目录配置解析失败，仍扫描 Steam 主目录。".into()),
        }
    }
    let mut games = BTreeMap::new();
    for path in paths {
        let path_text = path.to_string_lossy().into_owned();
        let id = digest(path_text.to_lowercase().as_bytes());
        let mut library = Library {
            id: id.clone(),
            path: path_text.clone(),
            ..Library::default()
        };
        if let Some(disk) = platform.disks.iter().find(|disk| {
            path_text
                .to_lowercase()
                .starts_with(&disk.drive.to_lowercase())
        }) {
            library.total_bytes = Some(disk.total);
            library.free_bytes = Some(disk.free);
        }
        let mut manifests = match tokio::fs::read_dir(path.join("steamapps")).await {
            Ok(dir) => {
                library.available = true;
                dir
            }
            Err(_) => {
                result.warnings.push(format!("游戏库不可访问：{path_text}"));
                result.libraries.push(library);
                continue;
            }
        };
        let mut count = 0;
        while let Some(entry) = manifests.next_entry().await.map_err(io_error)? {
            count += 1;
            if count > 30_000 {
                result.warnings.push("游戏库文件数量超过扫描上限。".into());
                break;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            let Some(app_id) = name
                .strip_prefix("appmanifest_")
                .and_then(|name| name.strip_suffix(".acf"))
                .and_then(|id| id.parse::<u32>().ok())
                .filter(|id| *id > 0)
            else {
                continue;
            };
            if entry.file_type().await.map_err(io_error)?.is_symlink() {
                continue;
            }
            let parsed = text(&entry.path(), 2 * 1024 * 1024)
                .await
                .and_then(|s| vdf::parse(&s));
            let Ok(parsed) = parsed else {
                result
                    .warnings
                    .push(format!("应用 {app_id} 的安装清单不可读取。"));
                continue;
            };
            let Some(app) = parsed.get("AppState") else {
                continue;
            };
            if app.number("appid") != Some(u64::from(app_id)) {
                continue;
            }
            let dir = app.text("installdir");
            if !child_name(dir) {
                continue;
            }
            let target = path.join("steamapps/common").join(dir);
            let exists = tokio::fs::metadata(&target).await.is_ok_and(|m| m.is_dir());
            let size = app.number("SizeOnDisk");
            let complete = app.number("StateFlags").is_some_and(|flags| flags & 4 != 0) && exists;
            library.steam_bytes = library.steam_bytes.saturating_add(size.unwrap_or(0));
            library.games += 1;
            let game = Game {
                app_id,
                name: app.text("name").chars().take(1024).collect(),
                installed: exists,
                install_complete: complete,
                library_id: Some(id.clone()),
                install_path: Some(target.to_string_lossy().into_owned()),
                size_bytes: size,
                playtime_minutes: None,
                // 清单的 LastPlayed 是本机全账号信息；不把它当作当前账号时间。
                last_played: None,
                owned: None,
                evidence: "installed-manifest".into(),
            };
            if games
                .get(&app_id)
                .is_none_or(|existing: &Game| !existing.install_complete)
            {
                games.insert(app_id, game);
            }
        }
        result.libraries.push(library);
    }
    if let Some(account) = &result.current_account {
        let account_id = account
            .parse::<u64>()
            .ok()
            .and_then(|id| id.checked_sub(76561197960265728));
        if let Some(id) = account_id {
            // 新 Steam 的逐应用库缓存还包含未安装、未出现在游玩列表中的应用；只读取当前账号目录。
            // 缓存文件存在仍不等于拥有许可证，所以 owned 保持未知。
            if let Ok(mut cache) =
                tokio::fs::read_dir(root.join(format!("userdata/{id}/config/librarycache"))).await
            {
                let mut count = 0;
                while let Some(entry) = cache.next_entry().await.map_err(io_error)? {
                    count += 1;
                    if count > 30_000 {
                        break;
                    }
                    let name = entry.file_name().to_string_lossy().into_owned();
                    if let Some(app_id) = name
                        .strip_suffix(".json")
                        .and_then(|name| name.parse::<u32>().ok())
                        .filter(|id| *id > 0)
                        && entry.file_type().await.map_err(io_error)?.is_file()
                    {
                        games.entry(app_id).or_insert_with(|| Game {
                            app_id,
                            evidence: "current-account-library-cache".into(),
                            ..Game::default()
                        });
                    }
                }
            }
            if let Ok(source) = text(
                &root.join(format!("userdata/{id}/config/localconfig.vdf")),
                32 * 1024 * 1024,
            )
            .await
            {
                if let Ok(parsed) = vdf::parse(&source) {
                    let apps = parsed
                        .get("UserLocalConfigStore")
                        .and_then(|e| e.get("Software"))
                        .and_then(|e| e.get("Valve"))
                        .and_then(|e| e.get("Steam"))
                        .and_then(|e| e.get("apps"));
                    if let Some(apps) = apps {
                        for app in apps.children.iter().take(30_000) {
                            let Ok(id) = app.key.parse::<u32>() else {
                                continue;
                            };
                            if id == 0 {
                                continue;
                            }
                            let game = games.entry(id).or_insert_with(|| Game {
                                app_id: id,
                                evidence: "current-account-cache".into(),
                                ..Game::default()
                            });
                            game.playtime_minutes =
                                app.number("Playtime").or_else(|| app.number("Playtime2"));
                            game.last_played = app
                                .number("LastPlayed")
                                .filter(|at| *at > 0)
                                .or(game.last_played);
                        }
                    }
                } else {
                    result
                        .warnings
                        .push("当前账号的游玩缓存损坏，未混用其他账号记录。".into());
                }
            }
        }
    }
    let wanted: HashSet<_> = games
        .values()
        .filter(|game| game.name.is_empty())
        .map(|game| game.app_id)
        .collect();
    if !wanted.is_empty() {
        match appinfo::load(root, &wanted, names).await {
            Ok(names) => {
                for (id, name) in names {
                    if let Some(game) = games.get_mut(&id) {
                        game.name = name;
                    }
                }
            }
            Err(cause) => result.warnings.push(cause.to_string()),
        }
    }
    result.games = games
        .into_values()
        .map(|mut game| {
            if game.name.is_empty() {
                game.name = format!("App {}", game.app_id);
            }
            game
        })
        .collect();
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn current_account_fallback_and_caches_never_mix_users() -> Result<()> {
        tauri::async_runtime::block_on(async {
            let root = crate::services::tools::test_root("steam-scan-fixture")?;
            for folder in [
                "config",
                "steamapps/common/Test",
                "userdata/1/config/librarycache",
                "userdata/2/config/librarycache",
            ] {
                tokio::fs::create_dir_all(root.join(folder))
                    .await
                    .map_err(io_error)?;
            }
            tokio::fs::write(root.join("steam.exe"), b"fixture-not-executed")
                .await
                .map_err(io_error)?;
            tokio::fs::write(root.join("config/loginusers.vdf"),b"\"users\" {\"76561197960265729\" {\"Timestamp\" \"100\"} \"76561197960265730\" {\"Timestamp\" \"200\"}}").await.map_err(io_error)?;
            tokio::fs::write(root.join("steamapps/appmanifest_10.acf"),b"\"AppState\" {\"appid\" \"10\" \"name\" \"Test\" \"installdir\" \"Test\" \"StateFlags\" \"4\" \"LastPlayed\" \"999999\"}").await.map_err(io_error)?;
            tokio::fs::write(root.join("userdata/1/config/librarycache/20.json"), b"[]")
                .await
                .map_err(io_error)?;
            tokio::fs::write(root.join("userdata/2/config/librarycache/30.json"), b"[]")
                .await
                .map_err(io_error)?;
            tokio::fs::write(root.join("userdata/2/config/localconfig.vdf"),b"\"UserLocalConfigStore\" {\"Software\" {\"Valve\" {\"Steam\" {\"apps\" {\"30\" {\"Playtime\" \"0\" \"LastPlayed\" \"1000\"}}}}}}").await.map_err(io_error)?;
            let platform = Platform {
                path: Some(root.to_string_lossy().into_owned()),
                running: false,
                active_id: None,
                disks: Vec::new(),
                registry: LoginRegistry::default(),
            };
            let data = snapshot(&platform, &tokio::sync::Mutex::new(None)).await?;
            assert_eq!(data.current_account.as_deref(), Some("76561197960265730"));
            assert!(data.games.iter().all(|game| game.app_id != 20));
            assert!(data.games.iter().any(|game| game.app_id == 30
                && game.playtime_minutes == Some(0)
                && game.last_played == Some(1000)));
            assert!(
                data.games
                    .iter()
                    .any(|game| game.app_id == 10 && game.last_played.is_none() && game.installed)
            );
            Ok(())
        })
    }
}
