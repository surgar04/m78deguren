//! 子进程、IPC、历史报告共用的强类型契约。无法获取的读数始终为 null。
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Field {
    pub label: String,
    pub value: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Device {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub fields: Vec<Field>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Sensor {
    pub id: String,
    pub hardware_id: String,
    pub hardware: String,
    pub hardware_type: String,
    pub name: String,
    pub sensor_type: String,
    pub unit: String,
    pub value: Option<f64>,
    #[serde(default)]
    pub min: Option<f64>,
    #[serde(default)]
    pub max: Option<f64>,
}
pub type Metrics = BTreeMap<String, Option<f64>>;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Gpu {
    pub id: String,
    pub name: String,
    pub metrics: Metrics,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Fps {
    pub enabled: bool,
    pub process_id: u32,
    pub fps: Option<f64>,
    pub low1: Option<f64>,
    pub low01: Option<f64>,
    pub frame_count: usize,
    pub message: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Sample {
    pub timestamp: i64,
    pub metrics: Metrics,
    pub gpus: Vec<Gpu>,
    pub fps: Fps,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Recording {
    pub count: u64,
    pub start: Option<i64>,
    pub end: Option<i64>,
    pub bytes: u64,
    pub error: Option<String>,
}
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteInfo {
    pub enabled: bool,
    pub url: Option<String>,
    pub qr_svg: Option<String>,
    pub addresses: Vec<String>,
    pub expires_at: Option<i64>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub process_id: u32,
    pub process_name: Option<String>,
    pub status: String,
    pub captured_at: Option<i64>,
    pub devices: Vec<Device>,
    pub sensors: Vec<Sensor>,
    pub metrics: Metrics,
    pub gpus: Vec<Gpu>,
    pub samples: Vec<Sample>,
    pub fps: Fps,
    pub recording: Recording,
    pub warnings: Vec<String>,
    pub privileged: bool,
}
impl Default for Snapshot {
    fn default() -> Self {
        Self {
            process_id: 0,
            process_name: None,
            status: "stopped".into(),
            captured_at: None,
            devices: Vec::new(),
            sensors: Vec::new(),
            metrics: Metrics::new(),
            gpus: Vec::new(),
            samples: Vec::new(),
            fps: Fps::default(),
            recording: Recording::default(),
            warnings: Vec::new(),
            privileged: false,
        }
    }
}
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum Message {
    Hud {
        data: serde_json::Value,
    },
    Capabilities {
        privileged: bool,
    },
    Inventory {
        devices: Vec<Device>,
        warnings: Vec<String>,
    },
    Sample {
        #[serde(rename = "capturedAt")]
        captured_at: i64,
        sensors: Vec<Sensor>,
        metrics: WireMetrics,
        warnings: Vec<String>,
    },
    Error {
        message: String,
    },
}
#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct WireMetrics {
    pub game_process_id: u32,
    pub game_name: Option<String>,
    pub game_reason: Option<String>,
    pub cpu: Option<f64>,
    pub memory: Option<f64>,
    pub memory_used: Option<f64>,
    pub memory_total: Option<f64>,
    pub download: Option<f64>,
    pub upload: Option<f64>,
    pub process_id: u32,
    pub process_name: Option<String>,
}
pub fn text_valid(value: &str, max: usize) -> bool {
    value.chars().count() <= max && !value.chars().any(char::is_control)
}
