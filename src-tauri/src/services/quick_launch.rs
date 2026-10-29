//! 自定义导航与八向轮盘共用目标白名单。持久化只保存目标 ID，从不接受命令行、脚本或 URL。
use crate::services::{
    home::HomeState,
    tools::{Result, ensure_local_path, error, io_error, save_json},
};
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager};
use tokio::sync::{Mutex, RwLock};
pub const TOOL_IDS: &[&str] = &[
    "crosshair",
    "overlay",
    "filter",
    "clicker",
    "media-previous",
    "media-next",
    "media-play-pause",
];
pub const PAGE_IDS: &[&str] = &[
    "home",
    "library",
    "other-games",
    "hardware",
    "tools",
    "optimization",
    "settings",
];
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum Target {
    Shortcut {
        id: String,
    },
    Steam {
        #[serde(rename = "appId")]
        app_id: u32,
    },
    Tool {
        id: String,
    },
    Page {
        id: String,
    },
    ToolPage {
        id: String,
    },
}
impl Target {
    fn validate(&self) -> Result<()> {
        let valid = match self {
            Self::Shortcut { id } => uuid::Uuid::parse_str(id).is_ok(),
            Self::Steam { app_id } => *app_id > 0,
            Self::Tool { id } => TOOL_IDS.contains(&id.as_str()),
            Self::Page { id } => PAGE_IDS.contains(&id.as_str()),
            Self::ToolPage { id } => crate::services::tools::catalog::catalog()
                .tools
                .iter()
                .any(|tool| tool.id == id),
        };
        if valid {
            Ok(())
        } else {
            Err(error("快捷启动目标不在白名单中"))
        }
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Wheel {
    pub enabled: bool,
    pub hold_ms: u32,
    pub size: u32,
    pub opacity: f64,
    pub desktop_only: bool,
    pub position: String,
    pub slots: [Option<Target>; 8],
}
impl Default for Wheel {
    fn default() -> Self {
        Self {
            enabled: false,
            hold_ms: 350,
            size: 420,
            opacity: 0.94,
            desktop_only: true,
            position: "cursor".into(),
            slots: std::array::from_fn(|_| None),
        }
    }
}
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Config {
    pub navigation: [Option<Target>; 8],
    pub wheel: Wheel,
}
impl Config {
    fn initial() -> Self {
        Self {
            navigation: std::array::from_fn(|_| None),
            wheel: Wheel::default(),
        }
    }
    pub fn validate(&self) -> Result<()> {
        if self.navigation.len() != 8
            || self.wheel.slots.len() != 8
            || !(200..=1500).contains(&self.wheel.hold_ms)
            || !(300..=640).contains(&self.wheel.size)
            || !self.wheel.opacity.is_finite()
            || !(0.35..=1.0).contains(&self.wheel.opacity)
            || !matches!(self.wheel.position.as_str(), "cursor" | "center")
        {
            return Err(error("导航与轮盘配置范围无效"));
        }
        for target in self.navigation.iter().chain(&self.wheel.slots).flatten() {
            target.validate()?
        }
        Ok(())
    }
}
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Runtime {
    pub ready: bool,
    pub visible: bool,
    pub message: String,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OptionItem {
    pub target: Target,
    pub label: String,
    pub group: String,
    pub available: bool,
    pub icon_id: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub config: Config,
    pub revision: String,
    pub options: Vec<OptionItem>,
    pub runtime: Runtime,
}
pub struct QuickLaunchState {
    pub root: PathBuf,
    pub config: Mutex<Config>,
    serial: Mutex<()>,
    pub runtime: RwLock<Runtime>,
    pub enabled: AtomicBool,
    gesture: Mutex<Option<Instant>>,
}
fn revision(config: &Config) -> Result<String> {
    use sha2::{Digest, Sha256};
    Ok(format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(config).map_err(|_| error("快捷配置编码失败"))?)
    ))
}
impl QuickLaunchState {
    pub fn new(root: &Path) -> Result<Self> {
        let root = root.join("home/quick-launch");
        ensure_local_path(&root)?;
        std::fs::create_dir_all(&root).map_err(io_error)?;
        let loaded = (|| -> Result<Config> {
            Ok(
                if let Some(text) =
                    super::other_games::scan::read_small(&root.join("config.json"), 131072)
                {
                    let config: Config = serde_json::from_str(&text)
                        .map_err(|_| error("快捷启动配置损坏，原件已保留"))?;
                    config.validate()?;
                    config
                } else {
                    Config::initial()
                },
            )
        })();
        let mut warning = String::new();
        let config = match loaded {
            Ok(value) => value,
            Err(cause) => {
                let file = root.join("config.json");
                if file.is_file() {
                    std::fs::rename(
                        &file,
                        root.join(format!(
                            "config-invalid-{}.json",
                            chrono::Utc::now().timestamp_millis()
                        )),
                    )
                    .map_err(io_error)?;
                }
                warning = format!("快捷配置无法读取，已保留原件并关闭轮盘：{cause}");
                Config::initial()
            }
        };
        Ok(Self {
            root,
            enabled: AtomicBool::new(config.wheel.enabled),
            config: Mutex::new(config),
            serial: Mutex::new(()),
            runtime: RwLock::new(Runtime {
                message: warning,
                ..Runtime::default()
            }),
            gesture: Mutex::new(None),
        })
    }
    pub async fn options(&self, app: &tauri::AppHandle) -> Vec<OptionItem> {
        let home = app.state::<HomeState>().store.lock().await.clone();
        let mut result = Vec::new();
        for row in &home.shortcuts {
            let available = tokio::fs::metadata(&row.path)
                .await
                .is_ok_and(|meta| meta.is_file());
            result.push(OptionItem {
                target: Target::Shortcut { id: row.id.clone() },
                label: row.name.clone(),
                group: if row.is_game { "游戏" } else { "程序" }.into(),
                available,
                icon_id: Some(row.id.clone()),
            });
        }
        if let Ok(steam) = app.state::<super::steam::SteamState>().current().await {
            for game in steam.games.iter().filter(|g| g.installed) {
                result.push(OptionItem {
                    target: Target::Steam {
                        app_id: game.app_id,
                    },
                    label: game.name.clone(),
                    group: "Steam".into(),
                    available: true,
                    icon_id: None,
                });
            }
        }
        for (id, label) in [
            ("crosshair", "准心开关"),
            ("overlay", "HUD 开关"),
            ("filter", "屏幕滤镜开关"),
            ("clicker", "已授权连点器开关"),
            ("media-previous", "媒体上一曲"),
            ("media-next", "媒体下一曲"),
            ("media-play-pause", "媒体播放 / 暂停"),
        ] {
            result.push(OptionItem {
                target: Target::Tool { id: id.into() },
                label: label.into(),
                group: "快捷功能".into(),
                available: true,
                icon_id: None,
            });
        }
        for (id, label) in [
            ("home", "首页"),
            ("library", "Steam 游戏库"),
            ("other-games", "其他游戏"),
            ("hardware", "系统与硬件"),
            ("tools", "工具箱"),
            ("optimization", "系统优化"),
            ("settings", "设置"),
        ] {
            result.push(OptionItem {
                target: Target::Page { id: id.into() },
                label: label.into(),
                group: "应用页面".into(),
                available: true,
                icon_id: None,
            });
        }
        for tool in crate::services::tools::catalog::catalog().tools {
            result.push(OptionItem {
                target: Target::ToolPage { id: tool.id.into() },
                label: tool.name.into(),
                group: "工具页面".into(),
                available: true,
                icon_id: None,
            });
        }
        result
    }
    pub async fn snapshot(&self, app: &tauri::AppHandle) -> Result<Snapshot> {
        let config = self.config.lock().await.clone();
        Ok(Snapshot {
            revision: revision(&config)?,
            config,
            options: self.options(app).await,
            runtime: self.runtime.read().await.clone(),
        })
    }
    pub async fn save(
        &self,
        app: &tauri::AppHandle,
        next: Config,
        expected: &str,
    ) -> Result<Snapshot> {
        next.validate()?;
        let _guard = self.serial.lock().await;
        let old = self.config.lock().await.clone();
        if revision(&old)? != expected {
            return Err(error("快捷配置已变化，请刷新后重新保存"));
        }
        let options = self.options(app).await;
        for target in next.navigation.iter().chain(&next.wheel.slots).flatten() {
            if !options.iter().any(|item| &item.target == target)
                && !old
                    .navigation
                    .iter()
                    .chain(&old.wheel.slots)
                    .flatten()
                    .any(|item| item == target)
            {
                return Err(error("目标已移除或尚未检测，请重新选择"));
            }
        }
        *self.config.lock().await = next.clone();
        let result = async {
            app.state::<HomeState>().configure_quick_launch(app).await?;
            save_json(&self.root.join("config.json"), &next).await
        }
        .await;
        if let Err(cause) = result {
            *self.config.lock().await = old;
            let _ = app.state::<HomeState>().configure_quick_launch(app).await;
            return Err(cause);
        }
        self.enabled.store(next.wheel.enabled, Ordering::SeqCst);
        self.snapshot(app).await
    }
    /// 由原生实体按键手势调用，槽位与目标都在 Rust 中重新解析。
    pub async fn wheel_dispatch(&self, app: &tauri::AppHandle, index: usize) -> Result<()> {
        // 助手回报与设置变更可能交错，Rust 执行前再次检查总开关及录制租约。
        let settings = app.state::<super::settings::SettingsState>();
        if !settings.config.lock().await.hotkeys_enabled || settings.capture.lock().await.is_some()
        {
            return Err(error("总热键已关闭或正在录制快捷键"));
        }
        let mut last = self.gesture.lock().await;
        if last.is_some_and(|at| at.elapsed() < Duration::from_millis(300)) {
            return Err(error("操作过快"));
        }
        *last = Some(Instant::now());
        drop(last);
        let config = self.config.lock().await.clone();
        if !config.wheel.enabled {
            return Err(error("轮盘已关闭"));
        }
        let target = config
            .wheel
            .slots
            .get(index)
            .and_then(Clone::clone)
            .ok_or_else(|| error("该方向未配置"))?;
        self.dispatch(app, &target).await
    }
    pub async fn navigation_dispatch(&self, app: &tauri::AppHandle, index: usize) -> Result<()> {
        let target = self
            .config
            .lock()
            .await
            .navigation
            .get(index)
            .and_then(Clone::clone)
            .ok_or_else(|| error("导航槽位未配置"))?;
        self.dispatch(app, &target).await
    }
    pub async fn dispatch(&self, app: &tauri::AppHandle, target: &Target) -> Result<()> {
        target.validate()?;
        let settings = app.state::<super::settings::SettingsState>();
        if settings.critical.load(Ordering::SeqCst)
            || !app
                .state::<super::onboarding::OnboardingState>()
                .progress
                .lock()
                .await
                .complete
        {
            return Err(error("准备或关键系统操作期间暂不执行快捷启动"));
        }
        match target {
            Target::Shortcut { id } => {
                app.state::<HomeState>().launch(id, true, app).await?;
            }
            Target::Steam { app_id } => {
                app.state::<super::steam::SteamState>()
                    .launch("run", Some(*app_id))
                    .await?;
            }
            Target::Tool { id } => {
                super::settings::hotkeys::execute_quick(app, id).await?;
            }
            Target::Page { id } => {
                let path = match id.as_str() {
                    "home" => "/".into(),
                    "other-games" => "/library/other".into(),
                    _ => format!("/{id}"),
                };
                open_page(app, &path)?;
            }
            Target::ToolPage { id } => open_page(app, &format!("/tools/{id}"))?,
        }
        Ok(())
    }
    /// 原生轮盘只接收展示数据和固定缓存图标，不接收可执行路径。
    pub async fn native_config(&self, app: &tauri::AppHandle) -> serde_json::Value {
        let config = self.config.lock().await.clone();
        let settings = app.state::<super::settings::SettingsState>();
        let allowed = settings.config.lock().await.hotkeys_enabled
            && settings.capture.lock().await.is_none()
            && !settings.critical.load(Ordering::SeqCst)
            && app
                .state::<super::onboarding::OnboardingState>()
                .progress
                .lock()
                .await
                .complete;
        let options = self.options(app).await;
        let home = app.state::<HomeState>();
        let slots: Vec<_> = config.wheel.slots.iter().map(|target| {
            let option = target.as_ref().and_then(|target| options.iter().find(|item| &item.target == target));
            serde_json::json!({
                "label": option.map(|item| item.label.as_str()).unwrap_or("未配置"),
                "icon": option.and_then(|item| item.icon_id.as_ref()).map(|id| home.root.join(format!("icons/{id}.png")).to_string_lossy().into_owned()),
                "available": option.is_some_and(|item| item.available),
                "game": option.is_some_and(|item| matches!(item.target, Target::Shortcut{..} | Target::Steam{..}))
            })
        }).collect();
        serde_json::json!({"enabled":config.wheel.enabled&&allowed,"holdMs":config.wheel.hold_ms,"size":config.wheel.size,"opacity":config.wheel.opacity,"desktopOnly":config.wheel.desktop_only,"position":config.wheel.position,"slots":slots})
    }
}
fn open_page(app: &tauri::AppHandle, path: &str) -> Result<()> {
    super::settings::runtime::show_main(app)?;
    app.emit_to("main", "quick-launch-page", path)
        .map_err(|_| error("页面跳转未成功"))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fixed_slots_and_closed_targets() {
        let mut config = Config::initial();
        assert!(config.validate().is_ok());
        config.wheel.hold_ms = 0;
        assert!(config.validate().is_err());
        assert!(
            Target::Tool {
                id: "powershell".into()
            }
            .validate()
            .is_err()
        );
        assert!(
            serde_json::from_str::<Target>(r#"{"kind":"shortcut","id":"x","command":"cmd"}"#)
                .is_err()
        );
        let value = serde_json::to_value(Config::initial()).map_err(|_| ()).ok();
        assert!(value.is_some_and(|mut value| {
            value["navigation"] = serde_json::json!([null]);
            serde_json::from_value::<Config>(value).is_err()
        }));
    }
}
