//! 统一 HUD：一个配置源、一个窗口、共享硬件和媒体服务。关闭 HUD 后停止其独占资源。
pub mod config;
pub mod runtime;
pub mod window;
use crate::services::{
    hardware,
    tools::{Result, check_local_path, ensure_local_path, error, io_error, save_json},
};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    process::Stdio,
    sync::atomic::{AtomicI64, Ordering},
    time::Duration,
};
use tauri::{Emitter, Manager};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    sync::{Mutex, Notify, RwLock},
};
pub struct HudState {
    pub root: PathBuf,
    pub config: Mutex<config::Config>,
    pub snapshot: RwLock<Value>,
    pub serial: Mutex<()>,
    pub wake: Notify,
    pub preview_until: AtomicI64,
    pub cycle: std::sync::atomic::AtomicUsize,
    pub locale: RwLock<String>,
    pub peek_until: AtomicI64,
    pub cancellation: tokio_util::sync::CancellationToken,
}
impl HudState {
    pub fn new(root: &Path) -> Result<Self> {
        let directory = root.join("hardware/hud");
        ensure_local_path(&directory)?;
        std::fs::create_dir_all(&directory).map_err(io_error)?;
        let path = directory.join("config.json");
        ensure_local_path(&path)?;
        let config = if path.exists() {
            let bytes = std::fs::read(&path).map_err(io_error)?;
            let parsed = if bytes.len() <= 524288 {
                serde_json::from_slice::<config::Config>(&bytes)
                    .ok()
                    .filter(|v| v.validate().is_ok())
            } else {
                None
            };
            if let Some(value) = parsed {
                value
            } else {
                // 单一功能的损坏偏好不应阻止整个应用启动；保留原文件供手动恢复。
                let quarantine = directory.join(format!(
                    "config-invalid-{}.json",
                    chrono::Utc::now().timestamp_millis()
                ));
                std::fs::rename(&path, quarantine).map_err(io_error)?;
                log::warn!("HUD 配置损坏，已保留原文件并恢复关闭状态");
                config::Config::default()
            }
        } else {
            let mut initial = config::Config::default();
            // 只迁移开关和外观，不继承旧采样器；下一次保存后只有新的 HUD 配置生效。
            if let Ok(bytes) = std::fs::read(root.join("settings/config.json"))
                && let Ok(old) = serde_json::from_slice::<Value>(&bytes)
            {
                initial.enabled = old["desktopIsland"].as_bool().unwrap_or(false);
            }
            if let Ok(bytes) = std::fs::read(root.join("tools/overlay.json"))
                && let Ok(old) = serde_json::from_slice::<Value>(&bytes)
                && let Some(opacity) = old["opacity"].as_f64().filter(|v| (0.15..=1.0).contains(v))
            {
                initial.opacity = opacity;
            }
            initial
        };
        if !path.exists() {
            // 迁移结果立即落盘，避免旧设置的下一次保存使开关丢失。
            let bytes =
                serde_json::to_vec_pretty(&config).map_err(|_| error("HUD 初始配置无效"))?;
            let temporary = directory.join("config.initial.tmp");
            std::fs::write(&temporary, bytes).map_err(io_error)?;
            std::fs::rename(temporary, &path).map_err(io_error)?;
        }
        Ok(Self {
            root: directory,
            config: Mutex::new(config),
            snapshot: RwLock::new(json!({})),
            serial: Mutex::new(()),
            wake: Notify::new(),
            preview_until: AtomicI64::new(0),
            cycle: std::sync::atomic::AtomicUsize::new(0),
            locale: RwLock::new("zh-CN".into()),
            peek_until: AtomicI64::new(0),
            cancellation: tokio_util::sync::CancellationToken::new(),
        })
    }
    pub async fn apply(&self, app: &tauri::AppHandle, mut next: config::Config) -> Result<()> {
        let _serial = self.serial.lock().await;
        next.validate()?;
        if serde_json::to_vec(&next)
            .map_err(|_| error("HUD 配置无效"))?
            .len()
            > 524288
        {
            return Err(error("HUD 配置过大"));
        }
        let old = self.config.lock().await.clone();
        let mut secrets = BTreeMap::new();
        if next.deepseek_key == config::MASK {
            next.deepseek_key = old.deepseek_key.clone();
        } else if !next.deepseek_key.is_empty() {
            secrets.insert("deepseek".to_owned(), next.deepseek_key.clone());
        }
        for source in &mut next.http_sources {
            for (name, value) in &mut source.headers {
                if value == config::MASK {
                    *value = old
                        .http_sources
                        .iter()
                        .find(|s| s.name == source.name && s.url == source.url)
                        .and_then(|s| s.headers.get(name))
                        .cloned()
                        .ok_or_else(|| error("数据源地址已变化，请重新输入凭据"))?;
                } else {
                    secrets.insert(format!("{}:{name}", source.name), value.clone());
                }
            }
        }
        if !secrets.is_empty() {
            let encrypted = self.protect(app, &secrets).await?;
            if let Some(value) = encrypted.get("deepseek") {
                next.deepseek_key = value.clone();
            }
            for source in &mut next.http_sources {
                for (name, value) in &mut source.headers {
                    if let Some(cipher) = encrypted.get(&format!("{}:{name}", source.name)) {
                        *value = cipher.clone();
                    }
                }
            }
        }
        next.validate()?;
        save_json(&self.root.join("config.json"), &next).await?;
        *self.config.lock().await = next;
        self.cycle.store(0, Ordering::Relaxed);
        self.wake.notify_one();
        let _ = app.emit("hud-config-changed", ());
        Ok(())
    }
    pub async fn read(&self, preview: bool) -> Value {
        if preview {
            self.preview_until.store(
                chrono::Utc::now().timestamp_millis() + 5000,
                Ordering::Relaxed,
            );
            self.wake.notify_one();
        }
        let mut config = self.config.lock().await.public();
        if !preview {
            config.http_sources.clear();
            config.deepseek_key.clear();
        }
        json!({"config":config,"live":self.snapshot.read().await.clone()})
    }
    async fn protect(
        &self,
        app: &tauri::AppHandle,
        values: &BTreeMap<String, String>,
    ) -> Result<BTreeMap<String, String>> {
        let hw = app.state::<hardware::Hardware>();
        let component = hardware::helper(&hw.root).await?;
        let mut command = tokio::process::Command::new(&component.executable);
        crate::services::components::configure_child(&mut command);
        command
            .arg("--hud-protect")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .current_dir(&self.root);
        for name in ["TEMP", "TMP", "APPDATA", "LOCALAPPDATA", "USERPROFILE"] {
            let directory = self.root.join("crypto").join(name);
            check_local_path(&directory).await?;
            tokio::fs::create_dir_all(&directory)
                .await
                .map_err(io_error)?;
            command.env(name, directory);
        }
        #[cfg(windows)]
        command.creation_flags(0x0800_0000);
        let mut child = command.spawn().map_err(io_error)?;
        let mut input = child
            .stdin
            .take()
            .ok_or_else(|| error("HUD 凭据保护通道不可用"))?;
        let mut bytes = serde_json::to_vec(values).map_err(|_| error("凭据结构无效"))?;
        bytes.push(b'\n');
        input.write_all(&bytes).await.map_err(io_error)?;
        bytes.fill(0);
        drop(input);
        let stream = child
            .stdout
            .take()
            .ok_or_else(|| error("HUD 凭据响应不可用"))?;
        let task = async {
            let mut output = vec![];
            stream
                .take(131073)
                .read_to_end(&mut output)
                .await
                .map_err(io_error)?;
            let status = child.wait().await.map_err(io_error)?;
            if !status.success() || output.len() > 131072 {
                return Err(error("当前用户 DPAPI 保护失败"));
            }
            serde_json::from_slice::<BTreeMap<String, String>>(&output)
                .map_err(|_| error("凭据响应格式无效"))
        };
        let protected = tokio::time::timeout(Duration::from_secs(20), task)
            .await
            .map_err(|_| error("凭据保护超时"))??;
        if protected.len() != values.len()
            || values
                .keys()
                .any(|key| !protected.get(key).is_some_and(|v| v.starts_with("dpapi:")))
        {
            return Err(error("凭据保护响应缺失"));
        }
        Ok(protected)
    }
}
