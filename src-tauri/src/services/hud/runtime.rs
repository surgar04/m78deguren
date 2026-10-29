//! 低频编排与场景状态机。动画在前端只随场景变化执行；原生不做逐帧 IPC 或历史拷贝。
use super::{HudState, config::Config, window};
use crate::services::{
    hardware::Hardware,
    home::HomeState,
    settings::SettingsState,
    steam::SteamState,
    tools::{Result, ToolsState, error},
};
use serde_json::{Value, json};
use std::{
    sync::atomic::Ordering,
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager};
use tokio::io::AsyncWriteExt;

pub fn scene_queue(config: &Config, media: bool, downloads: bool) -> Vec<String> {
    let mut queue = if config.queue.is_empty() {
        vec![config.active_profile.clone()]
    } else {
        config.queue.clone()
    };
    if media {
        queue.push("@media".into());
    }
    if downloads {
        queue.push("@downloads".into());
    }
    queue
}
pub fn boot(app: &tauri::AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut context = Context::default();
        loop {
            let state = app.state::<HudState>();
            if state.cancellation.is_cancelled() {
                let hardware = app.state::<Hardware>();
                let _ = release_frames(&hardware, &mut context).await;
                break;
            }
            let config = state.config.lock().await.clone();
            let now = chrono::Utc::now().timestamp_millis();
            let preview = state.preview_until.load(Ordering::Relaxed) > now;
            if let Err(cause) = tick(&app, &config, preview, &mut context).await {
                let mut snapshot = state.snapshot.write().await;
                if let Some(object) = snapshot.as_object_mut() {
                    object.insert("error".into(), json!(cause.to_string()));
                }
            }
            let duration = if config.enabled || preview {
                Duration::from_millis(1000)
            } else if context.owns_hardware {
                Duration::from_secs(2)
            } else {
                Duration::from_secs(60)
            };
            // 设置改变和预览请求只唤醒等待，不创建额外任务。
            tokio::select! {_=state.cancellation.cancelled()=>{},_ = state.wake.notified()=>{},_ = tokio::time::sleep(duration)=>{}}
        }
    });
}
struct Context {
    since: Instant,
    window_key: Vec<u8>,
    native_input: Vec<u8>,
    native_generation: u64,
    frames: Option<u64>,
    frames_attempted: bool,
    owns_hardware: bool,
    next_paths: Instant,
    paths: Vec<String>,
    visible_until: Instant,
    power: Option<bool>,
    power_until: Instant,
    shown: bool,
    last_trigger: i64,
    frame_error: Option<String>,
    frame_target: u32,
}
impl Default for Context {
    fn default() -> Self {
        let now = Instant::now();
        Self {
            since: now,
            window_key: vec![],
            native_input: vec![],
            native_generation: 0,
            frames: None,
            frames_attempted: false,
            owns_hardware: false,
            next_paths: now,
            paths: vec![],
            visible_until: now,
            power: None,
            power_until: now,
            shown: false,
            last_trigger: 0,
            frame_error: None,
            frame_target: 0,
        }
    }
}
async fn release_frames(hardware: &Hardware, context: &mut Context) -> Result<()> {
    if let Some(generation) = context.frames.take() {
        let frames = hardware.frames.clone();
        tauri::async_runtime::spawn_blocking(move || {
            if frames.generation() == generation {
                frames.stop()
            } else {
                Ok(())
            }
        })
        .await
        .map_err(|_| error("HUD 帧采样停止任务失败"))??;
    }
    context.frames_attempted = false;
    context.frame_error = None;
    Ok(())
}
async fn send(hardware: &Hardware, value: &Value, context: &mut Context) -> Result<()> {
    let mut bytes = serde_json::to_vec(value).map_err(|_| error("HUD 控制消息无效"))?;
    if bytes.len() > 524288 {
        return Err(error("HUD 控制消息过大"));
    }
    bytes.push(b'\n');
    let generation = hardware.hud_generation.load(Ordering::Acquire);
    if context.native_generation != generation {
        context.native_input.clear();
        context.native_generation = generation;
    }
    // 即使内容相同也在助手重启后重发；不把写入旧进程的成功状态当作新进程已配置。
    if let Some(input) = hardware.hud_input.lock().await.as_mut() {
        if bytes != context.native_input {
            tokio::time::timeout(Duration::from_secs(1), input.write_all(&bytes))
                .await
                .map_err(|_| error("HUD 控制通道超时"))?
                .map_err(crate::services::tools::io_error)?;
            context.native_input = bytes;
        }
    } else {
        context.native_input.clear();
    }
    Ok(())
}
async fn tick(
    app: &tauri::AppHandle,
    config: &Config,
    preview: bool,
    context: &mut Context,
) -> Result<()> {
    let state = app.state::<HudState>();
    let hardware = app.state::<Hardware>();
    let now = chrono::Utc::now().timestamp_millis();
    // 预览仅续租数据采集，不能续租桌面窗口；关闭开关在编辑器仍打开时也必须立即生效。
    if !config.enabled {
        release_frames(&hardware, context).await?;
        if let Some(window) = app.get_webview_window("hud") {
            let _ = app.emit_to("hud", "hud-closing", ());
            tokio::time::sleep(Duration::from_millis(220)).await;
            window.destroy().map_err(|_| error("HUD 关闭失败"))?;
        }
        context.shown = false;
        context.window_key.clear();
    }
    if !config.enabled && !preview {
        send(&hardware,&json!({"enabled":false,"active":false,"samplingMs":1000,"locale":"zh-CN","settings":{"profiles":[]}}),context).await?;
        let settings = app.state::<SettingsState>();
        let needed = {
            let native = settings.config.lock().await;
            native.media_keys || native.hotkeys_enabled
        };
        if !needed {
            settings.media.stop().await?;
        }
        if context.owns_hardware
            && now - hardware.ui_seen.load(Ordering::Relaxed) > 10000
            && !hardware.remote.is_active().await
            && hardware.pause_if_idle().await?
        {
            context.owns_hardware = false;
        }
        return Ok(());
    }
    if hardware.snapshot.read().await.status == "stopped" {
        context.owns_hardware = true;
    }
    hardware.start().await?;
    let settings = app.state::<SettingsState>();
    settings
        .media
        .ensure(&settings.root.join("settings"))
        .await?;
    let media = settings.media.snapshot.lock().await.clone();
    let downloads=app.state::<ToolsState>().downloads.list().await.into_iter()
        .filter(|t|matches!(t.status.as_str(),"running"|"probing"|"downloading"|"queued"|"verifying")).take(8)
        .map(|t|json!({"id":t.id,"name":t.file_name,"downloaded":t.downloaded,"total":t.total,"status":t.status})).collect::<Vec<_>>();
    let current = hardware.snapshot.read().await;
    let fresh = current.captured_at.is_some_and(|time| now - time <= 5000);
    let mut metrics = if fresh {
        current.metrics.clone()
    } else {
        Default::default()
    };
    if fresh
        && let Some(gpu) = current.gpus.iter().max_by(|a, b| {
            a.metrics
                .get("gpu")
                .and_then(|v| *v)
                .unwrap_or(0.0)
                .total_cmp(&b.metrics.get("gpu").and_then(|v| *v).unwrap_or(0.0))
        })
    {
        metrics.extend(gpu.metrics.clone());
    }
    let foreground = current.process_id;
    drop(current);
    let game = hardware.game.read().await.clone();
    let detected = game["processId"].as_u64().filter(|_| fresh).unwrap_or(0) as u32;
    let gaming = config.mode == "game" || (config.mode == "auto" && detected > 0);
    let target = if detected > 0 {
        detected
    } else if foreground != std::process::id() {
        foreground
    } else {
        0
    };
    let mut queue = scene_queue(config, media.available, !downloads.is_empty());
    if downloads.len() > 1 {
        queue.retain(|scene| scene != "@downloads");
        queue.extend(
            downloads
                .iter()
                .filter_map(|task| task["id"].as_str().map(|id| format!("@downloads:{id}"))),
        );
    }
    let timed = if config.auto_cycle || media.available || !downloads.is_empty() {
        context.since.elapsed().as_secs() as usize / config.cycle_seconds as usize
    } else {
        0
    };
    let index = (timed + state.cycle.load(Ordering::Relaxed)) % queue.len();
    let power = hardware
        .hud
        .read()
        .await
        .get("power")
        .cloned()
        .unwrap_or_default();
    if let Some(ac) = power["acOnline"].as_bool() {
        if context.power.is_some_and(|old| old != ac)
            && config.power_events
            && power["hasBattery"].as_bool() == Some(true)
        {
            context.power_until =
                Instant::now() + Duration::from_secs(u64::from(config.display_seconds));
            context.visible_until = context.power_until;
        }
        context.power = Some(ac);
    }
    let power_event = context.power_until > Instant::now();
    let scene = if gaming {
        "@game".to_owned()
    } else if power_event {
        if context.power == Some(true) {
            "@power-ac".into()
        } else {
            "@power-battery".into()
        }
    } else {
        queue[index].clone()
    };
    let profile_id = if power_event && !gaming {
        "system.battery"
    } else if scene.starts_with('@') {
        config.active_profile.as_str()
    } else {
        scene.as_str()
    };
    let profile = config
        .profiles
        .iter()
        .find(|p| p["id"].as_str() == Some(profile_id))
        .ok_or_else(|| error("HUD 当前方案不存在"))?;
    let needs_frames = config.enabled && config.frames && target > 0 && gaming;
    if target != context.frame_target {
        release_frames(&hardware, context).await?;
        context.frame_target = target;
    }
    if !needs_frames {
        release_frames(&hardware, context).await?;
    } else {
        if let Some(generation) = context.frames
            && hardware.frames.generation() != generation
        {
            context.frames = None;
        }
        if !hardware.frames.snapshot().enabled && !context.frames_attempted {
            context.frames_attempted = true;
            let frames = hardware.frames.clone();
            let result = tauri::async_runtime::spawn_blocking(move || {
                frames.start(Some(target))?;
                Ok::<_, crate::error::AppError>(frames.generation())
            })
            .await
            .map_err(|_| error("HUD 帧采样启动任务失败"))?;
            match result {
                Ok(generation) => context.frames = Some(generation),
                Err(cause) => {
                    log::warn!("HUD ETW：{cause}");
                    context.frame_error = Some(cause.to_string());
                }
            }
        }
        if let Some(generation) = context.frames {
            hardware.frames.hud_target(target, generation);
        }
    }
    let mut fps = hardware.frames.snapshot();
    if !config.frames {
        fps = crate::services::hardware::types::Fps {
            message: "HUD 帧采样已关闭".into(),
            ..Default::default()
        };
    } else if gaming && target == 0 {
        fps = crate::services::hardware::types::Fps {
            message: "请切换到游戏窗口以选择采样目标".into(),
            ..Default::default()
        };
    }
    if let Some(cause) = &context.frame_error {
        fps.message = format!("ETW 不可用：{cause}");
    }
    if needs_frames && fps.enabled && fps.process_id != target {
        fps = crate::services::hardware::types::Fps {
            enabled: fps.enabled,
            process_id: target,
            message: "ETW 正由硬件页面采样其他目标；请先停止或选择相同进程".into(),
            ..Default::default()
        };
    }
    let progress = media
        .duration_seconds
        .filter(|duration| *duration > 0.0)
        .and_then(|duration| {
            media
                .position_seconds
                .map(|position| (position / duration * 100.0).clamp(0.0, 100.0))
        });
    let mut external = json!({"media.available":media.available,"media.title":media.title,"media.artist":media.artist,"media.album":media.album,"media.app":media.source,
        "media.title_artist":format!("{} - {}",media.artist,media.title),"media.status_raw":media.status,"media.status":media.status,
        "media.is_playing":media.status=="playing","media.is_paused":media.status=="paused","media.has_timeline":media.duration_seconds.is_some(),
        "media.position":media.position_seconds,"media.duration":media.duration_seconds,"media.progress":progress});
    if let Some(object) = external.as_object_mut() {
        let time_text = |seconds: Option<f64>| {
            seconds.map(|v| {
                let n = v.max(0.0) as u64;
                format!("{}:{:02}", n / 60, n % 60)
            })
        };
        object.insert(
            "media.position_text".into(),
            json!(time_text(media.position_seconds)),
        );
        object.insert(
            "media.duration_text".into(),
            json!(time_text(media.duration_seconds)),
        );
        object.insert(
            "media.remaining_text".into(),
            json!(time_text(
                media
                    .duration_seconds
                    .zip(media.position_seconds)
                    .map(|(d, p)| (d - p).max(0.0))
            )),
        );
        object.insert(
            "media.progress_text".into(),
            json!(progress.map(|p| format!("{p:.0}%"))),
        );
        object.insert("app.name".into(), json!("臻境"));
        object.insert("app.version".into(), json!(env!("CARGO_PKG_VERSION")));
    }
    if context.next_paths <= Instant::now() {
        context.next_paths = Instant::now() + Duration::from_secs(30);
        context.paths = app.state::<SteamState>().game_directories(false).await;
        context.paths.extend(
            app.state::<HomeState>()
                .store
                .lock()
                .await
                .shortcuts
                .iter()
                .filter(|s| s.is_game)
                .map(|s| s.path.clone()),
        );
    }
    let triggered_at = hardware.hud.read().await["triggeredAt"]
        .as_i64()
        .unwrap_or(0);
    if triggered_at > context.last_trigger {
        context.last_trigger = triggered_at;
        if now - triggered_at <= 5000 {
            context.visible_until =
                Instant::now() + Duration::from_secs(u64::from(config.display_seconds));
        }
    }
    let peek = state.peek_until.load(Ordering::Relaxed) > now;
    let normal_visible =
        config.always_show || preview || peek || Instant::now() < context.visible_until;
    send(&hardware,&json!({"enabled":!gaming&&(normal_visible||config.triggers.iter().any(|t|t.enabled)),"active":true,"frameSampling":config.enabled&&config.frames&&normal_visible&&!gaming,"samplingMs":config.sampling_ms,"locale":state.locale.read().await.clone(),
        "settings":{"profiles":[profile],"activeProfileId":profile_id,"deepSeekApiKeyProtected":config.deepseek_key,"httpSources":config.http_sources,"triggers":config.triggers},
        "external":external,"gamePaths":context.paths,"includeProcesses":config.include_processes,"excludeProcesses":config.exclude_processes}),context).await?;
    let data = hardware.hud.read().await.clone();
    let rendered = if data["profileId"].as_str() == Some(profile_id)
        && data["capturedAt"]
            .as_i64()
            .is_some_and(|time| now - time <= i64::from(config.sampling_ms) * 4 + 1000)
    {
        data.get("render").cloned()
    } else {
        None
    };
    let snapshot = json!({"scene":scene,"game":gaming,"gameInfo":game,"metrics":metrics,"fps":fps,
        "media":media,"downloads":downloads,"render":rendered,"capturedAt":now,
        "missing":data.get("missing"),"error":data.get("error"),"transition":if power_event&&context.power==Some(false){"simple"}else{config.animation.as_str()}});
    *state.snapshot.write().await = snapshot.clone();
    if config.enabled {
        let _ = app.emit_to("hud", "hud-live", &snapshot);
    }
    if preview {
        let _ = app.emit_to("main", "hud-live", &snapshot);
    }
    if config.enabled {
        // 仅比较影响窗口的字段，不每秒序列化整个方案库或凭据。
        let key = serde_json::to_vec(&(
            config.scale,
            config.opacity,
            config.monitor,
            &config.position,
            config.x,
            config.y,
            &config.layer,
            config.font_scale,
            gaming,
        ))
        .map_err(|_| error("HUD 窗口配置无效"))?;
        let missing = app.get_webview_window("hud").is_none();
        if missing {
            context.shown = false;
        }
        let window = if key != context.window_key || missing {
            let window = window::update(app, config, gaming)?;
            context.window_key = key;
            window
        } else {
            app.get_webview_window("hud")
                .ok_or_else(|| error("HUD 窗口丢失"))?
        };
        let visible =
            config.always_show || gaming || peek || Instant::now() < context.visible_until;
        if visible && !context.shown {
            window.show().map_err(|_| error("HUD 显示失败"))?;
            let _ = app.emit_to("hud", "hud-enter", ());
            context.shown = true;
        } else if !visible && context.shown {
            let _ = app.emit_to("hud", "hud-closing", ());
            tokio::time::sleep(Duration::from_millis(220)).await;
            window.hide().map_err(|_| error("HUD 隐藏失败"))?;
            context.shown = false;
        }
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn normal_queue_keeps_upstream_then_only_adds_available_content() {
        let config = Config::default();
        assert_eq!(scene_queue(&config, false, false), vec!["system.memory"]);
        assert_eq!(
            scene_queue(&config, true, true),
            vec!["system.memory", "@media", "@downloads"]
        );
    }
}
