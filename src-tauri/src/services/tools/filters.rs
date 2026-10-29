//! 显示滤镜的配置、校准文件和后台所有权。ICC 解析、曲线组合独立于窗口组件。
use super::{Result, error, icc, io_error, platform, save_json};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};
use tokio::{io::AsyncReadExt, sync::Mutex};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Layer {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub temperature: u32,
    pub brightness: u32,
    pub contrast: u32,
    pub gamma: f64,
    pub shadow: i32,
    pub red: f64,
    pub green: f64,
    pub blue: f64,
}
impl Default for Layer {
    fn default() -> Self {
        Self {
            id: "default".into(),
            name: "基础调整".into(),
            enabled: true,
            temperature: 6500,
            brightness: 100,
            contrast: 100,
            gamma: 1.0,
            shadow: 0,
            red: 1.0,
            green: 1.0,
            blue: 1.0,
        }
    }
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Target {
    pub monitor: Option<String>,
    pub layers: Vec<Layer>,
    pub icc: Option<String>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Rule {
    pub process: String,
    pub preset: String,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Config {
    pub targets: Vec<Target>,
    pub saturation: u32,
    pub auto_game: bool,
    pub rules: Vec<Rule>,
}
impl Default for Config {
    fn default() -> Self {
        Self {
            targets: vec![Target {
                monitor: None,
                layers: vec![Layer::default()],
                icc: None,
            }],
            saturation: 100,
            auto_game: false,
            rules: Vec::new(),
        }
    }
}
fn digest(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|value| value.is_ascii_hexdigit())
}
fn ordinary(value: &str, max: usize) -> bool {
    !value.trim().is_empty() && value.chars().count() <= max && !value.chars().any(char::is_control)
}
impl Config {
    pub fn validate(&self) -> Result<()> {
        if self.targets.is_empty()
            || self.targets.len() > 16
            || self.saturation > 200
            || self.rules.len() > 20
        {
            return Err(error("滤镜显示器数量、饱和度或自动规则超出范围"));
        }
        let mut displays = std::collections::HashSet::new();
        for target in &self.targets {
            if !displays.insert(target.monitor.clone())
                || target
                    .monitor
                    .as_deref()
                    .is_some_and(|value| !digest(value))
                || target.icc.as_deref().is_some_and(|value| !digest(value))
                || target.layers.is_empty()
                || target.layers.len() > 8
            {
                return Err(error("滤镜目标或图层配置无效"));
            }
            let mut layers = std::collections::HashSet::new();
            for layer in &target.layers {
                if layer.id.len() > 80
                    || layer.id.is_empty()
                    || !layer
                        .id
                        .bytes()
                        .all(|v| v.is_ascii_alphanumeric() || v == b'-')
                    || !layers.insert(&layer.id)
                    || !ordinary(&layer.name, 40)
                    || !(1000..=12000).contains(&layer.temperature)
                    || !(50..=150).contains(&layer.brightness)
                    || !(50..=150).contains(&layer.contrast)
                    || layer.shadow.unsigned_abs() > 50
                    || [layer.gamma, layer.red, layer.green, layer.blue]
                        .into_iter()
                        .any(|v| !v.is_finite() || !(0.3..=3.0).contains(&v))
                {
                    return Err(error("滤镜图层参数无效"));
                }
            }
        }
        let mut rules = std::collections::HashSet::new();
        for rule in &self.rules {
            if !ordinary(&rule.process, 80)
                || rule
                    .process
                    .contains(['\\', '/', ':', '*', '?', '|', '<', '>', '"'])
                || !rule.process.to_ascii_lowercase().ends_with(".exe")
                || !rules.insert(rule.process.to_ascii_lowercase())
                || (!rule.preset.starts_with("builtin-")
                    && uuid::Uuid::parse_str(&rule.preset).is_err())
            {
                return Err(error("自动滤镜规则需为不重复的 EXE 文件名及有效预设"));
            }
        }
        Ok(())
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Preset {
    pub id: String,
    pub name: String,
    pub config: Config,
    pub builtin: bool,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Profile {
    pub id: String,
    pub name: String,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub config: Config,
    pub presets: Vec<Preset>,
    pub profiles: Vec<Profile>,
    pub enabled: bool,
    pub phase: String,
    pub message: String,
    pub active_preset: Option<String>,
    pub preview_remaining: u32,
    pub recovery_id: Option<String>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Preferences {
    config: Config,
    presets: Vec<Preset>,
}
struct Worker {
    root: PathBuf,
    handle: tokio::task::JoinHandle<()>,
}
pub struct FilterService {
    pub snapshot: Arc<Mutex<Snapshot>>,
    worker: Mutex<Option<Worker>>,
    serial: Mutex<()>,
}
fn builtins() -> Vec<Preset> {
    ["中性", "柔和暖色", "暗部增强"]
        .into_iter()
        .enumerate()
        .map(|(index, name)| {
            let mut config = Config::default();
            if let Some(layer) = config
                .targets
                .first_mut()
                .and_then(|target| target.layers.first_mut())
            {
                if index == 1 {
                    layer.temperature = 4500;
                    layer.brightness = 95;
                }
                if index == 2 {
                    layer.gamma = 1.1;
                    layer.shadow = 8;
                    layer.contrast = 108;
                }
            }
            Preset {
                id: format!("builtin-{index}"),
                name: name.into(),
                config,
                builtin: true,
            }
        })
        .collect()
}
impl FilterService {
    /// 维护游戏名单只改配置；运行中的颜色看门狗必须先停用，避免无确认切换实际曲线。
    pub async fn update_rules(&self, root: &Path, rules: Vec<Rule>, auto_game: bool) -> Result<()> {
        let _guard = self.serial.lock().await;
        let current = self.snapshot.lock().await.clone();
        if current.enabled {
            return Err(error("请先停用显示滤镜，再维护游戏名单"));
        }
        let mut candidate = current.config.clone();
        candidate.rules = rules;
        candidate.auto_game = auto_game;
        candidate.validate()?;
        for rule in &candidate.rules {
            if !current
                .presets
                .iter()
                .any(|preset| preset.id == rule.preset)
            {
                return Err(error("规则引用的滤镜预设不存在"));
            }
        }
        self.snapshot.lock().await.config = candidate;
        if let Err(cause) = self.persist(root).await {
            self.snapshot.lock().await.config = current.config;
            return Err(cause);
        }
        Ok(())
    }
    pub async fn profile_remove(&self, root: &Path, id: &str) -> Result<()> {
        let _guard = self.serial.lock().await;
        let current = self.snapshot.lock().await;
        if current
            .config
            .targets
            .iter()
            .any(|target| target.icc.as_deref() == Some(id))
            || current.presets.iter().any(|preset| {
                preset
                    .config
                    .targets
                    .iter()
                    .any(|target| target.icc.as_deref() == Some(id))
            })
        {
            return Err(error("ICC 仍被配置或预设引用，请先解除关联并保存"));
        }
        drop(current);
        remove_profile(root, id).await
    }
    pub async fn recover(&self, root: &Path, id: &str, consent: bool) -> Result<()> {
        uuid::Uuid::parse_str(id).map_err(|_| error("滤镜恢复标识无效"))?;
        if !consent {
            return Err(error("必须确认原始曲线恢复会覆盖当前颜色设置"));
        }
        let _guard = self.serial.lock().await;
        self.stop_worker().await?;
        let directory = root.join(format!("filter-{id}"));
        super::check_local_path(&directory).await?;
        let response = platform::run_system(
            root,
            "filter-recover",
            &[directory.to_string_lossy().into_owned()],
            Duration::from_secs(45),
        )
        .await?;
        let mut current = self.snapshot.lock().await;
        current.phase = "restored".into();
        current.enabled = false;
        current.recovery_id = None;
        current.message = response["message"]
            .as_str()
            .unwrap_or("已恢复原始曲线")
            .into();
        Ok(())
    }
    pub fn load(root: &Path) -> Self {
        let saved = std::fs::read(root.join("display-filter.json"))
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Preferences>(&bytes).ok());
        let (mut config, mut presets) = (Config::default(), builtins());
        if let Some(value) = saved {
            if value.config.validate().is_ok() {
                config = value.config;
            }
            presets.extend(
                value
                    .presets
                    .into_iter()
                    .filter(|preset| {
                        !preset.builtin
                            && uuid::Uuid::parse_str(&preset.id).is_ok()
                            && ordinary(&preset.name, 80)
                            && preset.config.validate().is_ok()
                    })
                    .take(30),
            );
        }
        Self {
            snapshot: Arc::new(Mutex::new(Snapshot {
                config,
                presets,
                profiles: Vec::new(),
                enabled: false,
                phase: "idle".into(),
                message: String::new(),
                active_preset: None,
                preview_remaining: 0,
                recovery_id: pending_recovery(root),
            })),
            worker: Mutex::new(None),
            serial: Mutex::new(()),
        }
    }
    pub async fn status(&self, root: &Path) -> Result<Snapshot> {
        let profiles = profiles(root).await?;
        let mut current = self.snapshot.lock().await;
        current.profiles = profiles;
        Ok(current.clone())
    }
    async fn persist(&self, root: &Path) -> Result<()> {
        let current = self.snapshot.lock().await;
        save_json(
            &root.join("display-filter.json"),
            &Preferences {
                config: current.config.clone(),
                presets: current
                    .presets
                    .iter()
                    .filter(|preset| !preset.builtin)
                    .cloned()
                    .collect(),
            },
        )
        .await
    }
    pub async fn preset_save(&self, root: &Path, name: String, config: Config) -> Result<()> {
        config.validate()?;
        if !ordinary(&name, 80) {
            return Err(error("滤镜预设名称无效"));
        }
        let _guard = self.serial.lock().await;
        {
            let mut current = self.snapshot.lock().await;
            if current
                .presets
                .iter()
                .filter(|value| !value.builtin)
                .count()
                >= 30
            {
                return Err(error("最多保存 30 个用户滤镜预设"));
            }
            current.presets.push(Preset {
                id: uuid::Uuid::new_v4().to_string(),
                name,
                config,
                builtin: false,
            });
        }
        self.persist(root).await
    }
    pub async fn preset_remove(&self, root: &Path, id: &str) -> Result<()> {
        uuid::Uuid::parse_str(id).map_err(|_| error("不能删除内置滤镜预设"))?;
        let _guard = self.serial.lock().await;
        {
            let mut current = self.snapshot.lock().await;
            if current.config.rules.iter().any(|rule| rule.preset == id) {
                return Err(error("此预设仍被自动规则使用，请先移除规则"));
            }
            current.presets.retain(|preset| preset.id != id);
        }
        self.persist(root).await
    }
    async fn stop_worker(&self) -> Result<()> {
        let worker = self.worker.lock().await.take();
        if let Some(mut worker) = worker {
            save_json(
                &worker.root.join("stop.json"),
                &serde_json::json!({"stop":true}),
            )
            .await?;
            if tokio::time::timeout(Duration::from_secs(12), &mut worker.handle)
                .await
                .is_err()
            {
                *self.worker.lock().await = Some(worker);
                return Err(error("滤镜恢复仍在进行，不能启动另一个颜色写入任务"));
            }
        }
        Ok(())
    }
    pub async fn configure(
        &self,
        root: &Path,
        config: Config,
        enabled: bool,
        preview: bool,
        consent: bool,
    ) -> Result<()> {
        config.validate()?;
        if enabled && !consent {
            return Err(error("必须确认显示颜色修改及饱和度作用范围"));
        }
        let _guard = self.serial.lock().await;
        self.stop_worker().await?;
        if !enabled {
            {
                let mut current = self.snapshot.lock().await;
                current.enabled = false;
                current.config = config;
            }
            self.persist(root).await?;
            return Ok(());
        }
        let available =
            platform::run_system(root, "displays", &[], Duration::from_secs(30)).await?;
        let monitors = available["monitors"]
            .as_array()
            .ok_or_else(|| error("显示器列表无效"))?;
        let all = self.snapshot.lock().await.presets.clone();
        let mut plans = vec![compile_plan(root, "base", &config, monitors).await?];
        let mut ids = std::collections::HashSet::new();
        for rule in &config.rules {
            if ids.insert(&rule.preset) {
                let preset = all
                    .iter()
                    .find(|preset| preset.id == rule.preset)
                    .ok_or_else(|| error("自动规则引用的预设已删除"))?;
                plans.push(compile_plan(root, &preset.id, &preset.config, monitors).await?);
            }
        }
        let id = uuid::Uuid::new_v4().to_string();
        let directory = root.join(format!("filter-{id}"));
        super::check_local_path(&directory).await?;
        tokio::fs::create_dir_all(&directory)
            .await
            .map_err(io_error)?;
        let request = directory.join("request.json");
        save_json(&request,&serde_json::json!({"plans":plans,"rules":config.rules,"autoGame":config.auto_game,"preview":preview})).await?;
        let bytes = tokio::fs::read(&request).await.map_err(io_error)?;
        let hash = format!("{:x}", Sha256::digest(bytes));
        let mut child = platform::spawn_filter(
            root,
            &[
                directory.to_string_lossy().into_owned(),
                hash,
                std::process::id().to_string(),
            ],
        )
        .await?;
        {
            let mut current = self.snapshot.lock().await;
            current.config = config;
            current.enabled = true;
            current.phase = "starting".into();
            current.message = "正在保存原始显示曲线…".into();
            current.recovery_id = Some(id);
        }
        self.persist(root).await?;
        let snapshot = self.snapshot.clone();
        let storage = directory.clone();
        let stderr = child.stderr.take();
        let stdout = child.stdout.take();
        let handle = tokio::spawn(async move {
            let errors = tokio::spawn(async move {
                let mut bytes = Vec::new();
                if let Some(stream) = stderr {
                    let _ = stream.take(16384).read_to_end(&mut bytes).await;
                }
                String::from_utf8_lossy(&bytes).into_owned()
            });
            let output = tokio::spawn(async move {
                let mut bytes = Vec::new();
                if let Some(stream) = stdout {
                    let _ = stream.take(16384).read_to_end(&mut bytes).await;
                }
            });
            loop {
                if let Ok(bytes) = tokio::fs::read(storage.join("snapshot.json")).await {
                    #[derive(Deserialize)]
                    #[serde(rename_all = "camelCase")]
                    struct Update {
                        phase: String,
                        message: String,
                        active_preset: Option<String>,
                        preview_remaining: u32,
                    }
                    if bytes.len() < 8192
                        && let Ok(value) = serde_json::from_slice::<Update>(&bytes)
                    {
                        let mut current = snapshot.lock().await;
                        current.phase = value.phase;
                        current.message = value.message;
                        current.active_preset = value.active_preset;
                        current.preview_remaining = value.preview_remaining;
                    }
                }
                if !matches!(child.try_wait(), Ok(None)) {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(300)).await;
            }
            let status = child.wait().await;
            // 子进程可能在两次轮询之间完成恢复；退出后再读最后回执，不能把已恢复误报为失败。
            let final_update = tokio::fs::read(storage.join("snapshot.json"))
                .await
                .ok()
                .filter(|bytes| bytes.len() < 8192)
                .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok());
            let detail = errors.await.unwrap_or_default();
            let _ = output.await;
            if !detail.is_empty() {
                log::warn!("滤镜服务：{detail}");
            }
            let mut current = snapshot.lock().await;
            current.enabled = false;
            if let Some(value) = final_update
                && let Some(phase) = value["phase"]
                    .as_str()
                    .filter(|phase| ["restored", "failed"].contains(phase))
            {
                current.phase = phase.into();
                current.message = value["message"]
                    .as_str()
                    .unwrap_or("请检查原始曲线恢复记录")
                    .into();
                current.active_preset = None;
                current.preview_remaining = 0;
            }
            if current.phase != "restored" {
                current.phase = "failed".into();
                if current.message.is_empty() || current.message.contains('…') {
                    current.message = "滤镜已停止，请检查原始曲线恢复记录".into();
                }
            }
            if !matches!(status,Ok(code) if code.success()) && current.phase != "restored" {
                current.message = "滤镜恢复服务异常，请使用恢复入口检查原始曲线".into();
            }
        });
        *self.worker.lock().await = Some(Worker {
            root: directory,
            handle,
        });
        Ok(())
    }
    pub async fn keep(&self) -> Result<()> {
        let _guard = self.serial.lock().await;
        let current = self.snapshot.lock().await;
        if !current.enabled || current.preview_remaining == 0 {
            return Err(error("滤镜预览已结束"));
        }
        let directory = self
            .worker
            .lock()
            .await
            .as_ref()
            .map(|worker| worker.root.clone())
            .ok_or_else(|| error("预览会话不存在"))?;
        save_json(
            &directory.join("keep.json"),
            &serde_json::json!({"keep":true}),
        )
        .await
    }
}
/// 启动时找出尚未恢复的最近会话；不自动改变颜色，只让用户在界面确认后恢复。
fn pending_recovery(root: &Path) -> Option<String> {
    let mut candidates = Vec::new();
    for entry in std::fs::read_dir(root).ok()?.flatten().take(4096) {
        let name = entry.file_name().to_string_lossy().into_owned();
        let Some(id) = name
            .strip_prefix("filter-")
            .filter(|id| uuid::Uuid::parse_str(id).is_ok())
        else {
            continue;
        };
        let metadata = entry.file_type().ok()?;
        if !metadata.is_dir() || metadata.is_symlink() {
            continue;
        }
        let backup = entry.path().join("backup.json");
        let Ok(meta) = std::fs::metadata(&backup) else {
            continue;
        };
        if meta.len() > 131072 {
            continue;
        }
        let restored = std::fs::read(entry.path().join("snapshot.json"))
            .ok()
            .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
            .is_some_and(|value| value["phase"] == "restored");
        if !restored {
            candidates.push((meta.modified().ok(), id.to_owned()));
        }
    }
    candidates.sort_by_key(|row| std::cmp::Reverse(row.0));
    candidates.into_iter().next().map(|(_, id)| id)
}
async fn compile_plan(
    root: &Path,
    id: &str,
    config: &Config,
    monitors: &[serde_json::Value],
) -> Result<serde_json::Value> {
    config.validate()?;
    let mut targets = Vec::new();
    let mut identities = std::collections::HashSet::new();
    for target in &config.targets {
        let monitor = if let Some(id) = &target.monitor {
            monitors
                .iter()
                .find(|monitor| monitor["id"].as_str() == Some(id))
        } else {
            monitors.first()
        }
        .ok_or_else(|| error("滤镜目标显示器已断开，请重新选择"))?;
        let key = monitor["id"]
            .as_str()
            .ok_or_else(|| error("显示器没有稳定标识"))?;
        if !identities.insert(key) {
            return Err(error("多个滤镜目标解析到同一显示器"));
        }
        let ramp = target_ramp(root, target).await?;
        targets.push(serde_json::json!({"id":key,"device":monitor["device"],"identity":monitor["identity"],"ramp":ramp}));
    }
    Ok(
        serde_json::json!({"id":id,"targets":targets,"saturation":f64::from(config.saturation)/100.0}),
    )
}
fn temperature(kelvin: f64) -> [f64; 3] {
    let t = kelvin / 100.0;
    let r = if t <= 66.0 {
        255.0
    } else {
        329.698727446 * (t - 60.0).powf(-0.1332047592)
    };
    let g = if t <= 66.0 {
        99.4708025861 * t.ln() - 161.1195681661
    } else {
        288.1221695283 * (t - 60.0).powf(-0.0755148492)
    };
    let b = if t >= 66.0 {
        255.0
    } else if t <= 19.0 {
        0.0
    } else {
        138.5177312231 * (t - 10.0).ln() - 305.0447927307
    };
    [
        r.clamp(0.0, 255.0),
        g.clamp(0.0, 255.0),
        b.clamp(0.0, 255.0),
    ]
}
fn transform(mut ramp: Vec<u16>, layers: &[Layer]) -> Vec<u16> {
    let neutral = temperature(6500.0);
    for layer in layers.iter().filter(|layer| layer.enabled) {
        let gains = temperature(f64::from(layer.temperature));
        for channel in 0..3 {
            let gamma = layer.gamma * [layer.red, layer.green, layer.blue][channel];
            for sample in &mut ramp[channel * 256..channel * 256 + 256] {
                let x = f64::from(*sample) / 65535.0;
                let mut y = x.powf(1.0 / gamma);
                y = (y - 0.5) * (f64::from(layer.contrast) / 100.0) + 0.5;
                y += f64::from(layer.shadow) / 100.0 * (1.0 - y).powi(2);
                y *= f64::from(layer.brightness) / 100.0 * gains[channel] / neutral[channel];
                *sample = (y.clamp(0.0, 1.0) * 65535.0).round() as u16;
            }
        }
    }
    ramp
}
pub async fn target_ramp(root: &Path, target: &Target) -> Result<Vec<u16>> {
    let config = Config {
        targets: vec![target.clone()],
        ..Config::default()
    };
    config.validate()?;
    let bytes = if let Some(id) = &target.icc {
        let path = root.join("icc-profiles").join(format!("{id}.icc"));
        super::check_local_path(&path).await?;
        let file = tokio::fs::File::open(&path).await.map_err(io_error)?;
        let mut bytes = Vec::new();
        file.take(16_777_217)
            .read_to_end(&mut bytes)
            .await
            .map_err(io_error)?;
        Some(bytes)
    } else {
        None
    };
    let layers = target.layers.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let ramp = if let Some(bytes) = bytes {
            icc::parse(&bytes)?
        } else {
            icc::linear()
        };
        Ok(transform(ramp, &layers))
    })
    .await
    .map_err(|_| error("颜色曲线计算失败"))?
}
pub async fn profiles(root: &Path) -> Result<Vec<Profile>> {
    let directory = root.join("icc-profiles");
    super::check_local_path(&directory).await?;
    let mut result = Vec::new();
    let mut entries = match tokio::fs::read_dir(&directory).await {
        Ok(value) => value,
        Err(cause) if cause.kind() == std::io::ErrorKind::NotFound => return Ok(result),
        Err(cause) => return Err(io_error(cause)),
    };
    while let Some(entry) = entries.next_entry().await.map_err(io_error)? {
        if result.len() >= 30 {
            break;
        }
        let path = entry.path();
        super::check_local_path(&path).await?;
        if path.extension().is_some_and(|value| value == "json")
            && entry.metadata().await.map_err(io_error)?.len() < 4096
            && let Ok(bytes) = tokio::fs::read(&path).await
            && let Ok(profile) = serde_json::from_slice::<Profile>(&bytes)
            && digest(&profile.id)
            && ordinary(&profile.name, 80)
            && tokio::fs::metadata(directory.join(format!("{}.icc", profile.id)))
                .await
                .is_ok_and(|metadata| metadata.is_file())
        {
            result.push(profile);
        }
    }
    Ok(result)
}
pub async fn import_profile(root: &Path, path: PathBuf) -> Result<Profile> {
    super::check_local_path(&path).await?;
    let file = tokio::fs::File::open(&path).await.map_err(io_error)?;
    let mut bytes = Vec::new();
    file.take(16_777_217)
        .read_to_end(&mut bytes)
        .await
        .map_err(io_error)?;
    let inspect = bytes.clone();
    tauri::async_runtime::spawn_blocking(move || icc::parse(&inspect))
        .await
        .map_err(|_| error("ICC 文件检查失败"))??;
    let id = format!("{:x}", Sha256::digest(&bytes));
    if profiles(root).await?.len() >= 30 {
        return Err(error("最多导入 30 个 ICC 文件"));
    }
    let name = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("ICC 校准曲线")
        .chars()
        .filter(|value| !value.is_control())
        .take(80)
        .collect();
    let profile = Profile { id, name };
    let directory = root.join("icc-profiles");
    super::check_local_path(&directory).await?;
    tokio::fs::create_dir_all(&directory)
        .await
        .map_err(io_error)?;
    tokio::fs::write(directory.join(format!("{}.icc", profile.id)), bytes)
        .await
        .map_err(io_error)?;
    save_json(&directory.join(format!("{}.json", profile.id)), &profile).await?;
    Ok(profile)
}
pub async fn remove_profile(root: &Path, id: &str) -> Result<()> {
    if !digest(id) {
        return Err(error("ICC 标识无效"));
    }
    let directory = root.join("icc-profiles");
    for ext in ["icc", "json"] {
        let path = directory.join(format!("{id}.{ext}"));
        super::check_local_path(&path).await?;
        tokio::fs::remove_file(path).await.map_err(io_error)?;
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn neutral_transform_is_identity() {
        assert_eq!(transform(icc::linear(), &[Layer::default()]), icc::linear());
    }
    #[test]
    fn rejects_nonfinite_colors_and_path_rules() {
        let mut config = Config::default();
        config.targets[0].layers[0].red = f64::NAN;
        assert!(config.validate().is_err());
        config.targets[0].layers[0].red = 1.0;
        config.rules.push(Rule {
            process: "C:/Windows/cmd.exe".into(),
            preset: "builtin-0".into(),
        });
        assert!(config.validate().is_err());
    }
}
