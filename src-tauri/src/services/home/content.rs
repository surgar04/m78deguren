//! 首页网络内容经固定 HTTPS 白名单、流式大小限制及应用缓存进入 UI；失败不制造成功数据。
use super::*;
use base64::Engine;
use futures_util::StreamExt;
async fn bytes(response: reqwest::Response, limit: usize) -> Result<Vec<u8>> {
    if !response.status().is_success() {
        return Err(error(format!(
            "内容服务返回 HTTP {}",
            response.status().as_u16()
        )));
    }
    let mut data = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| error("网络内容读取中断"))?;
        if data.len() + chunk.len() > limit {
            return Err(error("网络内容超过大小限制"));
        }
        data.extend_from_slice(&chunk);
    }
    Ok(data)
}
impl HomeState {
    async fn get(&self, url: &str, limit: usize) -> Result<Vec<u8>> {
        let url = reqwest::Url::parse(url).map_err(|_| error("内容服务地址无效"))?;
        if !allowed_url(&url) {
            return Err(error("内容服务不在白名单中"));
        }
        let response = self
            .http
            .get(url)
            .header("Accept", "application/json,image/jpeg;q=0.9,*/*;q=0.1")
            .send()
            .await
            .map_err(|_| error("内容服务连接失败，请稍后重试"))?;
        bytes(response, limit).await
    }
    pub async fn text_content(&self, kind: &str, refresh: bool) -> Result<Content> {
        if !matches!(kind, "announcement" | "quote") {
            return Err(error("未知首页内容"));
        }
        let _guard = if kind == "quote" {
            self.quote_lock.lock().await
        } else {
            self.announcement_lock.lock().await
        };
        let path = self.root.join(format!("cache/{kind}.json"));
        crate::services::tools::check_local_path(&path).await?;
        let cached = match read_limited(&path, 65536).await {
            Ok(data) if data.len() <= 65536 => serde_json::from_slice::<Content>(&data).ok(),
            _ => None,
        };
        if !refresh
            && let Some(value) = &cached
            && chrono::Utc::now().timestamp_millis() - value.fetched_at < 3_600_000
        {
            let mut value = value.clone();
            value.cached = true;
            return Ok(value);
        }
        if kind == "quote" {
            let mut at = self.quote_at.lock().await;
            if at.is_some_and(|at| at.elapsed() < Duration::from_secs(2)) {
                return Err(error("一言刷新过快，请稍候"));
            }
            *at = Some(Instant::now());
        }
        let result = async {
            if kind == "quote" {
                let data = self
                    .get("https://v1.hitokoto.cn/?max_length=100", 65536)
                    .await?;
                #[derive(serde::Deserialize)]
                struct Quote {
                    hitokoto: String,
                    from: String,
                    from_who: Option<String>,
                }
                let quote: Quote =
                    serde_json::from_slice(&data).map_err(|_| error("一言服务格式无效"))?;
                if quote.hitokoto.trim().is_empty()
                    || quote.hitokoto.chars().count() > 1000
                    || quote.from.len() > 1024
                    || quote.from_who.as_ref().is_some_and(|v| v.len() > 1024)
                {
                    return Err(error("一言内容格式无效"));
                }
                Ok(Content {
                    title: "随机一言".into(),
                    text: quote.hitokoto,
                    author: quote.from_who.unwrap_or(quote.from),
                    source: "一言 Hitokoto".into(),
                    url: Some("https://hitokoto.cn/".into()),
                    fetched_at: chrono::Utc::now().timestamp_millis(),
                    cached: false,
                })
            } else {
                let data = self
                    .get(
                        "https://api.github.com/repos/surgar04/m78deguren/releases/latest",
                        262144,
                    )
                    .await?;
                #[derive(serde::Deserialize)]
                struct Release {
                    tag_name: String,
                    body: Option<String>,
                    html_url: String,
                    name: Option<String>,
                }
                let release: Release =
                    serde_json::from_slice(&data).map_err(|_| error("版本公告格式无效"))?;
                let url = reqwest::Url::parse(&release.html_url)
                    .map_err(|_| error("版本公告链接无效"))?;
                if url.scheme() != "https"
                    || url.host_str() != Some("github.com")
                    || !url.path().starts_with("/surgar04/m78deguren/releases/")
                {
                    return Err(error("版本公告链接来源不匹配"));
                }
                Ok(Content {
                    title: release
                        .name
                        .unwrap_or(release.tag_name)
                        .chars()
                        .take(200)
                        .collect(),
                    text: release
                        .body
                        .unwrap_or_default()
                        .chars()
                        .take(12000)
                        .collect(),
                    author: "surgar04".into(),
                    source: "臻境 GitHub Releases".into(),
                    url: Some(url.into()),
                    fetched_at: chrono::Utc::now().timestamp_millis(),
                    cached: false,
                })
            }
        }
        .await;
        match result {
            Ok(value) => {
                save_json(&path, &value).await?;
                Ok(value)
            }
            Err(_) if cached.is_some() => {
                let mut value = cached.ok_or_else(|| error("缓存不可用"))?;
                value.cached = true;
                value.source.push_str(" · 离线缓存");
                Ok(value)
            }
            Err(_) if kind == "announcement" => Ok(Content {
                title: format!("臻境 {}", env!("CARGO_PKG_VERSION")),
                text: include_str!("../../../../CHANGELOG.md")
                    .chars()
                    .take(12000)
                    .collect(),
                author: "surgar04".into(),
                source: "本地版本说明 · 在线公告暂不可用".into(),
                url: None,
                fetched_at: chrono::Utc::now().timestamp_millis(),
                cached: false,
            }),
            Err(cause) => Err(cause),
        }
    }
    pub async fn picture(&self, refresh: bool) -> Result<Picture> {
        let _guard = self.content_lock.lock().await;
        let path = self.root.join("cache/picture.json");
        crate::services::tools::check_local_path(&path).await?;
        let cached = read_limited(&path, 4_194_304)
            .await
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Picture>(&bytes).ok());
        if !refresh && let Some(value) = cached.as_ref() {
            return Ok(value.clone());
        }
        let mut at = self.picture_at.lock().await;
        if at.is_some_and(|v| v.elapsed() < Duration::from_secs(3)) {
            return Err(error("图片刷新过快，请稍候"));
        }
        *at = Some(Instant::now());
        drop(at);
        let seed = uuid::Uuid::new_v4();
        let info = self
            .get(&format!("https://picsum.photos/seed/{seed}/info"), 65536)
            .await?;
        #[derive(serde::Deserialize)]
        struct Photo {
            id: String,
            author: String,
        }
        let info: Photo = serde_json::from_slice(&info).map_err(|_| error("图片信息格式无效"))?;
        if info.id.is_empty()
            || info.id.len() > 12
            || !info.id.bytes().all(|b| b.is_ascii_digit())
            || info.author.len() > 1024
        {
            return Err(error("图片信息超出限制"));
        }
        let image = self
            .get(
                &format!("https://picsum.photos/id/{}/1000/600.jpg", info.id),
                8_388_608,
            )
            .await?;
        let jpeg = tauri::async_runtime::spawn_blocking(move || -> Result<Vec<u8>> {
            // 先检查尺寸再完整解码，拒绝压缩炸弹；去掉第三方图片的元数据后统一输出 JPEG。
            let reader = image::ImageReader::new(std::io::Cursor::new(&image))
                .with_guessed_format()
                .map_err(io_error)?;
            let (width, height) = reader
                .into_dimensions()
                .map_err(|_| error("图片格式无法识别"))?;
            if width == 0 || height == 0 || width > 4096 || height > 4096 {
                return Err(error("图片尺寸超出限制"));
            }
            let decoded = image::load_from_memory(&image).map_err(|_| error("图片解码失败"))?;
            let mut bytes = Vec::new();
            image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, 88)
                .encode_image(&decoded)
                .map_err(|_| error("图片编码失败"))?;
            Ok(bytes)
        })
        .await
        .map_err(|_| error("图片处理任务失败"))??;
        let directory = self.root.join("cache");
        crate::services::tools::check_local_path(&directory).await?;
        tokio::fs::create_dir_all(&directory)
            .await
            .map_err(io_error)?;
        let image_path = directory.join(format!("picture-{}.jpg", info.id));
        crate::services::tools::check_local_path(&image_path).await?;
        tokio::fs::write(&image_path, &jpeg)
            .await
            .map_err(io_error)?;
        let picture = Picture {
            id: info.id,
            author: info.author,
            source: "Lorem Picsum / Unsplash".into(),
            data: format!(
                "data:image/jpeg;base64,{}",
                base64::engine::general_purpose::STANDARD.encode(jpeg)
            ),
            fetched_at: chrono::Utc::now().timestamp_millis(),
        };
        save_json(&path, &picture).await?;
        if let Some(previous) = cached
            && previous.id != picture.id
            && !previous.id.is_empty()
            && previous.id.len() <= 12
            && previous.id.bytes().all(|b| b.is_ascii_digit())
        {
            let old = self.root.join(format!("cache/picture-{}.jpg", previous.id));
            crate::services::tools::check_local_path(&old).await?;
            let _ = tokio::fs::remove_file(old).await;
        }
        Ok(picture)
    }
    pub async fn save_picture(&self, id: &str, app: &tauri::AppHandle) -> Result<Option<String>> {
        use tauri_plugin_dialog::DialogExt;
        let _guard = self.content_lock.lock().await;
        let picture = self.picture_cached(id).await?;
        let app = app.clone();
        let name = format!("臻境-图片-{}.jpg", picture.id);
        let target = tauri::async_runtime::spawn_blocking(move || {
            app.dialog()
                .file()
                .set_title("保存图片")
                .set_file_name(name)
                .add_filter("JPEG 图片", &["jpg"])
                .blocking_save_file()
        })
        .await
        .map_err(|_| error("图片保存对话框失败"))?;
        let Some(target) = target else {
            return Ok(None);
        };
        let target = target.into_path().map_err(|_| error("保存路径无效"))?;
        crate::services::tools::check_local_path(&target).await?;
        if !target
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("jpg") || ext.eq_ignore_ascii_case("jpeg"))
        {
            return Err(error("请选择 JPEG 文件名"));
        }
        use tokio::io::AsyncWriteExt;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(picture.data.trim_start_matches("data:image/jpeg;base64,"))
            .map_err(|_| error("图片缓存无效"))?;
        let mut file = tokio::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&target)
            .await
            .map_err(|_| error("目标已存在或不可写，请选择新的文件名"))?;
        file.write_all(&bytes).await.map_err(io_error)?;
        file.sync_all().await.map_err(io_error)?;
        Ok(Some(target.to_string_lossy().into_owned()))
    }
    async fn picture_cached(&self, id: &str) -> Result<Picture> {
        if id.is_empty() || id.len() > 12 || !id.bytes().all(|b| b.is_ascii_digit()) {
            return Err(error("图片标识无效"));
        }
        let path = self.root.join("cache/picture.json");
        crate::services::tools::check_local_path(&path).await?;
        let data = read_limited(&path, 4_194_304).await?;
        if data.len() > 4_194_304 {
            return Err(error("图片缓存过大"));
        }
        let picture: Picture = serde_json::from_slice(&data).map_err(|_| error("图片缓存无效"))?;
        if picture.id != id {
            return Err(error("图片已刷新，请重新操作"));
        }
        Ok(picture)
    }
    pub async fn picture_wallpaper(
        &self,
        id: &str,
        app: &tauri::AppHandle,
    ) -> Result<crate::services::settings::assets::Asset> {
        use tauri::Manager;
        let _guard = self.content_lock.lock().await;
        self.picture_cached(id).await?;
        let settings = app.state::<crate::services::settings::SettingsState>();
        let _guard = settings.serial.lock().await;
        let store = settings.assets.lock().await.clone();
        let path = self.root.join(format!("cache/picture-{id}.jpg"));
        let asset =
            tauri::async_runtime::spawn_blocking(move || store.import(&path, "image", |_| Ok(())))
                .await
                .map_err(|_| error("壁纸导入任务失败"))??;
        settings.assets.lock().await.record(asset.clone()).await?;
        use tauri::Emitter;
        let _ = app.emit("settings-assets-changed", ());
        Ok(asset)
    }
}
