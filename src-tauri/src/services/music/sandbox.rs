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
    // 仅对窗口创建单飞，避免首次登录的并发请求复用尚未加载的窗口。
    // 就绪后与上游一致由浏览器事件循环执行脚本，不用一个长 Promise 堵塞其他调用。
    // watch 使用实例票据，旧页面迟到的 ready 不能让新窗口误判为已就绪。
    let guard = tokio::time::timeout(Duration::from_secs(30), state.sandbox_gate.lock())
        .await
        .map_err(|_| error("音乐脚本沙箱繁忙，请重试"))?;
    let window = if let Some(window) = app.get_webview_window("music-sandbox")
        && state.sandbox_ready.borrow().1
    {
        window
    } else {
        if let Some(stale) = app.get_webview_window("music-sandbox") {
            retire(app, &stale).await?;
        }
        let generation = uuid::Uuid::new_v4().to_string();
        state
            .sandbox_ready
            .send_replace((generation.clone(), false));
        let url = format!("http://zhenjing-music.localhost/sandbox?generation={generation}");
        let navigation = url.clone();
        let data = state.root.join("sandbox-profile");
        crate::services::tools::check_local_path(&data).await?;
        tokio::fs::create_dir_all(&data)
            .await
            .map_err(crate::services::tools::io_error)?;
        let window = WebviewWindowBuilder::new(
            app,
            "music-sandbox",
            WebviewUrl::External(url.parse().map_err(|_| error("沙箱地址无效"))?),
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
            // Wry 的显式参数会覆盖默认参数（包括 proxy_url 生成的代理参数），因此必须完整列出。
            "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --proxy-server=socks5://127.0.0.1:1 --disable-non-proxied-udp --force-webrtc-ip-handling-policy=disable_non_proxied_udp",
        )
        .on_navigation(move |url| url.as_str() == navigation)
        .build()
        .map_err(|cause| error(format!("无法创建隔离的音乐脚本沙箱：{cause}")))?;
        let mut ready = state.sandbox_ready.subscribe();
        if tokio::time::timeout(
            // WebView2 首次创建用户档案明显慢于 Electron 复用的浏览器进程。
            // 冷启动仍有界；配合宿主 60 秒回调预算，避免正常初始化被提前中断。
            Duration::from_secs(25),
            ready.wait_for(|(ticket, ready)| ticket == &generation && *ready),
        )
        .await
        .is_err()
        {
            state.sandbox_ready.send_replace((String::new(), false));
            let _ = retire(app, &window).await;
            return Err(error(
                "音乐脚本沙箱加载超时，已清理，可直接重试，无需重启应用",
            ));
        }
        window
    };
    drop(guard);
    let ticket = uuid::Uuid::new_v4().to_string();
    let (sender, receiver) = tokio::sync::oneshot::channel();
    {
        let mut pending = state.sandbox_results.lock().await;
        // 宿主断线会取消执行 Future；回收已关闭接收端，避免留下永不使用的票据。
        pending.retain(|_, sender| !sender.is_closed());
        pending.insert(ticket.clone(), sender);
    }
    let encoded = serde_json::to_string(source).map_err(|_| error("播放器脚本编码失败"))?;
    let script = format!(
        "Promise.resolve().then(()=> (0,eval)({encoded})).then(value=>fetch('/sandbox-result/{ticket}',{{method:'POST',body:JSON.stringify({{ok:true,value:value??null}})}}),()=>fetch('/sandbox-result/{ticket}',{{method:'POST',body:JSON.stringify({{ok:false}})}}));"
    );
    if window.eval(&script).is_err() {
        state.sandbox_results.lock().await.remove(&ticket);
        state.sandbox_ready.send_replace((String::new(), false));
        let _ = retire(app, &window).await;
        return Err(error("音乐脚本未能启动"));
    }
    let result = tokio::time::timeout(Duration::from_secs(15), receiver).await;
    state.sandbox_results.lock().await.remove(&ticket);
    match result {
        Ok(Ok(value)) if value["ok"] == true => Ok(value["value"].clone()),
        _ => {
            state.sandbox_ready.send_replace((String::new(), false));
            let _ = retire(app, &window).await;
            Err(error("YouTube 播放器脚本未完成，请重试"))
        }
    }
}

/// destroy 投递到窗口线程后并不立即注销标签；确认注销后才能用相同标签重建。
async fn retire(app: &tauri::AppHandle, window: &tauri::WebviewWindow) -> Result<()> {
    let _ = window.destroy();
    for _ in 0..80 {
        if app.get_webview_window("music-sandbox").is_none() {
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    Err(error("音乐脚本窗口尚未释放，请稍后重试"))
}

/// 仅当前窗口实例可以完成 ready 握手；旧页面和重复回调不会污染新实例。
pub fn ready(channel: &tokio::sync::watch::Sender<(String, bool)>, ticket: &str) {
    channel.send_if_modified(|(active, ready)| {
        if active != ticket || *ready {
            return false;
        }
        *ready = true;
        true
    });
}

#[cfg(test)]
mod tests {
    #[tokio::test]
    async fn readiness_is_retained_and_scoped_to_window_instance()
    -> Result<(), Box<dyn std::error::Error>> {
        let (channel, _) = tokio::sync::watch::channel(("first".to_owned(), false));
        super::ready(&channel, "first");
        // 握手先于订阅发生也不能丢失，重试无需重新启动整个应用。
        let mut receiver = channel.subscribe();
        assert!(receiver.wait_for(|(_, ready)| *ready).await?.1);
        channel.send_replace(("second".to_owned(), false));
        super::ready(&channel, "first");
        assert!(!channel.borrow().1);
        super::ready(&channel, "second");
        assert!(channel.borrow().1);
        Ok(())
    }
}
