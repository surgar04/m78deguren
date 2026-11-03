use crate::{
    error::AppError,
    services::{
        music::{MusicState, catalog, desktop},
        tools::{error, save_json},
    },
};
use serde::Deserialize;
use serde_json::{Value, json};
use tauri::Manager;

#[derive(Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OnlineTrack {
    key: String,
    id: String,
    provider: String,
    title: String,
    artists: Vec<String>,
    album: String,
    duration_ms: f64,
    cover: Option<String>,
    #[serde(default)]
    matched: bool,
    #[serde(default)]
    match_source: Option<MatchSource>,
}

#[derive(Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
struct MatchSource {
    provider: String,
    id: String,
}
fn validate_track(input: Value) -> Result<Value, AppError> {
    let track: OnlineTrack =
        serde_json::from_value(input).map_err(|_| error("匹配元信息字段无效"))?;
    if !matches!(track.provider.as_str(), "qq" | "netease" | "ytm")
        || track.id.is_empty()
        || track.id.len() > 128
        || track.key != format!("{}:{}", track.provider, track.id)
        || track.title.len() > 16384
        || track.album.len() > 16384
        || track.artists.len() > 64
        || track.artists.iter().any(|v| v.len() > 16384)
        || !track.duration_ms.is_finite()
        || !(0.0..=604800000.0).contains(&track.duration_ms)
        || track.cover.as_ref().is_some_and(|v| v.len() > 16384)
        || track.match_source.as_ref().is_some_and(|source| {
            !matches!(source.provider.as_str(), "qq" | "netease" | "ytm")
                || source.id.is_empty()
                || source.id.len() > 128
        })
    {
        return Err(error("匹配元信息超出范围"));
    }
    serde_json::to_value(track).map_err(|_| error("匹配元信息编码失败"))
}

#[derive(Deserialize)]
#[serde(tag = "operation", rename_all = "kebab-case", deny_unknown_fields)]
pub enum Request {
    Embed {
        url: String,
    },
    Runtime {},
    Provider {
        provider: String,
        action: String,
        params: serde_json::Map<String, Value>,
    },
    Api {
        provider: String,
        path: String,
        method: String,
        params: serde_json::Map<String, Value>,
    },
    Relay {
        url: String,
        kind: String,
        method: Option<String>,
        body: Option<String>,
    },
    LocalList {},
    LocalImport {
        folder: bool,
    },
    LocalAudio {
        id: String,
    },
    LocalLyrics {
        id: String,
        choose: bool,
    },
    LocalRemove {
        id: String,
    },
    LocalReveal {
        id: String,
    },
    LocalMatch {
        id: String,
        track: Option<Value>,
    },
    DesktopRead {},
    DesktopConfigure {
        config: desktop::Config,
    },
    DesktopContent {
        content: Option<desktop::Content>,
    },
    DesktopClock {
        clock: desktop::Clock,
    },
    DesktopControl {
        action: String,
    },
    Immersive {
        enabled: bool,
    },
}
#[tauri::command]
pub async fn music_execute(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, MusicState>,
    request: Request,
) -> Result<Value, AppError> {
    let lyrics_window = window.label() == "desktop-lyrics";
    let lyrics_allowed = matches!(&request,Request::DesktopControl{action} if action == "close" || action == "lock" || action == "drag");
    if window.label() != "main"
        && !(lyrics_window && (matches!(&request, Request::DesktopRead {}) || lyrics_allowed))
    {
        return Err(error("辅助窗口没有音乐管理权限"));
    }
    let app = window.app_handle();
    match request {
        Request::DesktopRead {} => {
            serde_json::to_value(state.desktop.read().await).map_err(|_| error("歌词状态编码失败"))
        }
        Request::DesktopConfigure { config } => {
            serde_json::to_value(state.desktop.configure(app, config).await?)
                .map_err(|_| error("歌词配置编码失败"))
        }
        Request::DesktopContent { content } => {
            state.desktop.content(app, content).await?;
            Ok(Value::Null)
        }
        Request::DesktopClock { clock } => {
            state.desktop.clock(app, clock).await?;
            Ok(Value::Null)
        }
        Request::DesktopControl { action } => {
            serde_json::to_value(state.desktop.control(app, &action).await?)
                .map_err(|_| error("歌词配置编码失败"))
        }
        Request::Embed { url } => {
            let target = reqwest::Url::parse(&url).map_err(|_| error("背景网页地址无效"))?;
            if target.scheme() != "https"
                || target.username() != ""
                || target.password().is_some()
                || target.port().is_some_and(|v| v != 443)
                || url.len() > 4096
            {
                return Err(error("背景网页仅支持无账户信息的 HTTPS 地址"));
            }
            let host = target
                .host_str()
                .ok_or_else(|| error("背景网页缺少主机名"))?;
            let addresses = tokio::net::lookup_host((host, 443))
                .await
                .map_err(|_| error("背景网页域名无法解析"))?;
            let mut count = 0;
            for address in addresses {
                count += 1;
                let invalid = match address.ip() {
                    std::net::IpAddr::V4(ip) => {
                        ip.is_private()
                            || ip.is_loopback()
                            || ip.is_link_local()
                            || ip.is_unspecified()
                            || ip.is_multicast()
                            || ip.is_broadcast()
                    }
                    std::net::IpAddr::V6(ip) => {
                        ip.is_loopback()
                            || ip.is_unspecified()
                            || ip.is_multicast()
                            || ip.is_unique_local()
                            || ip.is_unicast_link_local()
                            || ip.to_ipv4_mapped().is_some()
                    }
                };
                if invalid {
                    return Err(error("背景网页不能访问本地或内网地址"));
                }
            }
            if count == 0 {
                return Err(error("背景网页域名没有可用地址"));
            }
            let mut embeds = state.embeds.lock().await;
            if let Some((id, _)) = embeds.iter().find(|(_, value)| **value == target.as_str()) {
                return Ok(json!({"url":format!("http://zhenjing-music.localhost/embed/{id}")}));
            }
            if embeds.len() >= 30 {
                return Err(error("本次演绎已登记 30 个网页背景，请退出后重试"));
            }
            let id = uuid::Uuid::new_v4().to_string();
            embeds.insert(id.clone(), target.into());
            Ok(json!({"url":format!("http://zhenjing-music.localhost/embed/{id}")}))
        }
        Request::Runtime {} => state.rpc(app, json!({"operation":"runtime"})).await,
        Request::Provider {
            provider,
            action,
            params,
        } => {
            if provider != "ytm"
                || action.is_empty()
                || action.len() > 80
                || !action
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))
            {
                return Err(error("音乐平台操作无效"));
            }
            state.rpc(app,json!({"operation":"provider","provider":provider,"action":action,"params":params})).await
        }
        Request::Api {
            provider,
            path,
            method,
            params,
        } => {
            if !matches!(provider.as_str(), "qq" | "netease")
                || !matches!(method.as_str(), "GET" | "POST")
                || path.len() > 100
            {
                return Err(error("音乐 API 请求无效"));
            }
            state.rpc(app,json!({"operation":"api","provider":provider,"path":path,"method":method,"params":params})).await
        }
        Request::Relay {
            url,
            kind,
            method,
            body,
        } => {
            if url.len() > 16384
                || !matches!(kind.as_str(), "audio" | "image" | "text")
                || method
                    .as_ref()
                    .is_some_and(|v| !matches!(v.as_str(), "GET" | "POST"))
                || body.as_ref().is_some_and(|v| v.len() > 1048576)
            {
                return Err(error("音乐资源参数无效"));
            }
            let mut value = json!({"operation":"relay","url":url,"kind":kind});
            if let Some(method) = method {
                value["method"] = json!(method);
            }
            if let Some(body) = body {
                value["body"] = json!(body);
            }
            state.rpc(app, value).await
        }
        Request::LocalList {} => Ok(state.catalog.lock().await.snapshot()),
        Request::LocalImport { folder } => catalog::import(app.clone(), &state, folder).await,
        Request::LocalLyrics { id, choose } => catalog::lyrics(&state, &id, choose).await,
        Request::LocalAudio { id } => {
            uuid::Uuid::parse_str(&id).map_err(|_| error("歌曲身份无效"))?;
            if !state.catalog.lock().await.entries.contains_key(&id) {
                return Err(error("歌曲不在本地音乐库中"));
            }
            Ok(
                json!({"url":format!("http://zhenjing-music.localhost/local/{id}"),"quality":"原始音质","preview":false,"clipStartMs":0}),
            )
        }
        Request::LocalRemove { id } => {
            let mut catalog = state.catalog.lock().await;
            catalog
                .entries
                .remove(&id)
                .ok_or_else(|| error("歌曲不在本地库中"))?;
            save_json(&state.root.join("library.json"), &*catalog).await?;
            Ok(catalog.snapshot())
        }
        Request::LocalMatch { id, track } => {
            uuid::Uuid::parse_str(&id).map_err(|_| error("本地歌曲身份无效"))?;
            if !state.catalog.lock().await.entries.contains_key(&id) {
                return Err(error("歌曲不在本地库中"));
            }
            let mut track = track.map(validate_track).transpose()?;
            if let Some(track) = &track {
                if serde_json::to_vec(track)
                    .map_err(|_| error("匹配元信息无效"))?
                    .len()
                    > 65536
                    || !matches!(track["provider"].as_str(), Some("qq" | "netease" | "ytm"))
                    || track["title"].as_str().is_none_or(|v| v.len() > 16384)
                    || !track["artists"].is_array()
                {
                    return Err(error("匹配元信息格式无效"));
                }
                if let Some(cover) = track["cover"].as_str()
                    && !cover.starts_with("http://zhenjing-music.localhost/media/")
                {
                    return Err(error("匹配封面未经音乐服务登记"));
                }
            }
            if let Some(candidate) = track.as_mut()
                && let Some(cover) = candidate["cover"].as_str()
            {
                let media = cover
                    .strip_prefix("http://zhenjing-music.localhost/media/")
                    .ok_or_else(|| error("匹配封面身份无效"))?;
                uuid::Uuid::parse_str(media).map_err(|_| error("匹配封面身份无效"))?;
                if let Some((port, secret)) = state.media_endpoint().await {
                    let downloaded = async {
                        let mut response = state
                            .http
                            .get(format!("http://127.0.0.1:{port}/media/{media}"))
                            .bearer_auth(secret)
                            .send()
                            .await
                            .map_err(|_| error("匹配封面暂时不可用"))?;
                        if !response.status().is_success() {
                            return Err(error("匹配封面暂时不可用"));
                        }
                        let mut bytes = Vec::new();
                        while let Some(chunk) = response
                            .chunk()
                            .await
                            .map_err(|_| error("匹配封面传输中断"))?
                        {
                            if bytes.len() + chunk.len() > 4 * 1024 * 1024 {
                                return Err(error("匹配封面过大"));
                            }
                            bytes.extend_from_slice(&chunk);
                        }
                        tokio::fs::write(
                            state.root.join("covers").join(format!("{id}.matched")),
                            bytes,
                        )
                        .await
                        .map_err(crate::services::tools::io_error)?;
                        Ok::<(), AppError>(())
                    }
                    .await;
                    candidate["cover"] = if downloaded.is_ok() {
                        json!(format!(
                            "http://zhenjing-music.localhost/cover/{id}?matched=1"
                        ))
                    } else {
                        Value::Null
                    };
                }
            }
            let mut catalog = state.catalog.lock().await;
            catalog
                .entries
                .get_mut(&id)
                .ok_or_else(|| error("歌曲不在本地库中"))?
                .matched = track;
            save_json(&state.root.join("library.json"), &*catalog).await?;
            Ok(catalog.snapshot())
        }
        Request::LocalReveal { id } => {
            use tauri_plugin_opener::OpenerExt;
            let path = state
                .catalog
                .lock()
                .await
                .entries
                .get(&id)
                .ok_or_else(|| error("歌曲不在本地库中"))?
                .path
                .clone();
            tauri::async_runtime::spawn_blocking(move || {
                catalog::read_path(&path)?;
                Ok::<_, AppError>(path)
            })
            .await
            .map_err(|_| error("歌曲路径检查失败"))??
            .to_str()
            .ok_or_else(|| error("歌曲路径无效"))
            .and_then(|path| {
                app.opener()
                    .reveal_item_in_dir(path)
                    .map_err(|_| error("无法定位音乐文件"))
            })?;
            Ok(Value::Null)
        }
        Request::Immersive { enabled } => {
            if !enabled {
                state.embeds.lock().await.clear();
            }
            window
                .set_fullscreen(enabled)
                .map_err(|_| error("无法切换沉浸全屏"))?;
            state.desktop.immersive(app, enabled).await?;
            Ok(Value::Null)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn tracks_validate_cross_field_identity_and_reject_unknown_input() {
        let row = json!({"key":"qq:123","id":"123","provider":"qq","title":"真实元信息","artists":["歌手"],"album":"专辑","durationMs":180000,"cover":null,"matched":false});
        assert!(validate_track(row.clone()).is_ok());
        let mut wrong = row.clone();
        wrong["key"] = json!("spotify:123");
        assert!(validate_track(wrong).is_err());
        let mut injected = row.clone();
        injected["command"] = json!("not-a-music-field");
        assert!(validate_track(injected).is_err());
        let mut bad_artists = row;
        bad_artists["artists"] = json!([12]);
        assert!(validate_track(bad_artists).is_err());
    }
    #[test]
    fn retired_matching_source_cannot_enter_music_ipc() {
        for provider in ["netease", "qq", "ytm"] {
            let row = json!({"key":format!("{provider}:123"),"id":"123","provider":provider,"title":"fixture","artists":[],"album":"","durationMs":10,"cover":null});
            assert!(validate_track(row.clone()).is_ok());
            let mut retired = row;
            retired["matchSource"] = json!({"provider":"spotify","id":"old"});
            assert!(validate_track(retired).is_err());
        }
    }
    #[test]
    fn file_registration_cannot_be_bypassed_with_ipc_paths() {
        assert!(
            serde_json::from_value::<Request>(
                json!({"operation":"local-audio","id":"test","path":"D:/private.mp3"})
            )
            .is_err()
        );
        assert!(
            serde_json::from_value::<Request>(
                json!({"operation":"local-import","folder":true,"command":"shell"})
            )
            .is_err()
        );
    }
}
