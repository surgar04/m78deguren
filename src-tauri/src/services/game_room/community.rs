//! 固定社区服务代理。前端只能传业务筛选，不能构造 URL；所有响应均有超时、字节上限和明确错误。
use super::*;
use futures_util::StreamExt;
use sha2::{Digest, Sha256};

pub async fn bounded(response: reqwest::Response, limit: usize) -> Result<Vec<u8>> {
    let status = response.status();
    if !status.is_success() {
        return Err(error(format!(
            "数据源返回 HTTP {}，请稍后重试",
            status.as_u16()
        )));
    }
    if response.content_length().is_some_and(|n| n > limit as u64) {
        return Err(error("数据源响应超过安全上限"));
    }
    let mut stream = response.bytes_stream();
    let mut bytes = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| error("数据传输中断，请重试"))?;
        if bytes.len() + chunk.len() > limit {
            return Err(error("数据源响应超过安全上限"));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}
pub fn text_valid(text: &str, max: usize) -> bool {
    text.chars().count() <= max && !text.chars().any(|c| c.is_control() && c != '\n')
}
/// 主社区密码源失效时使用 NexBox 同源的备用纯文本接口；不沿用前一天的密码。
pub async fn backup_passwords(state: &GameRoomState) -> Result<Value> {
    let path = state.root.join("passwords-backup.json");
    let now = chrono::Utc::now().timestamp();
    if let Some(value) = read_cache(&path, 16384).await
        && value["fetchedAt"]
            .as_i64()
            .is_some_and(|at| now - at < 300 && (now + 28800) / 86400 == (at + 28800) / 86400)
    {
        return Ok(value);
    }
    let response = state
        .http
        .get("https://api.s0o1.com/API/sjz/mm/")
        .send()
        .await
        .map_err(|_| error("主备密码数据源均无法连接，请稍后重试"))?;
    let bytes = bounded(response, 65536).await?;
    let text = std::str::from_utf8(&bytes).map_err(|_| error("备用密码源编码无效"))?;
    let items = parse_passwords(text)?;
    let value = json!({"items":items,"fetchedAt":now,"source":"S0o1 社区备用接口（第三方）"});
    crate::services::tools::save_json(&path, &value).await?;
    Ok(value)
}
fn parse_passwords(text: &str) -> Result<Vec<Value>> {
    let map = regex::Regex::new(r"^\s*\d+[.、]\s*(.+?)\s*$")
        .map_err(|_| error("密码地图解析器不可用"))?;
    let code = regex::Regex::new(r"每日密码\s*[:：]\s*([0-9]{4})\s*$")
        .map_err(|_| error("密码解析器不可用"))?;
    let mut name = String::new();
    let mut items = Vec::new();
    for line in text.lines() {
        if let Some(capture) = map.captures(line).and_then(|value| value.get(1)) {
            name = capture.as_str().trim().chars().take(40).collect();
        } else if let Some(capture) = code.captures(line).and_then(|value| value.get(1))
            && !name.is_empty()
        {
            items.push(json!({"name":name,"password":capture.as_str()}));
            name = String::new();
        }
    }
    if items.is_empty() || items.len() > 12 {
        return Err(error("备用密码数据不完整，无法确认有效性"));
    }
    Ok(items)
}

impl GameRoomState {
    /// 图片按确切来源代理并验证魔数与尺寸，不为远端资料放宽全局 CSP 或暴露任意网络读取。
    pub async fn asset(&self, input: &str) -> Result<Value> {
        use base64::Engine;
        if input.len() > 6_000_000 {
            return Err(error("游戏图片地址过长"));
        }
        let key = format!("{:x}", Sha256::digest(input));
        if let Some((_, value)) = self
            .asset_cache
            .lock()
            .await
            .iter()
            .find(|(id, _)| id == &key)
        {
            return Ok(value.clone());
        }
        let _slot = self
            .asset_slots
            .acquire()
            .await
            .map_err(|_| error("图片处理服务已停止"))?;
        let bytes = if let Some((header, data)) = input
            .strip_prefix("data:image/")
            .and_then(|text| text.split_once(";base64,"))
        {
            if !["png", "jpeg", "webp"].contains(&header) {
                return Err(error("不支持的内嵌图片类型"));
            }
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(data)
                .map_err(|_| error("内嵌图片编码无效"))?;
            if bytes.len() > 4_194_304 {
                return Err(error("内嵌图片超过上限"));
            }
            bytes
        } else {
            if input.len() > 4096 {
                return Err(error("图片网址过长"));
            }
            let url = reqwest::Url::parse(input).map_err(|_| error("游戏图片地址无效"))?;
            let host = url.host_str().unwrap_or_default();
            if url.scheme() != "https"
                || !url.username().is_empty()
                || url.password().is_some()
                || url.port_or_known_default() != Some(443)
                || !(["gjts.cn", "playerhub.df.qq.com", "eo.oss.hengj.cn"].contains(&host)
                    || ["qpic.cn", "qlogo.cn", "gtimg.com"]
                        .iter()
                        .any(|suffix| host == *suffix || host.ends_with(&format!(".{suffix}"))))
            {
                return Err(error("游戏图片来源不在允许范围内"));
            }
            let response = self
                .http
                .get(url)
                .send()
                .await
                .map_err(|_| error("游戏图片暂不可用"))?;
            bounded(response, 4_194_304).await?
        };
        let format = image::guess_format(&bytes).map_err(|_| error("图片内容无效"))?;
        match format {
            image::ImageFormat::Png | image::ImageFormat::Jpeg | image::ImageFormat::WebP => {}
            _ => return Err(error("不支持的游戏图片类型")),
        }
        let dimensions = image::ImageReader::with_format(std::io::Cursor::new(&bytes), format)
            .into_dimensions()
            .map_err(|_| error("图片尺寸不可识别"))?;
        if dimensions.0 > 8192
            || dimensions.1 > 8192
            || u64::from(dimensions.0) * u64::from(dimensions.1) > 16_777_216
        {
            return Err(error("游戏图片尺寸过大"));
        }
        let value = tauri::async_runtime::spawn_blocking(move || {
            let image = image::load_from_memory_with_format(&bytes, format)
                .map_err(|_| error("游戏图片解码失败"))?
                .thumbnail(512, 512);
            let mut output = std::io::Cursor::new(Vec::new());
            image
                .write_to(&mut output, image::ImageFormat::Png)
                .map_err(|_| error("图片缩略图生成失败"))?;
            Ok::<_, crate::error::AppError>(json!(format!(
                "data:image/png;base64,{}",
                base64::engine::general_purpose::STANDARD.encode(output.into_inner())
            )))
        })
        .await
        .map_err(|_| error("图片处理任务失败"))??;
        let mut cache = self.asset_cache.lock().await;
        if cache.len() >= 16 {
            cache.pop_front();
        }
        cache.push_back((key, value.clone()));
        Ok(value)
    }
    pub async fn community(&self, path: &str, body: Option<Value>) -> Result<Value> {
        let mutating = body.is_some();
        let request = if let Some(body) = body {
            self.http
                .post(format!("https://df.nexbox.top{path}"))
                .json(&body)
        } else {
            self.http.get(format!("https://df.nexbox.top{path}"))
        };
        let response = request
            .send()
            .await
            .map_err(|_| error("无法连接 NexBox 社区数据源，请检查网络后重试"))?;
        let bytes = bounded(response, 2_097_152).await?;
        if mutating && bytes.is_empty() {
            return Ok(Value::Null);
        }
        serde_json::from_slice(&bytes)
            .map_err(|_| error("社区数据格式不兼容，请更新应用或稍后重试"))
    }
    pub async fn streamers(&self, refresh: bool) -> Result<Value> {
        let _serial = self.remote_serial.lock().await;
        let path = self.root.join("streamers.json");
        crate::services::tools::check_local_path(&path).await?;
        let cached = read_cache(&path, 8_388_608).await;
        if !refresh
            && let Some(value) = cached.as_ref().filter(|v| {
                chrono::Utc::now().timestamp_millis() - v["fetchedAt"].as_i64().unwrap_or(0)
                    < 86_400_000
            })
        {
            return Ok(value.clone());
        }
        let remote=async {
            let response=self.http.get("https://gjts.cn/data/streamer-library.json").send().await.map_err(|_|error("无法连接主播资料源"))?;
            let bytes=bounded(response,8_000_000).await?;
            let mut data:Value=serde_json::from_slice(&bytes).map_err(|_|error("主播资料格式不兼容"))?;
            if !data["entries"].is_array(){return Err(error("主播资料缺少目录"));}
            if let Some(entries)=data["entries"].as_array_mut(){entries.retain(|entry|entry["deleted"]!=true && entry["game"].as_str().is_some_and(|game|game.contains("三角洲")||game.to_ascii_lowercase().contains("delta")));}
            let value=json!({"data":data,"fetchedAt":chrono::Utc::now().timestamp_millis(),"cached":false});
            crate::services::tools::save_json(&path,&value).await?;Ok(value)
        }.await;
        match remote {
            Ok(value) => Ok(value),
            Err(_) if cached.is_some() => {
                let mut value = cached.ok_or_else(|| error("主播缓存不可用"))?;
                value["cached"] = json!(true);
                Ok(value)
            }
            Err(cause) => Err(cause),
        }
    }
    /// 点赞/报告本地防重复只在服务端成功后登记，网络失败可重试，不提前伪造成功状态。
    pub async fn reaction(&self, id: u64, report: bool) -> Result<Value> {
        if id == 0 || id > 1_000_000_000 {
            return Err(error("改枪码标识无效"));
        }
        let _serial = self.remote_serial.lock().await;
        let path = self.root.join("community-actions.json");
        let mut actions = read_cache(&path, 1_048_576)
            .await
            .unwrap_or_else(|| json!({}));
        let key = format!("{}:{id}", if report { "report" } else { "like" });
        if actions.get(&key).is_some() {
            return Err(error("已提交过此操作，请勿重复发送"));
        }
        let value = self
            .community(
                &format!(
                    "/api/loadouts/{id}/{}",
                    if report { "report" } else { "like" }
                ),
                Some(json!({})),
            )
            .await?;
        actions[&key] = json!(true);
        crate::services::tools::save_json(&path, &actions).await?;
        Ok(value)
    }
}
pub async fn read_cache(path: &Path, limit: u64) -> Option<Value> {
    use tokio::io::AsyncReadExt;
    crate::services::tools::check_local_path(path).await.ok()?;
    let input = tokio::fs::File::open(path).await.ok()?;
    if input.metadata().await.ok()?.len() > limit {
        return None;
    }
    let mut bytes = Vec::new();
    input.take(limit + 1).read_to_end(&mut bytes).await.ok()?;
    if bytes.len() as u64 > limit {
        return None;
    }
    serde_json::from_slice(&bytes).ok()
}
/// 只提供固定入口。第三方页面不获得应用 IPC 能力，也不能导航到本地文件。
pub async fn open_link(app: &tauri::AppHandle, key: &str) -> Result<()> {
    let (title, url) = match key {
        "map" => ("三角洲官方地图", "https://df.qq.com/cp/a20240729directory/"),
        "wallpaper" => (
            "三角洲官方壁纸",
            "https://df.qq.com/cp/community1031/wallpaper.html#/",
        ),
        "maqt" => ("码枪堂", "https://maqt.top/home"),
        "anxu" => ("ANXU", "https://guns.anxu.cc/"),
        "streamer-codes" => ("主播改枪码", "https://g.aitags.cn/live"),
        "xiaotao" => ("小涛查", "https://orzice.com/v/gun_gqm"),
        "wegame" => {
            return app.state::<GameRoomState>().wegame.login(app).await;
        }
        _ => return Err(error("不支持的三角洲专区入口")),
    };
    let url = reqwest::Url::parse(url).map_err(|_| error("入口地址配置无效"))?;
    let host = match key {
        "map" | "wallpaper" => "qq.com",
        "anxu" => "anxu.cc",
        "streamer-codes" => "aitags.cn",
        _ => url.host_str().unwrap_or_default(),
    }
    .to_owned();
    let label = format!("delta-site-{}", &format!("{:x}", Sha256::digest(key))[..12]);
    if let Some(window) = app.get_webview_window(&label) {
        window.show().map_err(|_| error("网页窗口显示失败"))?;
        window.set_focus().map_err(|_| error("网页窗口焦点失败"))?;
        return Ok(());
    }
    let directory = app.state::<GameRoomState>().root.join("external-webview");
    crate::services::tools::check_local_path(&directory).await?;
    tokio::fs::create_dir_all(&directory)
        .await
        .map_err(io_error)?;
    tauri::WebviewWindowBuilder::new(app, &label, tauri::WebviewUrl::External(url))
        .title(title)
        .always_on_top(true)
        .inner_size(1060.0, 760.0)
        .data_directory(directory)
        .on_navigation(move |url| {
            url.scheme() == "https"
                && url
                    .host_str()
                    .is_some_and(|h| h == host || h.ends_with(&format!(".{host}")))
        })
        .build()
        .map_err(|_| error("无法创建独立网页窗口"))?;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn backup_keeps_leading_zero_and_never_accepts_partial_passwords() -> Result<()> {
        let items = parse_passwords(
            "1. 零号大坝\n具体点位：测试\n每日密码：0557\n2. 航天基地\n每日密码：12345",
        )?;
        assert_eq!(items.len(), 1);
        assert_eq!(items[0]["password"], "0557");
        assert!(parse_passwords("<html>unavailable</html>").is_err());
        Ok(())
    }
}
