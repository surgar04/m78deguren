//! 桌面歌词只投影主播放器内容；不持有平台凭据、不启动音源，也不开放通用窗口控制。
use super::MusicState;
use crate::services::tools::{Result, error, io_error, save_json};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{Emitter, Manager};
use tokio::sync::Mutex;

const LABEL: &str = "desktop-lyrics";
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Config {
    pub enabled: bool,
    pub locked: bool,
    pub font_size: u32,
    pub opacity: f64,
    pub x: Option<i32>,
    pub y: Option<i32>,
}
impl Default for Config {
    fn default() -> Self {
        Self {
            enabled: false,
            locked: false,
            font_size: 32,
            opacity: 0.95,
            x: None,
            y: None,
        }
    }
}
impl Config {
    fn validate(&self) -> Result<()> {
        if !(20..=56).contains(&self.font_size)
            || !self.opacity.is_finite()
            || !(0.3..=1.0).contains(&self.opacity)
            || self.x.is_some_and(|v| !(-100000..=100000).contains(&v))
            || self.y.is_some_and(|v| !(-100000..=100000).contains(&v))
            || self.x.is_some() != self.y.is_some()
        {
            return Err(error("桌面歌词设置超出范围"));
        }
        Ok(())
    }
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Clock {
    pub position_ms: f64,
    pub paused: bool,
}
impl Default for Clock {
    fn default() -> Self {
        Self {
            position_ms: 0.0,
            paused: true,
        }
    }
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Word {
    text: String,
    start_time: f64,
    end_time: f64,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Line {
    full_text: String,
    start_time: f64,
    end_time: f64,
    words: Vec<Word>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    translation: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    romanization: Option<String>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Lyrics {
    lines: Vec<Line>,
    source: String,
    word_timed: bool,
    is_pure_music: bool,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Content {
    key: String,
    title: String,
    artist: String,
    lyrics: Lyrics,
}
impl Content {
    fn validate(&self) -> Result<()> {
        let time = |v: f64| v.is_finite() && (0.0..=604800000.0).contains(&v);
        if self.key.len() > 200
            || self.title.len() > 16384
            || self.artist.len() > 16384
            || self.lyrics.source.len() > 16384
            || self.lyrics.lines.len() > 5000
            || self.lyrics.lines.iter().any(|line| {
                !time(line.start_time * 1000.0)
                    || !time(line.end_time * 1000.0)
                    || line.end_time < line.start_time
                    || line.full_text.len() > 16384
                    || line.words.len() > 1000
                    || line.translation.as_ref().is_some_and(|v| v.len() > 16384)
                    || line.romanization.as_ref().is_some_and(|v| v.len() > 16384)
                    || line.words.iter().any(|word| {
                        !time(word.start_time * 1000.0)
                            || !time(word.end_time * 1000.0)
                            || word.end_time < word.start_time
                            || word.text.len() > 16384
                    })
            })
            || serde_json::to_vec(self)
                .map_err(|_| error("歌词编码失败"))?
                .len()
                > 4 * 1024 * 1024
        {
            return Err(error("桌面歌词内容无效或超过大小上限"));
        }
        Ok(())
    }
}
#[derive(Serialize)]
pub struct Snapshot {
    config: Config,
    content: Option<Content>,
    clock: Clock,
}
struct Inner {
    config: Config,
    content: Option<Content>,
    clock: Clock,
    immersive: bool,
}
pub struct DesktopLyrics {
    inner: Mutex<Inner>,
    path: PathBuf,
    profile: PathBuf,
}
impl DesktopLyrics {
    pub fn new(root: &Path) -> Result<Self> {
        let path = root.join("desktop-lyrics.json");
        let config = match std::fs::read(&path) {
            Ok(bytes) if bytes.len() <= 65536 => serde_json::from_slice::<Config>(&bytes)
                .ok()
                .filter(|v| v.validate().is_ok())
                .unwrap_or_default(),
            Ok(_) => Config::default(),
            Err(cause) if cause.kind() == std::io::ErrorKind::NotFound => Config::default(),
            Err(cause) => return Err(io_error(cause)),
        };
        let profile = root
            .parent()
            .ok_or_else(|| error("歌词数据目录无效"))?
            .join("webview");
        Ok(Self {
            inner: Mutex::new(Inner {
                config,
                content: None,
                clock: Clock::default(),
                immersive: false,
            }),
            path,
            profile,
        })
    }
    pub async fn read(&self) -> Snapshot {
        let s = self.inner.lock().await;
        Snapshot {
            config: s.config.clone(),
            content: s.content.clone(),
            clock: s.clock.clone(),
        }
    }
    fn remember_position(app: &tauri::AppHandle, config: &mut Config) {
        if let Some(window) = app.get_webview_window(LABEL)
            && let Ok(position) = window.outer_position()
        {
            config.x = Some(position.x);
            config.y = Some(position.y);
        }
    }
    /// 创建透明辅助窗口时复用显式配置的用户资料目录，避免落入系统盘默认 WebView 缓存。
    fn sync(&self, app: &tauri::AppHandle, s: &Inner) -> Result<()> {
        if !s.config.enabled {
            if let Some(window) = app.get_webview_window(LABEL) {
                window.destroy().map_err(|_| error("桌面歌词无法关闭"))?;
            }
            return Ok(());
        }
        // 未播放或正处于沉浸模式时不提前创建隐藏 WebView；已有窗口则保留位置并停止显示。
        if s.content.is_none() || s.immersive {
            if let Some(window) = app.get_webview_window(LABEL) {
                window.hide().map_err(|_| error("无法隐藏桌面歌词"))?;
            }
            return Ok(());
        }
        if app.get_webview_window(LABEL).is_none() {
            let width = app
                .primary_monitor()
                .ok()
                .flatten()
                .map(|monitor| {
                    let available = monitor
                        .work_area()
                        .size
                        .to_logical::<f64>(monitor.scale_factor());
                    820.0_f64.min((available.width - 32.0).max(360.0))
                })
                .unwrap_or(820.0);
            let mut builder = tauri::WebviewWindowBuilder::new(
                app,
                LABEL,
                tauri::WebviewUrl::App("index.html#/desktop-lyrics".into()),
            )
            .title("臻境 · 桌面歌词")
            .data_directory(self.profile.clone())
            .inner_size(width, 180.0)
            .min_inner_size(360.0, 120.0)
            .max_inner_size(1600.0, 400.0)
            .decorations(false)
            .transparent(true)
            .always_on_top(true)
            .skip_taskbar(true)
            .shadow(false)
            .focused(false)
            .visible(false);
            // 共用 UserDataFolder 时浏览器参数也必须一致，否则 WebView2 会拒绝第二个环境。
            // 同时保证开发验收参数不会意外启动第二套浏览器/GPU 进程。
            if let Some(args) = app
                .config()
                .app
                .windows
                .first()
                .and_then(|window| window.additional_browser_args.as_ref())
            {
                builder = builder.additional_browser_args(args);
            }
            let window = builder.build().map_err(|cause| {
                log::warn!("桌面歌词窗口创建失败: {cause}");
                error("无法创建桌面歌词窗口")
            })?;
            self.position(app, &window, s.config.x.zip(s.config.y))?;
            let owner = app.clone();
            let movement = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0));
            window.on_window_event(move |event| {
                if matches!(event, tauri::WindowEvent::Moved(_)) {
                    let epoch = movement.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
                    let movement = movement.clone();
                    let owner = owner.clone();
                    tauri::async_runtime::spawn(async move {
                        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                        if movement.load(std::sync::atomic::Ordering::Relaxed) == epoch {
                            let service = &owner.state::<MusicState>().desktop;
                            let mut state = service.inner.lock().await;
                            Self::remember_position(&owner, &mut state.config);
                            if let Err(cause) = save_json(&service.path, &state.config).await {
                                log::warn!("歌词位置保存失败: {cause}");
                            }
                        }
                    });
                }
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let owner = owner.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Err(cause) = owner
                            .state::<MusicState>()
                            .desktop
                            .control(&owner, "close")
                            .await
                        {
                            log::warn!("桌面歌词关闭失败: {cause}");
                        }
                    });
                }
            });
        }
        if let Some(window) = app.get_webview_window(LABEL) {
            window
                .set_ignore_cursor_events(s.config.locked)
                .map_err(|_| error("无法切换歌词鼠标穿透"))?;
            if s.immersive || s.content.is_none() {
                window.hide().map_err(|_| error("无法隐藏桌面歌词"))?;
            } else {
                window.show().map_err(|_| error("无法显示桌面歌词"))?;
            }
        }
        Ok(())
    }
    fn position(
        &self,
        app: &tauri::AppHandle,
        window: &tauri::WebviewWindow,
        position: Option<(i32, i32)>,
    ) -> Result<()> {
        let monitors = app
            .available_monitors()
            .map_err(|_| error("无法读取显示器工作区"))?;
        let size = window
            .outer_size()
            .map_err(|_| error("无法读取歌词窗口大小"))?;
        // 保存的屏幕已拔除时退回可用工作区；至少让完整操作栏可见，不能把解锁入口留在屏幕外。
        let valid = position.filter(|(x, y)| {
            monitors.iter().any(|m| {
                let a = m.work_area();
                *x >= a.position.x
                    && *y >= a.position.y
                    && i64::from(*x) + i64::from(size.width.min(360))
                        <= i64::from(a.position.x) + i64::from(a.size.width)
                    && i64::from(*y) + 80 <= i64::from(a.position.y) + i64::from(a.size.height)
            })
        });
        let point = valid.or_else(|| {
            monitors.first().map(|m| {
                let a = m.work_area();
                (
                    a.position.x + ((a.size.width.saturating_sub(size.width)) / 2) as i32,
                    a.position.y + (a.size.height.saturating_sub(size.height + 60)) as i32,
                )
            })
        });
        if let Some((x, y)) = point {
            window
                .set_position(tauri::PhysicalPosition::new(x, y))
                .map_err(|_| error("无法设置歌词位置"))?;
        }
        Ok(())
    }
    pub async fn configure(&self, app: &tauri::AppHandle, mut config: Config) -> Result<Config> {
        config.validate()?;
        let mut s = self.inner.lock().await;
        Self::remember_position(app, &mut config);
        save_json(&self.path, &config).await?;
        let old = std::mem::replace(&mut s.config, config);
        if let Err(cause) = self.sync(app, &s) {
            s.config = old;
            save_json(&self.path, &s.config).await?;
            if let Err(rollback) = self.sync(app, &s) {
                log::warn!("桌面歌词窗口恢复失败: {rollback}");
            }
            return Err(cause);
        }
        app.emit_to(LABEL, "music:lyrics-config", &s.config)
            .map_err(|_| error("歌词设置同步失败"))?;
        app.emit_to("main", "music:lyrics-config", &s.config)
            .map_err(|_| error("歌词设置同步失败"))?;
        Ok(s.config.clone())
    }
    pub async fn content(&self, app: &tauri::AppHandle, content: Option<Content>) -> Result<()> {
        if let Some(value) = &content {
            value.validate()?;
        }
        let mut s = self.inner.lock().await;
        s.content = content;
        self.sync(app, &s)?;
        app.emit_to(LABEL, "music:lyrics-content", &s.content)
            .map_err(|_| error("歌词内容同步失败"))?;
        Ok(())
    }
    pub async fn clock(&self, app: &tauri::AppHandle, clock: Clock) -> Result<()> {
        if !clock.position_ms.is_finite() || !(0.0..=604800000.0).contains(&clock.position_ms) {
            return Err(error("歌词时钟无效"));
        }
        let mut s = self.inner.lock().await;
        s.clock = clock;
        if s.config.enabled && !s.immersive {
            app.emit_to(LABEL, "music:lyrics-clock", &s.clock)
                .map_err(|_| error("歌词时钟同步失败"))?;
        }
        Ok(())
    }
    pub async fn immersive(&self, app: &tauri::AppHandle, enabled: bool) -> Result<()> {
        let mut s = self.inner.lock().await;
        s.immersive = enabled;
        // Windows 隐藏窗口不一定立即触发 document.visibilitychange；显式暂停歌词，
        // 不能依赖系统节流来停止动画。保留原始播放时钟，退出时再恢复真实暂停状态。
        let projected = Clock {
            position_ms: s.clock.position_ms,
            paused: enabled || s.clock.paused,
        };
        app.emit_to(LABEL, "music:lyrics-clock", &projected)
            .map_err(|_| error("歌词可见状态同步失败"))?;
        self.sync(app, &s)
    }
    pub async fn control(&self, app: &tauri::AppHandle, action: &str) -> Result<Config> {
        if matches!(action, "drag" | "reset-position") {
            let mut s = self.inner.lock().await;
            if let Some(window) = app.get_webview_window(LABEL) {
                if action == "drag" {
                    if !s.config.locked {
                        window
                            .start_dragging()
                            .map_err(|_| error("无法拖动桌面歌词"))?;
                    }
                } else {
                    self.position(app, &window, None)?;
                    Self::remember_position(app, &mut s.config);
                    save_json(&self.path, &s.config).await?;
                }
            }
            return Ok(s.config.clone());
        }
        let mut config = self.read().await.config;
        match action {
            "close" => config.enabled = false,
            "lock" => config.locked = true,
            "unlock" => config.locked = false,
            _ => return Err(error("未开放的歌词窗口操作")),
        }
        self.configure(app, config).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn config_and_content_are_bounded() {
        let mut c = Config::default();
        assert!(c.validate().is_ok());
        c.opacity = f64::NAN;
        assert!(c.validate().is_err());
        c = Config::default();
        c.x = Some(1);
        assert!(c.validate().is_err());
        let content = Content {
            key: "test".into(),
            title: "测试".into(),
            artist: String::new(),
            lyrics: Lyrics {
                lines: vec![Line {
                    full_text: "a".into(),
                    start_time: 2.0,
                    end_time: 1.0,
                    words: vec![],
                    translation: None,
                    romanization: None,
                }],
                source: String::new(),
                word_timed: false,
                is_pure_music: false,
            },
        };
        assert!(content.validate().is_err());
    }
}
