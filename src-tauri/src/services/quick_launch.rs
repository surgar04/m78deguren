//! 八向轮盘使用封闭目标白名单。持久化只保存目标 ID，从不接受命令行、脚本或 URL。
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
    "music",
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
    #[serde(default = "default_trigger_key")]
    pub trigger_key: String,
    pub hold_ms: u32,
    pub size: u32,
    pub opacity: f64,
    pub desktop_only: bool,
    pub position: String,
    pub slots: [Option<Target>; 8],
}
fn default_trigger_key() -> String {
    "G".into()
}
impl Default for Wheel {
    fn default() -> Self {
        Self {
            enabled: false,
            trigger_key: default_trigger_key(),
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
    pub wheel: Wheel,
}
impl Config {
    fn initial() -> Self {
        Self {
            wheel: Wheel::default(),
        }
    }
    pub fn validate(&self) -> Result<()> {
        if self.wheel.slots.len() != 8
            || !(200..=1500).contains(&self.wheel.hold_ms)
            || self.wheel.trigger_key.len() != 1
            || !self
                .wheel
                .trigger_key
                .bytes()
                .all(|key| key.is_ascii_uppercase())
            || !(300..=640).contains(&self.wheel.size)
            || !self.wheel.opacity.is_finite()
            || !(0.35..=1.0).contains(&self.wheel.opacity)
            || !matches!(self.wheel.position.as_str(), "cursor" | "center")
        {
            return Err(error("导航与轮盘配置范围无效"));
        }
        for target in self.wheel.slots.iter().flatten() {
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
/// 兼容磁盘中已退役的六/八项导航；IPC 仍拒绝 navigation，避免保留隐藏执行入口。
/// 迁移前验证全部旧目标并备份，轮盘目标与首页快捷记录均不受影响。
fn decode_saved_config(text: &str) -> Result<(Config, bool)> {
    let mut value: serde_json::Value =
        serde_json::from_str(text).map_err(|_| error("快捷启动配置损坏，原件已保留"))?;
    let object = value
        .as_object_mut()
        .ok_or_else(|| error("快捷配置不是对象"))?;
    let legacy = object.remove("navigation");
    if let Some(legacy) = &legacy {
        let slots = legacy.as_array().ok_or_else(|| error("旧导航格式无效"))?;
        if !matches!(slots.len(), 6 | 8) {
            return Err(error("旧导航数量无效"));
        }
        for value in slots {
            let target: Option<Target> =
                serde_json::from_value(value.clone()).map_err(|_| error("旧导航包含无效目标"))?;
            if let Some(target) = target {
                target.validate()?;
            }
        }
    }
    let config: Config =
        serde_json::from_value(value).map_err(|_| error("快捷启动配置格式无效，原件已保留"))?;
    config.validate()?;
    Ok((config, legacy.is_some()))
}

/// 内容寻址备份只写本应用目录，保留退役导航和完整轮盘配置，备份失败不覆盖原件。
/// 重启反复读取旧配置不会重复生成备份；备份失败时不覆盖原配置。
fn archive_navigation(root: &Path, text: &str) -> Result<()> {
    use sha2::{Digest, Sha256};
    use std::io::Write;
    let backup = root.join(format!(
        "navigation-retired-{:x}.json",
        Sha256::digest(text.as_bytes())
    ));
    ensure_local_path(&backup)?;
    match std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&backup)
    {
        Ok(mut file) => {
            let result = file
                .write_all(text.as_bytes())
                .and_then(|()| file.sync_all());
            if let Err(cause) = result {
                drop(file);
                let _ = std::fs::remove_file(&backup);
                return Err(io_error(cause));
            }
        }
        Err(cause) if cause.kind() == std::io::ErrorKind::AlreadyExists => {
            if super::other_games::scan::read_small(&backup, 131072).as_deref() != Some(text) {
                return Err(error("旧导航备份校验失败，原配置未覆盖"));
            }
        }
        Err(cause) => return Err(io_error(cause)),
    }
    Ok(())
}
impl QuickLaunchState {
    pub fn new(root: &Path) -> Result<Self> {
        let root = root.join("home/quick-launch");
        ensure_local_path(&root)?;
        std::fs::create_dir_all(&root).map_err(io_error)?;
        let loaded = (|| -> Result<(Config, Option<String>)> {
            Ok(
                if let Some(text) =
                    super::other_games::scan::read_small(&root.join("config.json"), 131072)
                {
                    let (config, migrated) = decode_saved_config(&text)?;
                    (config, migrated.then_some(text))
                } else {
                    (Config::initial(), None)
                },
            )
        })();
        let mut warning = String::new();
        let config = match loaded {
            Ok((value, legacy)) => {
                if let Some(text) = legacy {
                    archive_navigation(&root, &text)?;
                    // 原子替换已验证的新格式；异常或断电不会留下半份配置。
                    use std::io::Write;
                    let mut staged = tempfile::NamedTempFile::new_in(&root).map_err(io_error)?;
                    staged
                        .write_all(
                            &serde_json::to_vec_pretty(&value)
                                .map_err(|_| error("轮盘配置编码失败"))?,
                        )
                        .map_err(io_error)?;
                    staged.as_file().sync_all().map_err(io_error)?;
                    staged
                        .persist(root.join("config.json"))
                        .map_err(|cause| io_error(cause.error))?;
                    warning = "自定义导航已移除，旧配置已备份；首页快捷启动和八向轮盘保留。".into();
                }
                value
            }
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
            ("music", "音乐"),
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
        for target in next.wheel.slots.iter().flatten() {
            if !options.iter().any(|item| &item.target == target)
                && !old.wheel.slots.iter().flatten().any(|item| item == target)
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
        serde_json::json!({"enabled":config.wheel.enabled&&allowed,"triggerKey":config.wheel.trigger_key,"holdMs":config.wheel.hold_ms,"size":config.wheel.size,"opacity":config.wheel.opacity,"desktopOnly":config.wheel.desktop_only,"position":config.wheel.position,"slots":slots})
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
    fn six_slot_file_migrates_once_and_keeps_wheel() -> Result<()> {
        let root = crate::services::tools::test_root("retired-navigation-restart")?;
        let directory = root.join("home/quick-launch");
        std::fs::create_dir_all(&directory).map_err(io_error)?;
        let mut old = serde_json::to_value(Config::initial()).map_err(|_| error("测试配置失败"))?;
        old["navigation"] = serde_json::json!([null, null, null, null, null, null]);
        old["wheel"]["slots"][3] = serde_json::json!({"kind":"page","id":"hardware"});
        std::fs::write(directory.join("config.json"), old.to_string()).map_err(io_error)?;
        let _first = QuickLaunchState::new(&root)?;
        let text = std::fs::read_to_string(directory.join("config.json")).map_err(io_error)?;
        let (value, migrated) = decode_saved_config(&text)?;
        assert!(!migrated);
        assert!(!text.contains("navigation"));
        assert_eq!(
            value.wheel.slots[3],
            Some(Target::Page {
                id: "hardware".into()
            })
        );
        let _second = QuickLaunchState::new(&root)?;
        let backups = std::fs::read_dir(&directory)
            .map_err(io_error)?
            .filter_map(|entry| entry.ok())
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("navigation-retired-")
            })
            .count();
        assert_eq!(backups, 1);
        Ok(())
    }
    #[test]
    fn retired_navigation_is_archived_without_changing_wheel() -> Result<()> {
        let mut old = serde_json::to_value(Config::initial()).map_err(|_| error("测试编码失败"))?;
        old["navigation"] = serde_json::json!([
            {"kind":"page","id":"home"},null,null,null,null,
            {"kind":"page","id":"hardware"},
            {"kind":"page","id":"tools"},
            {"kind":"page","id":"settings"}
        ]);
        old["wheel"]["enabled"] = true.into();
        old["wheel"]["slots"][7] = serde_json::json!({"kind":"page","id":"other-games"});
        let text = serde_json::to_string_pretty(&old).map_err(|_| error("测试编码失败"))?;
        let (migrated, changed) = decode_saved_config(&text)?;
        assert!(changed);
        assert!(migrated.wheel.enabled);
        assert_eq!(
            migrated.wheel.slots[7],
            Some(Target::Page {
                id: "other-games".into()
            })
        );
        // 迁移只存在于磁盘读取路径；直接 IPC 反序列化旧导航必须失败。
        assert!(serde_json::from_str::<Config>(&text).is_err());
        let root = crate::services::tools::test_root("navigation-retired")?;
        archive_navigation(&root, &text)?;
        archive_navigation(&root, &text)?;
        let files: Vec<_> = std::fs::read_dir(&root).map_err(io_error)?.collect();
        assert_eq!(files.len(), 1);
        let entry = files
            .into_iter()
            .next()
            .ok_or_else(|| error("缺少备份"))?
            .map_err(io_error)?;
        assert_eq!(
            std::fs::read_to_string(entry.path()).map_err(io_error)?,
            text
        );
        Ok(())
    }
    #[test]
    fn migration_rejects_invalid_retired_slots_and_wrong_lengths() -> Result<()> {
        let mut old = serde_json::to_value(Config::initial()).map_err(|_| error("测试编码失败"))?;
        for count in [0, 5, 7, 9] {
            old["navigation"] = serde_json::Value::Array(vec![serde_json::Value::Null; count]);
            assert!(decode_saved_config(&old.to_string()).is_err());
        }
        old["navigation"] = serde_json::Value::Array(vec![serde_json::Value::Null; 8]);
        old["navigation"][7] = serde_json::json!({"kind":"tool","id":"powershell"});
        assert!(decode_saved_config(&old.to_string()).is_err());
        Ok(())
    }
    #[test]
    fn legacy_wheel_uses_letter_and_rejects_tab() -> Result<()> {
        let mut value =
            serde_json::to_value(Config::initial()).map_err(|_| error("测试配置失败"))?;
        value["wheel"]
            .as_object_mut()
            .ok_or_else(|| error("缺少轮盘配置"))?
            .remove("triggerKey");
        let mut config: Config =
            serde_json::from_value(value).map_err(|_| error("旧配置迁移失败"))?;
        assert_eq!(config.wheel.trigger_key, "G");
        assert!(config.validate().is_ok());
        for key in ["Tab", "g", "Ctrl+G", "", "1", "中"] {
            config.wheel.trigger_key = key.into();
            assert!(config.validate().is_err());
        }
        Ok(())
    }
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
