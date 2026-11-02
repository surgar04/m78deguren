//! YouTube 播放器脚本只在无应用权限、无外网的独立 WebView 执行，保留 BotGuard 跨次调用的内存。
use super::MusicState;
use crate::services::tools::{Result, error};
use serde_json::Value;
use std::time::Duration;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

pub async fn evaluate(app: &tauri::AppHandle, state: &MusicState, source: &str) -> Result<Value> {
    if source.len() > 4 * 1024 * 1024 {
        return Err(error("播放器脚本超过上限"));
    }
    let window = if let Some(window) = app.get_webview_window("music-sandbox") {
        window
    } else {
        let data = state.root.join("sandbox-profile");
        crate::services::tools::check_local_path(&data).await?;
        tokio::fs::create_dir_all(&data)
            .await
            .map_err(crate::services::tools::io_error)?;
        let window = WebviewWindowBuilder::new(
            app,
            "music-sandbox",
            WebviewUrl::External(
                "http://zhenjing-music.localhost/sandbox"
                    .parse()
                    .map_err(|_| error("沙箱地址无效"))?,
            ),
        )
        .visible(false)
        .decorations(false)
        .skip_taskbar(true)
        .data_directory(data)
        .proxy_url(
            "socks5://127.0.0.1:1"
                .parse()
                .map_err(|_| error("沙箱网络隔离失败"))?,
        )
        .additional_browser_args(
            "--disable-non-proxied-udp --force-webrtc-ip-handling-policy=disable_non_proxied_udp",
        )
        .on_navigation(|url| url.as_str() == "http://zhenjing-music.localhost/sandbox")
        .build()
        .map_err(|_| error("无法创建隔离的音乐脚本沙箱"))?;
        tokio::time::timeout(Duration::from_secs(10), state.sandbox_ready.notified())
            .await
            .map_err(|_| error("音乐脚本沙箱加载超时"))?;
        window
    };
    let ticket = uuid::Uuid::new_v4().to_string();
    let (sender, receiver) = tokio::sync::oneshot::channel();
    state
        .sandbox_results
        .lock()
        .await
        .insert(ticket.clone(), sender);
    let encoded = serde_json::to_string(source).map_err(|_| error("播放器脚本编码失败"))?;
    let script = format!(
        "Promise.resolve().then(()=> (0,eval)({encoded})).then(value=>fetch('/sandbox-result/{ticket}',{{method:'POST',body:JSON.stringify({{ok:true,value:value??null}})}}),()=>fetch('/sandbox-result/{ticket}',{{method:'POST',body:JSON.stringify({{ok:false}})}}));"
    );
    if window.eval(&script).is_err() {
        state.sandbox_results.lock().await.remove(&ticket);
        return Err(error("音乐脚本未能启动"));
    }
    let result = tokio::time::timeout(Duration::from_secs(15), receiver).await;
    state.sandbox_results.lock().await.remove(&ticket);
    match result {
        Ok(Ok(value)) if value["ok"] == true => Ok(value["value"].clone()),
        _ => {
            let _ = window.destroy();
            Err(error("YouTube 播放器脚本未完成，请重试"))
        }
    }
}
