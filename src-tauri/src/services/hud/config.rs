//! HUD 唯一配置。上游模板只参与受限表达式解析，不作为 HTML、脚本或原生命令执行。
use crate::services::tools::{Result, error};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, HashSet};

pub const MASK: &str = "••••";
pub fn presets() -> Vec<Value> {
    serde_json::from_str(include_str!(
        "../../../../src/features/hud/upstream-presets.json"
    ))
    .unwrap_or_default()
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Mapping {
    pub variable: String,
    pub json_path: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HttpSource {
    pub name: String,
    pub enabled: bool,
    pub url: String,
    pub refresh_seconds: u32,
    pub headers: BTreeMap<String, String>,
    pub fields: Vec<Mapping>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Trigger {
    pub id: String,
    pub enabled: bool,
    pub name: String,
    pub variable: String,
    pub mode: String,
    pub operator: String,
    pub value: f64,
    pub cooldown_seconds: u32,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct Config {
    pub version: u8,
    pub enabled: bool,
    pub mode: String,
    pub scale: f64,
    pub opacity: f64,
    pub monitor: usize,
    pub position: String,
    pub x: f64,
    pub y: f64,
    pub locked: bool,
    pub layer: String,
    pub always_show: bool,
    pub hotzone: bool,
    pub power_events: bool,
    pub display_seconds: u32,
    pub cycle_seconds: u32,
    pub animation: String,
    pub bounce: f64,
    pub ripple: f64,
    pub spread: f64,
    pub font_scale: f64,
    pub reduced_motion: bool,
    pub sampling_ms: u32,
    pub frames: bool,
    pub active_profile: String,
    pub queue: Vec<String>,
    pub profiles: Vec<Value>,
    pub deepseek_key: String,
    pub http_sources: Vec<HttpSource>,
    pub include_processes: Vec<String>,
    pub exclude_processes: Vec<String>,
    pub auto_cycle: bool,
    pub click_to_cycle: bool,
    pub triggers: Vec<Trigger>,
}
impl Default for Config {
    fn default() -> Self {
        Self {
            version: 1,
            enabled: false,
            mode: "auto".into(),
            scale: 0.8,
            opacity: 1.0,
            monitor: 0,
            position: "top-center".into(),
            x: 0.0,
            y: 12.0,
            locked: false,
            layer: "topmost".into(),
            always_show: true,
            hotzone: true,
            power_events: true,
            display_seconds: 6,
            cycle_seconds: 8,
            animation: "full".into(),
            bounce: 0.275,
            ripple: 1.0,
            spread: 1.0,
            font_scale: 1.0,
            reduced_motion: false,
            sampling_ms: 1000,
            frames: true,
            active_profile: "system.memory".into(),
            queue: vec!["system.memory".into()],
            profiles: presets(),
            deepseek_key: String::new(),
            http_sources: vec![],
            include_processes: vec![],
            exclude_processes: vec![],
            auto_cycle: true,
            click_to_cycle: true,
            triggers: vec![],
        }
    }
}
fn number(value: f64, min: f64, max: f64) -> bool {
    value.is_finite() && (min..=max).contains(&value)
}
fn text(value: &str, max: usize) -> bool {
    value.chars().count() <= max && !value.chars().any(char::is_control)
}
fn key(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
}
impl Config {
    pub fn public(&self) -> Self {
        let mut public = self.clone();
        if !public.deepseek_key.is_empty() {
            public.deepseek_key = MASK.into();
        }
        for source in &mut public.http_sources {
            for value in source.headers.values_mut() {
                *value = MASK.into();
            }
        }
        public
    }
    pub fn validate(&self) -> Result<()> {
        let mut trigger_ids = HashSet::new();
        if self.triggers.len() > 64
            || self.triggers.iter().any(|t| {
                !key(&t.id)
                    || !trigger_ids.insert(&t.id)
                    || !text(&t.name, 128)
                    || !key(&t.variable)
                    || !["Threshold", "Change", "BecomesTrue"].contains(&t.mode.as_str())
                    || ![">=", ">", "<=", "<", "==", "!="].contains(&t.operator.as_str())
                    || !t.value.is_finite()
                    || !(1..=86400).contains(&t.cooldown_seconds)
            })
        {
            return Err(error("HUD 条件触发规则无效"));
        }
        if self.version != 1
            || !["auto", "normal", "game"].contains(&self.mode.as_str())
            || !number(self.scale, 0.4, 1.6)
            || !number(self.opacity, 0.15, 1.0)
            || self.monitor > 31
            || ![
                "top-left",
                "top-center",
                "top-right",
                "center-left",
                "center",
                "center-right",
                "bottom-left",
                "bottom-center",
                "bottom-right",
                "custom",
            ]
            .contains(&self.position.as_str())
            || !number(self.x, -32768.0, 32768.0)
            || !number(self.y, -32768.0, 32768.0)
            || !["topmost", "desktop"].contains(&self.layer.as_str())
            || !(3..=30).contains(&self.display_seconds)
            || !(3..=120).contains(&self.cycle_seconds)
            || !["full", "simple", "roll"].contains(&self.animation.as_str())
            || !number(self.bounce, 0.0, 0.5)
            || !number(self.ripple, 0.0, 2.0)
            || !number(self.spread, 0.5, 1.5)
            || !number(self.font_scale, 0.7, 1.5)
            || !(500..=60000).contains(&self.sampling_ms)
            || self.profiles.is_empty()
            || self.profiles.len() > 128
            || self.queue.len() > 128
            || self.deepseek_key.len() > 32768
            || self.http_sources.len() > 16
        {
            return Err(error("HUD 显示配置超出允许范围"));
        }
        let canonical = presets();
        let fields: HashSet<_> = canonical
            .first()
            .and_then(Value::as_object)
            .map(|p| p.keys().cloned().collect())
            .unwrap_or_default();
        let mut ids = HashSet::new();
        for profile in &self.profiles {
            let object = profile
                .as_object()
                .ok_or_else(|| error("HUD 方案必须是对象"))?;
            let id = object
                .get("id")
                .and_then(Value::as_str)
                .filter(|id| key(id))
                .ok_or_else(|| error("HUD 方案标识无效"))?;
            if !ids.insert(id)
                || object.len() != fields.len()
                || object.keys().any(|k| !fields.contains(k))
            {
                return Err(error("HUD 方案有重复标识或未知字段"));
            }
            for (name, value) in object {
                let sample = canonical[0]
                    .get(name)
                    .ok_or_else(|| error("HUD 方案字段无效"))?;
                let valid = match name.as_str() {
                    "timeUtcOffsetMinutes" => {
                        value.is_null() || value.as_i64().is_some_and(|v| (-720..=840).contains(&v))
                    }
                    "colorRules" => value.as_array().is_some_and(|rules| {
                        rules.len() <= 32
                            && rules.iter().all(|rule| {
                                rule.as_object().is_some_and(|r| {
                                    r.len() == 4
                                        && r.get("variable")
                                            .and_then(Value::as_str)
                                            .is_some_and(|v| text(v, 512))
                                        && r.get("operator").and_then(Value::as_str).is_some_and(
                                            |v| {
                                                [">=", "<=", ">", "<", "==", "!=", "="].contains(&v)
                                            },
                                        )
                                        && r.get("value")
                                            .and_then(Value::as_f64)
                                            .is_some_and(|n| number(n, -1e15, 1e15))
                                        && r.get("color").and_then(Value::as_str).is_some_and(color)
                                })
                            })
                    }),
                    _ if sample.is_string() => value.as_str().is_some_and(|v| text(v, 2048)),
                    _ if sample.is_boolean() => value.is_boolean(),
                    _ if sample.is_number() => {
                        value.as_f64().is_some_and(|v| number(v, -1e15, 1e15))
                    }
                    _ => false,
                };
                if !valid {
                    return Err(error(format!("HUD 方案字段无效：{name}")));
                }
            }
            if !object
                .get("accentColor")
                .and_then(Value::as_str)
                .is_some_and(color)
                || !object
                    .get("animationMode")
                    .and_then(Value::as_str)
                    .is_some_and(|s| ["Full", "Simple"].contains(&s))
                || !object
                    .get("probeProtocol")
                    .and_then(Value::as_str)
                    .is_some_and(|s| ["ICMP", "TCP", "UDP"].contains(&s))
                || !object
                    .get("probePort")
                    .and_then(Value::as_u64)
                    .is_some_and(|p| (1..=65535).contains(&p))
            {
                return Err(error("HUD 方案颜色、动画或探测配置无效"));
            }
        }
        if !ids.contains(self.active_profile.as_str())
            || self.queue.iter().any(|id| !ids.contains(id.as_str()))
        {
            return Err(error("HUD 当前方案或轮播队列不存在"));
        }
        let mut sources = HashSet::new();
        for source in &self.http_sources {
            let url = reqwest::Url::parse(&source.url).map_err(|_| error("HTTP 数据源地址无效"))?;
            if !key(&source.name)
                || !sources.insert(&source.name)
                || !["http", "https"].contains(&url.scheme())
                || !url.username().is_empty()
                || url.password().is_some()
                || !(5..=86400).contains(&source.refresh_seconds)
                || source.headers.len() > 32
                || source.fields.is_empty()
                || source.fields.len() > 64
                || source.headers.iter().any(|(name, value)| {
                    reqwest::header::HeaderName::from_bytes(name.as_bytes()).is_err()
                        || !text(value, 32768)
                })
                || source
                    .fields
                    .iter()
                    .any(|field| !key(&field.variable) || !text(&field.json_path, 512))
            {
                return Err(error("HTTP 数据源配置无效"));
            }
        }
        for list in [&self.include_processes, &self.exclude_processes] {
            if list.len() > 128 || list.iter().any(|name| !key(name)) {
                return Err(error("游戏进程规则只允许填写 EXE 文件名"));
            }
        }
        Ok(())
    }
}
fn color(value: &str) -> bool {
    value.len() == 7 && value.starts_with('#') && value[1..].bytes().all(|b| b.is_ascii_hexdigit())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn presets_are_real_migrated_profiles_and_validation_is_closed() {
        let mut c = Config::default();
        assert_eq!(c.profiles.len(), 12);
        assert!(c.validate().is_ok());
        c.profiles[0]["script"] = Value::String("invalid".into());
        assert!(c.validate().is_err());
        let c = Config {
            scale: f64::NAN,
            ..Config::default()
        };
        assert!(c.validate().is_err());
        let mut c = Config::default();
        c.queue.push("missing".into());
        assert!(c.validate().is_err());
    }
    #[test]
    fn public_config_never_exports_saved_credentials() {
        let mut c = Config {
            deepseek_key: "dpapi:secret".into(),
            ..Config::default()
        };
        assert_eq!(c.public().deepseek_key, MASK);
        c.deepseek_key.clear();
        assert!(c.public().deepseek_key.is_empty());
    }
}
