//! Steam 独立服务：数据只存在后端快照；前端不能传文件路径、URI、程序参数或注册表键。
mod accounts;
mod appinfo;
mod scan;
pub mod types;
mod vdf;
use crate::services::tools::{Result, ensure_local_path, error, io_error};
use base64::Engine;
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    time::{Duration, Instant},
};
use tokio::sync::{Mutex, RwLock};
use types::*;

pub struct SteamState {
    pub root: PathBuf,
    pub serial: Mutex<()>,
    pub snapshot: RwLock<Option<Snapshot>>,
    loaded: Mutex<Option<Instant>>,
    names: Mutex<Option<appinfo::NameCache>>,
    pub http: reqwest::Client,
}
impl SteamState {
    /// 自动游戏控制仅采用 appinfo 明确标为 Game 的已安装目录，不能把 Wallpaper Engine 等软件当成游戏。
    pub async fn game_directories(&self, refresh: bool) -> Vec<String> {
        let snapshot = if refresh {
            self.refresh(false).await.ok()
        } else {
            self.snapshot.read().await.clone()
        };
        let names = self.names.lock().await;
        snapshot
            .map(|data| {
                data.games
                    .into_iter()
                    .filter(|game| {
                        game.installed
                            && names.as_ref().is_some_and(|cache| {
                                cache
                                    .kinds
                                    .get(&game.app_id)
                                    .is_some_and(|kind| kind.eq_ignore_ascii_case("game"))
                            })
                    })
                    .filter_map(|game| game.install_path)
                    .take(4096)
                    .collect()
            })
            .unwrap_or_default()
    }
    pub fn new(root: &Path) -> Result<Self> {
        let root = root.join("steam");
        ensure_local_path(&root)?;
        let http = reqwest::Client::builder()
            .https_only(true)
            .connect_timeout(Duration::from_secs(8))
            .timeout(Duration::from_secs(20))
            .redirect(reqwest::redirect::Policy::custom(|attempt| {
                if attempt.previous().len() < 3
                    && attempt.url().scheme() == "https"
                    && matches!(
                        attempt.url().host_str(),
                        Some("steamcommunity.com" | "api.steampowered.com")
                    )
                    && attempt.previous().first().and_then(|url| url.host_str())
                        == attempt.url().host_str()
                    && attempt.url().port_or_known_default() == Some(443)
                {
                    attempt.follow()
                } else {
                    attempt.stop()
                }
            }))
            .user_agent(concat!("zhenjing/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|_| error("Steam HTTP 客户端创建失败"))?;
        Ok(Self {
            root,
            serial: Mutex::new(()),
            snapshot: RwLock::new(None),
            loaded: Mutex::new(None),
            names: Mutex::new(None),
            http,
        })
    }
    pub async fn refresh(&self, force: bool) -> Result<Snapshot> {
        let _guard = self.serial.lock().await;
        if !force
            && self
                .loaded
                .lock()
                .await
                .is_some_and(|at| at.elapsed() < Duration::from_secs(15))
            && let Some(snapshot) = self.snapshot.read().await.as_ref()
        {
            return Ok(snapshot.clone());
        }
        let platform = scan::platform(&self.root).await?;
        let mut snapshot = scan::snapshot(&platform, &self.names).await?;
        self.merge_public(&mut snapshot).await;
        crate::services::tools::save_json(&self.root.join("snapshot.json"), &snapshot).await?;
        *self.loaded.lock().await = Some(Instant::now());
        *self.snapshot.write().await = Some(snapshot.clone());
        Ok(snapshot)
    }
    pub async fn current(&self) -> Result<Snapshot> {
        self.snapshot
            .read()
            .await
            .clone()
            .ok_or_else(|| error("请先刷新 Steam 数据"))
    }
    async fn merge_public(&self, snapshot: &mut Snapshot) {
        let Some(id) = &snapshot.current_account else {
            return;
        };
        let cached = scan::read(
            &self.root.join(format!("public/{id}.json")),
            16 * 1024 * 1024,
        )
        .await;
        if let Ok(bytes) = cached
            && let Ok(cache) = serde_json::from_slice::<PublicCache>(&bytes)
            && cache.account == *id
            && cache.games.len() <= 30_000
            && cache
                .games
                .iter()
                .all(|game| game.app_id > 0 && game.name.len() <= 1024)
        {
            merge(snapshot, cache.games);
            snapshot.inventory_source = "public-profile-cache".into();
            snapshot.inventory_complete = true;
            if chrono::Utc::now().timestamp_millis() - cache.at > 24 * 3600 * 1000 {
                snapshot
                    .warnings
                    .push("公开游戏库缓存已超过 24 小时，可手动重新同步。".into());
            }
        }
    }
    pub async fn sync_public(&self, consent: bool, api_key: Option<&str>) -> Result<Snapshot> {
        if !consent {
            return Err(error(
                "请确认仅使用当前 Steam ID 查询公开游戏列表，不会读取登录凭据",
            ));
        }
        let _guard = self.serial.lock().await;
        let mut snapshot = self.current().await?;
        let id = snapshot
            .current_account
            .clone()
            .ok_or_else(|| error("本机没有当前账号，请先登录 Steam"))?;
        if !scan::valid_id(&id) {
            return Err(error("Steam ID 无效"));
        }
        if api_key.is_some_and(|key| key.len() != 32 || !key.bytes().all(|b| b.is_ascii_hexdigit()))
        {
            return Err(error(
                "Steam Web API Key 应为 32 位十六进制，仅本次请求使用",
            ));
        }
        let request = if let Some(key) = api_key {
            self.http
                .get("https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/")
                .query(&[
                    ("key", key),
                    ("steamid", id.as_str()),
                    ("include_appinfo", "1"),
                    ("include_played_free_games", "1"),
                    ("format", "json"),
                ])
        } else {
            self.http.get(format!(
                "https://steamcommunity.com/profiles/{id}/games/?tab=all&xml=1"
            ))
        };
        // 不记录 URL / reqwest 原始错误，防止 query 中的临时 Web API Key 进入日志或 UI。
        let response = request
            .send()
            .await
            .map_err(|_| error("Steam 社区连接失败，请稍后重试"))?;
        if !response.status().is_success() {
            return Err(error(format!(
                "Steam 社区返回 HTTP {}，本地数据已保留",
                response.status().as_u16()
            )));
        }
        use futures_util::StreamExt;
        let mut bytes = Vec::new();
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|_| error("Steam 社区响应中断"))?;
            if bytes.len() + chunk.len() > 8 * 1024 * 1024 {
                return Err(error("Steam 社区响应超过上限"));
            }
            bytes.extend_from_slice(&chunk);
        }
        let text = String::from_utf8(bytes).map_err(|_| error("Steam 社区编码无效"))?;
        let games = if api_key.is_some() {
            parse_owned(&text)?
        } else {
            parse_public(&text, &id)?
        };
        let cache = PublicCache {
            account: id.clone(),
            at: chrono::Utc::now().timestamp_millis(),
            games: games.clone(),
        };
        crate::services::tools::save_json(&self.root.join(format!("public/{id}.json")), &cache)
            .await?;
        merge(&mut snapshot, games);
        snapshot.inventory_source = "public-profile".into();
        snapshot.inventory_complete = true;
        *self.snapshot.write().await = Some(snapshot.clone());
        Ok(snapshot)
    }
    pub async fn image(&self, kind: &str, id: &str) -> Result<Option<String>> {
        let snapshot = self.current().await?;
        let Some(path) = snapshot.path else {
            return Ok(None);
        };
        let root = Path::new(&path);
        let mut candidates = Vec::new();
        if kind == "avatar" && snapshot.accounts.iter().any(|account| account.id == id) {
            for extension in ["png", "jpg", "jpeg"] {
                candidates.push(root.join(format!("config/avatarcache/{id}.{extension}")));
            }
        } else if kind == "game"
            && id
                .parse::<u32>()
                .is_ok_and(|id| snapshot.games.iter().any(|game| game.app_id == id))
        {
            let cache = root.join("appcache/librarycache");
            for suffix in ["header.jpg", "library_600x900.jpg", "library_hero.jpg"] {
                candidates.push(cache.join(format!("{id}_{suffix}")));
                candidates.push(cache.join(id).join(suffix));
            }
            if let Ok(mut entries) = tokio::fs::read_dir(cache.join(id)).await {
                let mut count = 0;
                while let Some(entry) = entries.next_entry().await.map_err(io_error)? {
                    count += 1;
                    if count > 80 {
                        break;
                    }
                    if entry.file_type().await.map_err(io_error)?.is_dir() {
                        candidates.push(entry.path().join("header.jpg"));
                    }
                }
            }
        } else {
            return Err(error("图片目标不属于已扫描的 Steam 数据"));
        }
        for path in candidates {
            if let Ok(bytes) = scan::read(&path, 2 * 1024 * 1024).await {
                let mime = if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
                    Some("png")
                } else if bytes.starts_with(b"\xff\xd8\xff") {
                    Some("jpeg")
                } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
                    Some("webp")
                } else {
                    None
                };
                if let Some(mime) = mime {
                    return Ok(Some(format!(
                        "data:image/{mime};base64,{}",
                        base64::engine::general_purpose::STANDARD.encode(bytes)
                    )));
                }
            }
        }
        Ok(None)
    }
    pub async fn launch(&self, kind: &str, app_id: Option<u32>) -> Result<()> {
        let snapshot = self.current().await?;
        let root = snapshot
            .path
            .ok_or_else(|| error("未检测到 Steam，请先安装客户端"))?;
        let game = app_id.and_then(|id| snapshot.games.iter().find(|game| game.app_id == id));
        if kind == "client" {
            return spawn_steam(&self.root, Path::new(&root), &[]).await;
        }
        let game = game.ok_or_else(|| error("游戏不属于已扫描的数据，请刷新"))?;
        match kind {
            "run" => {
                if !game.installed {
                    return Err(error("该游戏尚未安装"));
                }
                spawn_steam(
                    &self.root,
                    Path::new(&root),
                    &["-applaunch".into(), game.app_id.to_string()],
                )
                .await
            }
            "install" | "uninstall" => {
                if kind == "uninstall" && !game.installed {
                    return Err(error("该游戏未安装"));
                }
                let uri = format!("steam://{kind}/{}", game.app_id);
                spawn_steam(&self.root, Path::new(&root), &[uri]).await
            }
            _ => Err(error("不支持的 Steam 启动操作")),
        }
    }
}
/// 只启动已探测目录的 Steam；发布版继承用户环境，开发验收才重定向临时目录。
pub async fn spawn_steam(data: &Path, root: &Path, args: &[String]) -> Result<()> {
    let exe = tokio::fs::canonicalize(root.join("steam.exe"))
        .await
        .map_err(io_error)?;
    let parent = tokio::fs::canonicalize(root).await.map_err(io_error)?;
    if exe.parent() != Some(parent.as_path()) {
        return Err(error("Steam 可执行文件越过安装目录"));
    }
    let mut command = tokio::process::Command::new(exe);
    command
        .args(args)
        .current_dir(root)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    for key in ["TEMP", "TMP"]
        .into_iter()
        .filter(|_| crate::storage_policy::restricted_to_d())
    {
        let directory = data.join("process").join(key);
        crate::services::tools::check_local_path(&directory).await?;
        tokio::fs::create_dir_all(&directory)
            .await
            .map_err(io_error)?;
        command.env(key, directory);
    }
    #[cfg(windows)]
    command.creation_flags(0x0800_0000);
    let mut child = command.spawn().map_err(|_| error("Steam 客户端无法启动"))?;
    tokio::spawn(async move {
        let _ = child.wait().await;
    });
    Ok(())
}
#[derive(Clone, Serialize, Deserialize)]
struct PublicGame {
    app_id: u32,
    name: String,
    minutes: Option<u64>,
    #[serde(default)]
    last_played: Option<u64>,
}
#[derive(Serialize, Deserialize)]
struct PublicCache {
    account: String,
    at: i64,
    games: Vec<PublicGame>,
}
use serde::{Deserialize, Serialize};
fn parse_owned(text: &str) -> Result<Vec<PublicGame>> {
    #[derive(Deserialize)]
    struct Response {
        response: Owned,
    }
    #[derive(Deserialize)]
    struct Owned {
        game_count: Option<usize>,
        games: Option<Vec<OwnedGame>>,
    }
    #[derive(Deserialize)]
    struct OwnedGame {
        appid: u32,
        #[serde(default)]
        name: String,
        playtime_forever: Option<u64>,
        rtime_last_played: Option<u64>,
    }
    let payload: Response = serde_json::from_str(text)
        .map_err(|_| error("Steam Web API 响应格式无效，未修改本地库存"))?;
    let count = payload
        .response
        .game_count
        .ok_or_else(|| error("Steam Web API 无权读取此账号游戏详情；请检查 API Key 与隐私权限"))?;
    let games = payload.response.games.unwrap_or_default();
    if count > 30_000 || games.len() != count {
        return Err(error("Steam Web API 游戏列表不完整或超过上限"));
    }
    games
        .into_iter()
        .map(|game| {
            if game.appid == 0 || game.name.len() > 1024 {
                return Err(error("Steam Web API 返回无效应用信息"));
            }
            Ok(PublicGame {
                app_id: game.appid,
                name: if game.name.is_empty() {
                    format!("App {}", game.appid)
                } else {
                    game.name
                },
                minutes: game.playtime_forever,
                last_played: game.rtime_last_played.filter(|at| *at > 0),
            })
        })
        .collect()
}
fn parse_public(text: &str, account: &str) -> Result<Vec<PublicGame>> {
    let document = roxmltree::Document::parse(text).map_err(|_| {
        error("Steam 公开列表需要登录或暂不可用，可填写官方 Web API Key 后重试；本地数据仍保留")
    })?;
    let root = document.root_element();
    if root.tag_name().name() != "gamesList" {
        return Err(error(
            "Steam 未公开游戏库，无法读取完整库存；不会绕过账号隐私设置",
        ));
    }
    let value = |node: roxmltree::Node<'_, '_>, key: &str| {
        node.children()
            .find(|n| n.has_tag_name(key))
            .and_then(|n| n.text())
            .map(str::to_owned)
    };
    if value(root, "steamID64").as_deref() != Some(account) {
        return Err(error("Steam 返回的游戏库账号不匹配"));
    }
    let games = root
        .children()
        .find(|node| node.has_tag_name("games"))
        .ok_or_else(|| error("Steam 游戏详情不可见，未把空响应当作空库存"))?;
    let mut output = Vec::new();
    for node in games.children().filter(|node| node.has_tag_name("game")) {
        let id = value(node, "appID")
            .and_then(|v| v.parse::<u32>().ok())
            .filter(|id| *id > 0)
            .ok_or_else(|| error("Steam 游戏编号格式无效"))?;
        let name = value(node, "name")
            .filter(|s| !s.is_empty() && s.len() <= 1024)
            .ok_or_else(|| error("Steam 游戏名称格式无效"))?;
        let minutes = value(node, "hoursOnRecord")
            .and_then(|v| v.replace(',', "").parse::<f64>().ok())
            .filter(|v| v.is_finite() && *v >= 0.0 && *v < 10_000_000.0)
            .map(|v| (v * 60.0).round() as u64);
        output.push(PublicGame {
            app_id: id,
            name,
            minutes,
            last_played: None,
        });
        if output.len() > 30_000 {
            return Err(error("Steam 游戏列表超过上限"));
        }
    }
    Ok(output)
}
fn merge(snapshot: &mut Snapshot, public: Vec<PublicGame>) {
    let mut games: BTreeMap<_, _> = snapshot
        .games
        .drain(..)
        .map(|mut game| {
            game.owned = Some(false);
            (game.app_id, game)
        })
        .collect();
    for game in public {
        let current = games.entry(game.app_id).or_insert_with(|| Game {
            app_id: game.app_id,
            ..Game::default()
        });
        current.name = game.name;
        current.owned = Some(true);
        current.evidence = "public-profile".into();
        current.playtime_minutes = game.minutes.or(current.playtime_minutes);
        current.last_played = game.last_played.or(current.last_played);
    }
    snapshot.games = games.into_values().collect();
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn public_inventory_requires_matching_visible_account() -> Result<()> {
        assert!(parse_owned(r#"{"response":{}}"#).is_err());
        assert!(parse_owned(r#"{"response":{"game_count":1,"games":[]}}"#).is_err());
        assert!(parse_owned(r#"{"response":{"game_count":0}}"#)?.is_empty());
        assert!(parse_public("<profile><error>private</error></profile>", "1").is_err());
        let text = "<gamesList><steamID64>1</steamID64><games><game><appID>10</appID><name>A &amp; B</name><hoursOnRecord>1.5</hoursOnRecord></game></games></gamesList>";
        let parsed = parse_public(text, "1")?;
        assert_eq!(parsed[0].minutes, Some(90));
        assert_eq!(parsed[0].name, "A & B");
        assert!(parse_public(text, "2").is_err());
        Ok(())
    }

    #[test]
    #[ignore = "只读本机 Steam 型号/库扫描；不启动客户端、不访问在线账号、不修改注册表或登录文件"]
    fn live_read_only_steam() -> Result<()> {
        tauri::async_runtime::block_on(async {
            let root = crate::services::tools::test_root("steam-readonly")?;
            let state = SteamState::new(&root)?;
            let result = state.refresh(true).await?;
            assert!(result.installed);
            assert!(!result.libraries.is_empty());
            let evidence = serde_json::json!({"installed":result.installed,"running":result.running,"libraries":result.libraries.len(),"games":result.games.len(),"installedGames":result.games.iter().filter(|game|game.installed).count(),"accounts":result.accounts.len(),"unknownNames":result.games.iter().filter(|game|game.name.starts_with("App ")).count(),"inventoryComplete":result.inventory_complete,"warnings":result.warnings.len()});
            let file = Path::new(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .ok_or_else(|| error("工程目录不存在"))?
                .join(".cache/verification/steam-live-result.json");
            crate::services::tools::save_json(&file, &evidence).await?;
            Ok(())
        })
    }
}
