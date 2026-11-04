//! 官方网页隔离授权。凭据留在 WebView2 档案内，不复制浏览器 Cookie，不向应用前端暴露认证标识。
use super::*;
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::sync::oneshot;

const LABEL: &str = "delta-wegame-auth";
const URL: &str = "https://www.wegame.com.cn/helper/df/score/";
pub struct WeGame {
    root: PathBuf,
    data: Mutex<Value>,
    phase: Mutex<String>,
    message: Mutex<String>,
    updated: AtomicU64,
    generation: AtomicU64,
    serial: Mutex<()>,
}
impl WeGame {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            data: Mutex::new(json!({})),
            phase: Mutex::new("disconnected".into()),
            message: Mutex::new(String::new()),
            updated: AtomicU64::new(0),
            generation: AtomicU64::new(0),
            serial: Mutex::new(()),
        }
    }
    pub async fn account(&self) -> Value {
        self.load().await;
        let data = self.data.lock().await;
        let field_text = |value: &Value| {
            value
                .as_str()
                .map(str::to_owned)
                .or_else(|| value.as_u64().map(|n| n.to_string()))
                .unwrap_or_default()
        };
        let level = data["role"]
            .get("level")
            .filter(|v| !v.is_null())
            .or_else(|| data["role"].get("sol_level"))
            .or_else(|| data["role"].get("tdm_level"))
            .unwrap_or(&Value::Null);
        json!({"phase":self.phase.lock().await.clone(),"message":self.message.lock().await.clone(),"nickname":field_text(&data["role"]["name"]),"avatar":field_text(&data["role"]["icon"]),"level":field_text(level),"updatedAt":self.updated.load(Ordering::Relaxed)})
    }
    async fn load(&self) {
        let mut data = self.data.lock().await;
        if !data.as_object().is_some_and(|v| v.is_empty()) {
            return;
        }
        if let Some(cache) =
            community::read_cache(&self.root.join("wegame-cache.json"), 16_777_216).await
        {
            *data = cache["data"].clone();
            self.updated
                .store(cache["updatedAt"].as_u64().unwrap_or(0), Ordering::Relaxed);
        }
    }
    pub async fn snapshot(&self) -> Value {
        self.load().await;
        let account = self.account().await;
        json!({"account":account,"data":self.data.lock().await.clone(),"updatedAt":self.updated.load(Ordering::Relaxed)})
    }
    pub async fn open(
        &self,
        app: &tauri::AppHandle,
        visible: bool,
    ) -> Result<tauri::WebviewWindow> {
        let pending = self.root.join("wegame-logout-pending.json");
        if tokio::fs::try_exists(&pending).await.map_err(io_error)? {
            self.clear_profile().await?;
            tokio::fs::remove_file(pending).await.map_err(io_error)?;
        }
        if let Some(window) = app.get_webview_window(LABEL) {
            if visible {
                window.show().map_err(|_| error("授权窗口显示失败"))?;
                window.set_focus().map_err(|_| error("授权窗口焦点失败"))?;
            }
            return Ok(window);
        }
        let directory = self.root.join("wegame-profile");
        crate::services::tools::check_local_path(&directory).await?;
        tokio::fs::create_dir_all(&directory)
            .await
            .map_err(io_error)?;
        let url = reqwest::Url::parse(URL).map_err(|_| error("WeGame 地址无效"))?;
        tauri::WebviewWindowBuilder::new(app, LABEL, tauri::WebviewUrl::External(url))
            .title("臻境 · WeGame 官方 QQ / 微信扫码授权")
            .inner_size(1040.0, 760.0)
            .visible(visible)
            .always_on_top(true)
            .data_directory(directory)
            .on_navigation(|url| {
                url.scheme() == "https"
                    && url.host_str().is_some_and(|host| {
                        host == "wegame.com.cn"
                            || host.ends_with(".wegame.com.cn")
                            || host == "qq.com"
                            || host.ends_with(".qq.com")
                    })
            })
            .build()
            .map_err(|_| error("无法打开 WeGame 官方授权窗口，请检查 WebView2"))
    }
    pub async fn login(&self, app: &tauri::AppHandle) -> Result<()> {
        self.open(app, true).await?;
        *self.phase.lock().await = "authorizing".into();
        *self.message.lock().await = "请在官方窗口选择 QQ 或微信并扫码；完成前请勿关闭窗口".into();
        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            log::info!("三角洲官方授权任务已开始");
            let state = app.state::<GameRoomState>();
            let service = &state.wegame;
            let deadline = tokio::time::Instant::now() + Duration::from_secs(180);
            while tokio::time::Instant::now() < deadline {
                tokio::time::sleep(Duration::from_secs(3)).await;
                if service.generation.load(Ordering::SeqCst) != generation {
                    log::info!("三角洲官方授权任务已取消或被新会话替代");
                    return;
                }
                if app.get_webview_window(LABEL).is_none() {
                    *service.phase.lock().await = "error".into();
                    *service.message.lock().await =
                        "授权窗口已关闭，尚未确认授权成功；请重新连接".into();
                    log::info!("三角洲官方授权任务因窗口关闭结束");
                    return;
                }
                let collected = tokio::time::timeout_at(
                    deadline,
                    service.collect(&app, json!({"kind":"refresh"}), false),
                )
                .await;
                if service.generation.load(Ordering::SeqCst) != generation {
                    log::info!("三角洲官方授权任务已取消或被新会话替代");
                    return;
                }
                match collected {
                    Ok(Ok(_)) => {
                        *service.phase.lock().await = "connected".into();
                        *service.message.lock().await = String::new();
                        if let Some(window) = app.get_webview_window(LABEL) {
                            let _ = window.hide();
                        }
                        log::info!("三角洲官方授权任务已完成");
                        return;
                    }
                    Ok(Err(_)) => continue,
                    Err(_) => break,
                }
            }
            *service.phase.lock().await = "error".into();
            *service.message.lock().await =
                "授权等待超时，可能尚未扫码、角色未绑定或官方网络不可用；请重试".into();
            log::warn!("三角洲官方授权任务超时");
        });
        Ok(())
    }
    pub async fn collect(
        &self,
        app: &tauri::AppHandle,
        command: Value,
        create: bool,
    ) -> Result<Value> {
        let _serial = self.serial.lock().await;
        let window = if create {
            self.open(app, false).await?
        } else {
            app.get_webview_window(LABEL)
                .ok_or_else(|| error("授权窗口已关闭"))?
        };
        // 首次新建窗口先等真实页面就绪，避免 eval 随导航丢失，表现为首次刷新一直等待。
        let generation = self.generation.load(Ordering::SeqCst);
        let mut ready = false;
        let ready_deadline = tokio::time::Instant::now() + Duration::from_secs(20);
        while tokio::time::Instant::now() < ready_deadline {
            if self.generation.load(Ordering::SeqCst) != generation {
                return Err(error("授权或刷新已取消"));
            }
            let location = window.url().map_err(|_| error("无法读取授权窗口状态"))?;
            if location.scheme() == "https"
                && location.host_str() == Some("www.wegame.com.cn")
                && location.path().starts_with("/helper/df/")
            {
                let (sender, receiver) = oneshot::channel();
                let sender = std::sync::Mutex::new(Some(sender));
                window
                    .eval_with_callback(
                        "JSON.stringify({ready:document.readyState!=='loading'})",
                        move |value| {
                            if let Ok(mut slot) = sender.lock()
                                && let Some(sender) = slot.take()
                            {
                                let _ = sender.send(value);
                            }
                        },
                    )
                    .map_err(|_| error("官方页面尚未就绪"))?;
                if let Ok(Ok(raw)) = tokio::time::timeout(Duration::from_secs(2), receiver).await
                    && decode_result(&raw).is_ok_and(|value| value["ready"] == true)
                {
                    ready = true;
                    break;
                }
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
        if !ready {
            return Err(error("官方页面未就绪，请在官方授权窗口完成登录后重试"));
        }
        let slot = format!("__zhenjing_{}", uuid::Uuid::new_v4().simple());
        let key = serde_json::to_string(&slot).map_err(|_| error("采集标识编码失败"))?;
        let script = include_str!("wegame.js.txt")
            .replacen("__SLOT__", &key, 1)
            .replacen("__COMMAND__", &command.to_string(), 1);
        window
            .eval(&script)
            .map_err(|_| error("官方战绩采集未能开始"))?;
        for _ in 0..104 {
            tokio::time::sleep(Duration::from_secs(1)).await;
            if self.generation.load(Ordering::SeqCst) != generation {
                return Err(error("授权或刷新已取消"));
            }
            let (sender, receiver) = oneshot::channel();
            let sender = std::sync::Mutex::new(Some(sender));
            window
                .eval_with_callback(
                    format!("JSON.stringify(window[{key}] || {{ready:false}})"),
                    move |response| {
                        if let Ok(mut slot) = sender.lock()
                            && let Some(sender) = slot.take()
                        {
                            let _ = sender.send(response);
                        }
                    },
                )
                .map_err(|_| error("授权窗口已关闭，无法读取数据"))?;
            let raw = tokio::time::timeout(Duration::from_secs(4), receiver)
                .await
                .map_err(|_| error("官方页面响应超时，请重新连接"))?
                .map_err(|_| error("官方页面采集通道已关闭"))?;
            let value = decode_result(&raw)?;
            if value["ready"] != true {
                continue;
            }
            let _ = window.eval(format!("delete window[{key}]"));
            if value["ok"] != true {
                let message = match value["code"].as_str() {
                    Some("authorization") => {
                        "WeGame 授权失效、未绑定三角洲角色或该账号暂无战绩，请在官方窗口确认"
                    }
                    Some("timeout") => "官方数据请求超时，请检查网络后刷新",
                    _ => "无法获取官方战绩，请检查网络或稍后重试",
                };
                if *self.phase.lock().await != "authorizing" {
                    *self.phase.lock().await = "error".into();
                    *self.message.lock().await = message.into();
                }
                return Err(error(message));
            }
            let updates = value["data"]
                .as_object()
                .ok_or_else(|| error("官方战绩响应缺少业务数据"))?;
            let mut data = self.data.lock().await;
            if !data.is_object() {
                *data = json!({});
            }
            // 切换角色时清空旧账号缓存，禁止把两个账号的战绩合并。
            if updates.contains_key("role") {
                *data = json!({});
            }
            for (key, value) in updates {
                data[key] = value.clone();
            }
            data["errors"] = value["errors"].clone();
            let at = chrono::Utc::now().timestamp_millis() as u64;
            crate::services::tools::save_json(
                &self.root.join("wegame-cache.json"),
                &json!({"data":*data,"updatedAt":at}),
            )
            .await?;
            self.updated.store(at, Ordering::Relaxed);
            *self.phase.lock().await = "connected".into();
            *self.message.lock().await = String::new();
            return Ok(json!({"data":*data,"updatedAt":at}));
        }
        Err(error("官方战绩采集超时，请重新连接；已有缓存保留"))
    }
    pub async fn logout(&self, app: &tauri::AppHandle) -> Result<()> {
        self.generation.fetch_add(1, Ordering::SeqCst);
        let _serial = self.serial.lock().await;
        let pending = self.root.join("wegame-logout-pending.json");
        crate::services::tools::save_json(&pending, &json!({"pending":true})).await?;
        if let Some(window) = app.get_webview_window(LABEL) {
            window
                .clear_all_browsing_data()
                .map_err(|_| error("官方登录资料未能清除，请关闭授权窗口后重试"))?;
            window
                .destroy()
                .map_err(|_| error("官方授权窗口关闭失败"))?;
        }
        self.clear_profile().await?;
        tokio::fs::remove_file(pending).await.map_err(io_error)?;
        let path = self.root.join("wegame-cache.json");
        crate::services::tools::check_local_path(&path).await?;
        match tokio::fs::remove_file(path).await {
            Ok(()) => {}
            Err(cause) if cause.kind() == std::io::ErrorKind::NotFound => {}
            Err(cause) => return Err(io_error(cause)),
        }
        *self.data.lock().await = json!({});
        self.updated.store(0, Ordering::Relaxed);
        *self.phase.lock().await = "disconnected".into();
        *self.message.lock().await = String::new();
        log::info!("三角洲官方数据源已退出");
        Ok(())
    }
    /// WebView2 退出会异步释放文件句柄；仅删除确定的专用档案，失败保留退出标记，禁止带旧会话重新授权。
    async fn clear_profile(&self) -> Result<()> {
        let path = self.root.join("wegame-profile");
        crate::services::tools::check_local_path(&path).await?;
        for _ in 0..8 {
            match tokio::fs::remove_dir_all(&path).await {
                Ok(()) => return Ok(()),
                Err(cause) if cause.kind() == std::io::ErrorKind::NotFound => return Ok(()),
                Err(_) => tokio::time::sleep(Duration::from_millis(300)).await,
            }
        }
        Err(error(
            "授权窗口已关闭，但官方登录资料仍被占用。请退出臻境后重试；清理完成前不会复用旧会话",
        ))
    }
    pub async fn cancel(&self, app: &tauri::AppHandle) -> Result<()> {
        self.generation.fetch_add(1, Ordering::SeqCst);
        if let Some(window) = app.get_webview_window(LABEL) {
            window.destroy().map_err(|_| error("授权窗口关闭失败"))?;
        }
        *self.phase.lock().await = "disconnected".into();
        *self.message.lock().await = "本次授权已取消，既有离线缓存保留".into();
        Ok(())
    }
}
fn decode_result(raw: &str) -> Result<Value> {
    if raw.len() > 24_000_000 {
        return Err(error("战绩数据超过安全上限"));
    }
    let value: Value =
        serde_json::from_str(raw).map_err(|_| error("官方页面返回了无法识别的数据"))?;
    if let Some(text) = value.as_str() {
        serde_json::from_str(text).map_err(|_| error("官方页面业务数据格式无效"))
    } else {
        Ok(value)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn callback_accepts_object_and_json_string_without_exposing_credentials() {
        assert!(decode_result(r#"{"ready":true,"ok":false}"#).is_ok());
        assert!(decode_result(r#""{\"ready\":true}""#).is_ok());
        assert!(decode_result("not-json").is_err());
    }
}
