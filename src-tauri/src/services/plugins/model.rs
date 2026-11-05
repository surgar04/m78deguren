//! 包、索引与 IPC 的严格契约；声明的能力与实际授权始终分离。
use crate::services::tools::{Result, error};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

pub const MAX_PACKAGE: usize = 64 * 1024 * 1024;
pub const MAX_FRAME: usize = 2 * 1024 * 1024;
pub const API_VERSION: &str = "1.0.0";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Permission {
    pub id: String,
    pub reason: String,
    #[serde(default)]
    pub optional: bool,
    #[serde(default)]
    pub origins: Vec<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Contribution {
    pub id: String,
    pub title: String,
    /// page/tool/widget/command 为展示位置，不代表授予任何原生权限。
    pub kind: String,
    pub command: String,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Limits {
    pub memory_mb: u32,
    pub storage_mb: u32,
    pub timeout_ms: u64,
    pub fuel: u64,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Task {
    pub id: String,
    pub command: String,
    pub interval_seconds: u64,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Manifest {
    pub format_version: u32,
    pub id: String,
    pub name: String,
    pub description: String,
    pub version: String,
    pub publisher: String,
    pub language: String,
    pub runtime: String,
    pub api: String,
    pub host: String,
    pub entry: String,
    pub license: String,
    pub data_version: u32,
    pub limits: Limits,
    pub permissions: Vec<Permission>,
    pub contributions: Vec<Contribution>,
    #[serde(default)]
    pub tasks: Vec<Task>,
    #[serde(default)]
    pub update_url: Option<String>,
}

/// 标识符仅采用小写 ASCII，避免 Windows 大小写与 Unicode 归一化造成身份别名。
pub fn identifier(value: &str) -> Result<()> {
    if value.is_empty()
        || value.len() > 96
        || !value.as_bytes()[0].is_ascii_lowercase()
        || !value
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b".-".contains(&b))
        || value
            .split('.')
            .any(|part| part.is_empty() || part.ends_with('-'))
    {
        return Err(error("PLUGIN_INVALID_ID：插件标识无效"));
    }
    Ok(())
}
pub fn text(value: &str, max: usize) -> Result<()> {
    if value.is_empty() || value.len() > max || value.chars().any(|c| c.is_control() && c != '\n') {
        return Err(error("PLUGIN_INVALID_INPUT：文字内容无效或超过上限"));
    }
    Ok(())
}
/// 包内路径不接受 Windows 设备名、ADS、反斜杠和相对路径跳转；解包时再次检查真实文件类型。
pub fn package_path(value: &str) -> Result<()> {
    if value.len() > 240
        || value.split('/').any(|part| {
            let stem = part
                .split('.')
                .next()
                .unwrap_or_default()
                .to_ascii_uppercase();
            part.is_empty()
                || part == "."
                || part == ".."
                || part.starts_with('.')
                || part.ends_with('.')
                || !part
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
                || matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
                || (stem.len() == 4
                    && (stem.starts_with("COM") || stem.starts_with("LPT"))
                    && stem.as_bytes()[3].is_ascii_digit())
        })
    {
        return Err(error("PLUGIN_INVALID_PATH：包内路径不安全"));
    }
    Ok(())
}
pub fn origin(value: &str) -> Result<()> {
    let url = reqwest::Url::parse(value).map_err(|_| error("PLUGIN_INVALID_ORIGIN：域名无效"))?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || url.port_or_known_default() != Some(443)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
        || url.origin().ascii_serialization() != value
    {
        return Err(error(
            "PLUGIN_INVALID_ORIGIN：必须使用不含路径的 HTTPS 来源",
        ));
    }
    Ok(())
}
impl Manifest {
    pub fn validate(&self) -> Result<()> {
        identifier(&self.id)?;
        package_path(&self.id)?;
        if !self.id.contains('.')
            || self.format_version != 1
            || self.runtime != "wasm-component"
            || !["typescript", "csharp", "rust"].contains(&self.language.as_str())
            || self.entry != "component.wasm"
            || self.data_version == 0
        {
            return Err(error(
                "PLUGIN_UNSUPPORTED：插件格式、语言或运行模式不受支持",
            ));
        }
        for (value, max) in [
            (&self.name, 160),
            (&self.description, 2048),
            (&self.publisher, 160),
            (&self.license, 160),
        ] {
            text(value, max)?;
        }
        semver::Version::parse(&self.version).map_err(|_| error("PLUGIN_VERSION：版本无效"))?;
        for (range, version) in [
            (&self.api, API_VERSION),
            (&self.host, env!("CARGO_PKG_VERSION")),
        ] {
            let version = semver::Version::parse(version)
                .map_err(|_| error("PLUGIN_VERSION：宿主版本无效"))?;
            if !semver::VersionReq::parse(range)
                .map_err(|_| error("PLUGIN_VERSION：兼容范围无效"))?
                .matches(&version)
            {
                return Err(error("PLUGIN_INCOMPATIBLE：与当前宿主或 SDK 不兼容"));
            }
        }
        if !(16..=256).contains(&self.limits.memory_mb)
            || !(1..=256).contains(&self.limits.storage_mb)
            || !(100..=30_000).contains(&self.limits.timeout_ms)
            || !(10_000..=500_000_000).contains(&self.limits.fuel)
            || self.permissions.len() > 16
            || self.contributions.len() > 32
            || self.tasks.len() > 8
        {
            return Err(error("PLUGIN_LIMIT：资源预算超过平台上限"));
        }
        let mut ids = BTreeSet::new();
        for p in &self.permissions {
            if ![
                "storage",
                "settings",
                "network",
                "notifications",
                "hardware.read",
                "games.read",
                "background",
                "file.read",
                "file.write",
            ]
            .contains(&p.id.as_str())
                || !ids.insert(&p.id)
                || p.origins.len() > 16
                || (p.id != "network" && !p.origins.is_empty())
            {
                return Err(error("PLUGIN_PERMISSION：能力声明无效或尚未开放"));
            }
            text(&p.reason, 512)?;
            if p.id == "network" && p.origins.is_empty() {
                return Err(error("PLUGIN_PERMISSION：网络权限必须限定来源"));
            }
            for value in &p.origins {
                origin(value)?;
            }
        }
        ids.clear();
        for c in &self.contributions {
            identifier(&c.id)?;
            identifier(&c.command)?;
            text(&c.title, 160)?;
            if ["migrate", "activate", "deactivate"].contains(&c.command.as_str())
                || !["page", "tool", "widget", "command"].contains(&c.kind.as_str())
                || !ids.insert(&c.id)
            {
                return Err(error("PLUGIN_CONTRIBUTION：界面贡献无效或重复"));
            }
        }
        ids.clear();
        for task in &self.tasks {
            identifier(&task.id)?;
            identifier(&task.command)?;
            if ["migrate", "activate", "deactivate"].contains(&task.command.as_str())
                || !(60..=86400).contains(&task.interval_seconds)
                || !ids.insert(&task.id)
                || !self.permissions.iter().any(|p| p.id == "background")
            {
                return Err(error("PLUGIN_TASK：后台任务缺少权限或周期无效"));
            }
        }
        if let Some(url) = &self.update_url {
            let url = reqwest::Url::parse(url).map_err(|_| error("PLUGIN_UPDATE：更新地址无效"))?;
            origin(&url.origin().ascii_serialization())?;
            if !url.username().is_empty() || url.password().is_some() || url.fragment().is_some() {
                return Err(error("PLUGIN_UPDATE：更新地址不能包含凭据或片段"));
            }
        }
        Ok(())
    }
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Record {
    pub manifest: Manifest,
    pub digest: String,
    pub publisher_key: Option<String>,
    pub grants: Vec<String>,
    pub enabled: bool,
    pub quarantined: bool,
    pub failures: u32,
    pub previous: Option<String>,
}
#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Registry {
    pub revision: u64,
    pub safe_mode: bool,
    pub records: std::collections::BTreeMap<String, Record>,
    #[serde(default)]
    pub publishers: std::collections::BTreeMap<String, Option<String>>,
    #[serde(default)]
    pub data_versions: std::collections::BTreeMap<String, u32>,
}

/// 声明式视图递归校验；插件返回的 HTML、CSS、URL 与脚本永远不会直接注入主页面。
pub fn validate_view(value: &serde_json::Value, commands: &[Contribution]) -> Result<()> {
    fn visit(
        value: &serde_json::Value,
        depth: usize,
        count: &mut usize,
        commands: &[Contribution],
    ) -> Result<()> {
        *count += 1;
        if depth > 8 || *count > 200 {
            return Err(error("PLUGIN_VIEW：界面树超过上限"));
        }
        let obj = value
            .as_object()
            .ok_or_else(|| error("PLUGIN_VIEW：界面节点必须是对象"))?;
        if obj.keys().any(|key| {
            !["type", "text", "command", "children", "value", "mode"].contains(&key.as_str())
        }) {
            return Err(error("PLUGIN_VIEW：界面含有未开放属性"));
        }
        let kind = obj.get("type").and_then(|v| v.as_str()).unwrap_or_default();
        if ![
            "stack", "grid", "text", "heading", "button", "file", "metric", "notice",
        ]
        .contains(&kind)
        {
            return Err(error("PLUGIN_VIEW：不支持的界面组件"));
        }
        for field in ["text", "value"] {
            if let Some(v) = obj.get(field) {
                text(
                    v.as_str()
                        .ok_or_else(|| error("PLUGIN_VIEW：文字类型错误"))?,
                    8192,
                )?;
            }
        }
        if kind == "file" {
            if !obj
                .get("mode")
                .and_then(|v| v.as_str())
                .is_some_and(|m| ["read", "write"].contains(&m))
            {
                return Err(error("PLUGIN_VIEW：文件选择器缺少模式"));
            }
        } else if obj.contains_key("mode") {
            return Err(error("PLUGIN_VIEW：当前组件不能设置文件模式"));
        }
        if ["button", "file"].contains(&kind) {
            let command = obj
                .get("command")
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            if !commands.iter().any(|c| c.command == command) {
                return Err(error("PLUGIN_VIEW：按钮引用未声明命令"));
            }
        } else if obj.contains_key("command") {
            return Err(error("PLUGIN_VIEW：当前组件不能声明操作"));
        }
        if let Some(children) = obj.get("children") {
            if !["stack", "grid"].contains(&kind) {
                return Err(error("PLUGIN_VIEW：当前组件不能含子节点"));
            }
            for child in children
                .as_array()
                .ok_or_else(|| error("PLUGIN_VIEW：children 类型错误"))?
            {
                visit(child, depth + 1, count, commands)?;
            }
        }
        Ok(())
    }
    visit(value, 0, &mut 0, commands)
}
