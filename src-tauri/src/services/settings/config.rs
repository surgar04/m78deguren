//! 原生偏好使用受限枚举和固定结构，不从本地 JSON 恢复任何动作、脚本或路径。
use crate::services::tools::{Result, error, io_error};
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, path::Path};
use tauri_plugin_global_shortcut::Shortcut;

pub const ACTIONS: [&str; 7] = [
    "overlay",
    "crosshair",
    "filter",
    "clicker",
    "previous",
    "next",
    "play-pause",
];

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Binding {
    pub action: String,
    pub enabled: bool,
    pub shortcut: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Server {
    pub id: String,
    pub name: String,
    pub url: String,
    pub custom: bool,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeConfig {
    pub version: u8,
    pub minimized_start: bool,
    pub auto_update: bool,
    #[serde(default = "enabled")]
    pub confirm_actions: bool,
    #[serde(default = "enabled")]
    pub check_updates: bool,
    #[serde(default = "enabled")]
    pub update_reminders: bool,
    pub close_behavior: String,
    pub hotkeys_enabled: bool,
    pub media_keys: bool,
    #[serde(default, skip_serializing, rename = "desktopIsland")]
    pub _legacy_desktop_island: bool,
    pub bindings: Vec<Binding>,
    pub servers: Vec<Server>,
}
fn enabled() -> bool {
    true
}
impl Default for NativeConfig {
    fn default() -> Self {
        let shortcuts = [
            "Ctrl+Shift+O",
            "Ctrl+Alt+C",
            "Ctrl+Alt+F",
            "F8",
            "Ctrl+Alt+Left",
            "Ctrl+Alt+Right",
            "Ctrl+Alt+Space",
        ];
        Self {
            version: 1,
            minimized_start: false,
            auto_update: false,
            confirm_actions: true,
            check_updates: true,
            update_reminders: true,
            close_behavior: "exit".into(),
            hotkeys_enabled: true,
            // 本项目没有内置音乐播放器，默认把物理媒体键交还给 Windows。
            media_keys: false,
            _legacy_desktop_island: false,
            bindings: ACTIONS
                .iter()
                .zip(shortcuts)
                .map(|(action, shortcut)| Binding {
                    action: (*action).into(),
                    enabled: true,
                    shortcut: shortcut.into(),
                })
                .collect(),
            servers: Vec::new(),
        }
    }
}
impl NativeConfig {
    pub fn validate(&self) -> Result<()> {
        if self.version != 1
            || !matches!(self.close_behavior.as_str(), "exit" | "tray")
            || self.bindings.len() != ACTIONS.len()
            || self.servers.len() > 30
        {
            return Err(error("原生设置结构或数量无效"));
        }
        let mut actions = HashSet::new();
        let mut shortcuts = HashSet::new();
        for binding in &self.bindings {
            if !ACTIONS.contains(&binding.action.as_str())
                || !actions.insert(&binding.action)
                || binding.shortcut.len() > 64
            {
                return Err(error("热键动作未知、重复或过长"));
            }
            let shortcut = binding
                .shortcut
                .parse::<Shortcut>()
                .map_err(|_| error("快捷键格式不受支持"))?;
            if binding.enabled && !shortcuts.insert(shortcut.id()) {
                return Err(error("启用的快捷键不能互相重复"));
            }
        }
        let mut ids = HashSet::new();
        let mut urls = HashSet::new();
        for server in &self.servers {
            uuid::Uuid::parse_str(&server.id).map_err(|_| error("自定义站点标识无效"))?;
            if !server.custom
                || !ids.insert(&server.id)
                || server.name.trim().is_empty()
                || server.name.chars().count() > 60
                || server.name.chars().any(char::is_control)
            {
                return Err(error("自定义站点名称或标识无效"));
            }
            let url = super::network::validated_url(&server.url)?;
            if !urls.insert(url.as_str().to_owned()) {
                return Err(error("自定义站点不能重复"));
            }
        }
        Ok(())
    }
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum Patch {
    CloseBehavior { value: String },
    MinimizedStart { value: bool },
    AutoUpdate { value: bool },
    ConfirmActions { value: bool },
    CheckUpdates { value: bool },
    UpdateReminders { value: bool },
    HotkeysEnabled { value: bool },
    MediaKeys { value: bool },
    Binding { binding: Binding },
    ServerAdd { name: String, url: String },
    ServerRemove { id: String },
}
impl Patch {
    pub fn candidate(self, current: &NativeConfig) -> Result<NativeConfig> {
        let mut next = current.clone();
        match self {
            Self::CloseBehavior { value } => next.close_behavior = value,
            Self::MinimizedStart { value } => next.minimized_start = value,
            Self::AutoUpdate { value } => next.auto_update = value,
            Self::ConfirmActions { value } => next.confirm_actions = value,
            Self::CheckUpdates { value } => next.check_updates = value,
            Self::UpdateReminders { value } => next.update_reminders = value,
            Self::HotkeysEnabled { value } => next.hotkeys_enabled = value,
            Self::MediaKeys { value } => next.media_keys = value,
            Self::Binding { binding } => {
                let target = next
                    .bindings
                    .iter_mut()
                    .find(|row| row.action == binding.action)
                    .ok_or_else(|| error("热键动作不存在"))?;
                *target = binding;
            }
            Self::ServerAdd { name, url } => {
                let url = super::network::validated_url(&url)?;
                let name = if name.trim().is_empty() {
                    url.host_str().unwrap_or_default().to_owned()
                } else {
                    name.trim().to_owned()
                };
                next.servers.push(Server {
                    id: uuid::Uuid::new_v4().to_string(),
                    name,
                    url: url.to_string(),
                    custom: true,
                });
            }
            Self::ServerRemove { id } => {
                uuid::Uuid::parse_str(&id).map_err(|_| error("只能移除自定义站点"))?;
                if !next.servers.iter().any(|server| server.id == id) {
                    return Err(error("自定义站点不存在"));
                }
                next.servers.retain(|server| server.id != id);
            }
        }
        next.validate()?;
        Ok(next)
    }
}

pub fn load(directory: &Path) -> Result<NativeConfig> {
    let path = directory.join("config.json");
    match std::fs::read(&path) {
        Ok(bytes) => {
            let config: NativeConfig = serde_json::from_slice(&bytes)
                .map_err(|_| error("原生设置文件损坏，请使用数据恢复入口"))?;
            config.validate()?;
            Ok(config)
        }
        Err(cause) if cause.kind() == std::io::ErrorKind::NotFound => Ok(NativeConfig::default()),
        Err(cause) => Err(io_error(cause)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn old_settings_enable_confirmations_and_update_checks_by_default() -> Result<()> {
        let mut json =
            serde_json::to_value(NativeConfig::default()).map_err(|_| error("测试编码失败"))?;
        for key in ["confirmActions", "checkUpdates", "updateReminders"] {
            json.as_object_mut()
                .ok_or_else(|| error("测试结构无效"))?
                .remove(key);
        }
        let restored: NativeConfig =
            serde_json::from_value(json).map_err(|_| error("旧设置迁移失败"))?;
        assert!(restored.confirm_actions && restored.check_updates && restored.update_reminders);
        assert!(!restored.auto_update);
        Ok(())
    }
    #[test]
    fn rejects_unknown_duplicate_and_unsafe_settings() {
        let mut value = NativeConfig::default();
        assert!(value.validate().is_ok());
        value.bindings[1].shortcut = value.bindings[0].shortcut.clone();
        assert!(value.validate().is_err());
        value.bindings[1].enabled = false;
        assert!(value.validate().is_ok());
        value.close_behavior = "run-shell".into();
        assert!(value.validate().is_err());
    }
}
