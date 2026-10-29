//! 系统修改采用“预览 → 一次性确认 → 串行执行 → 回执”协议。
//! 前端只能提交领域动作与不透明 ID，无法传入注册表路径、安装命令或脚本文本。
use super::{Result, error, io_error, platform, save_json};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::Mutex;

#[derive(Clone, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum SystemChange {
    Optimization {
        selections: Vec<super::optimizer::Selection>,
    },
    GpuRename {
        id: String,
        name: String,
    },
    GpuRestart {},
    DlssIndicator {
        enabled: bool,
    },
    Virtualization {
        enabled: bool,
    },
    ContextToggle {
        id: String,
        hidden: bool,
    },
    NamespaceToggle {
        id: String,
        hidden: bool,
    },
    DriveVisibility {
        letter: String,
        hidden: bool,
    },
    AppUninstall {
        id: String,
    },
    DiskOptimize {
        id: String,
        drive: String,
        trim: bool,
    },
    VacRepair {},
    AudioDriver {
        install: bool,
    },
    Nvidia {
        scope: String,
        settings: Vec<NvidiaChange>,
    },
    Feature {
        store: u32,
        id: u32,
        priority: u32,
        state: u32,
        variant: u32,
        payload_kind: u32,
        payload: u32,
        reset: bool,
    },
    Restore {
        id: String,
    },
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NvidiaChange {
    pub id: u32,
    pub value: Option<u32>,
}
impl SystemChange {
    pub fn validate(&self) -> Result<()> {
        if let Self::Optimization { selections } = self {
            super::optimizer::validate(selections)?;
        }
        if let Self::Nvidia { scope, settings } = self {
            let definitions: Vec<serde_json::Value> =
                serde_json::from_str(include_str!("windows/nvidia-settings.json"))
                    .map_err(|_| error("驱动配置目录损坏"))?;
            let mut seen = std::collections::HashSet::new();
            if settings.is_empty()
                || settings.len() > 45
                || !["global", "delta"].contains(&scope.as_str())
            {
                return Err(error("驱动配置范围或项目数量无效"));
            }
            for setting in settings {
                if !seen.insert(setting.id)
                    || !definitions.iter().any(|row| {
                        row["scope"].as_str() == Some(scope)
                            && row["id"]
                                .as_str()
                                .and_then(|id| u32::from_str_radix(id, 16).ok())
                                == Some(setting.id)
                    })
                {
                    return Err(error("驱动配置项不在白名单中或重复"));
                }
            }
        }
        if let Self::Feature {
            store,
            id,
            priority,
            state,
            variant,
            payload_kind,
            ..
        } = self
            && (*store > 1
                || *id == 0
                || *priority > 15
                || [0, 1, 3, 9, 15].contains(priority)
                || *state > 2
                || *variant > 63
                || *payload_kind > 3)
        {
            return Err(error("Windows 功能配置参数不合法"));
        }
        let digest =
            |value: &str| value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit());
        let identifier = match self {
            Self::GpuRename { id, .. }
            | Self::ContextToggle { id, .. }
            | Self::NamespaceToggle { id, .. }
            | Self::AppUninstall { id }
            | Self::DiskOptimize { id, .. } => Some(id.as_str()),
            _ => None,
        };
        if identifier.is_some_and(|value| !digest(value)) {
            return Err(error("系统目标标识无效，请刷新列表"));
        }
        if let Self::GpuRename { name, .. } = self
            && (name.trim().is_empty()
                || name.chars().count() > 80
                || name.chars().any(char::is_control))
        {
            return Err(error("显卡名称需为1–80个普通字符"));
        }
        let drive = match self {
            Self::DriveVisibility { letter, .. } => Some(letter),
            Self::DiskOptimize { drive, .. } => Some(drive),
            _ => None,
        };
        if drive.is_some_and(|value| {
            value.len() != 2
                || !value.as_bytes()[0].is_ascii_uppercase()
                || value.as_bytes()[1] != b':'
        }) {
            return Err(error("盘符格式无效"));
        }
        if let Self::Restore { id } = self {
            uuid::Uuid::parse_str(id).map_err(|_| error("备份标识无效"))?;
        }
        Ok(())
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChangePreview {
    pub title: String,
    pub summary: Vec<String>,
    pub requires_admin: bool,
    pub restart_required: bool,
    pub reversible: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub changes: Vec<super::optimizer::RegistryPreview>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedChange {
    pub token: String,
    pub preview: ChangePreview,
    pub expires_in_seconds: u32,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChangeReceipt {
    pub id: String,
    pub title: String,
    pub state: String,
    pub message: String,
    pub restart_required: bool,
    pub reversible: bool,
    pub created_at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub domain: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub item_ids: Vec<String>,
}
struct Lease {
    change: SystemChange,
    preview: ChangePreview,
    created: Instant,
    fingerprint: String,
    user_sid: Option<String>,
    domain: Option<String>,
    valid_for: Duration,
}
pub struct ChangeService {
    root: PathBuf,
    leases: Mutex<HashMap<String, Lease>>,
    serial: Arc<Mutex<()>>,
}
impl ChangeService {
    pub async fn discard(&self, token: &str) -> Result<()> {
        uuid::Uuid::parse_str(token).map_err(|_| error("确认凭据格式无效"))?;
        self.leases.lock().await.remove(token);
        Ok(())
    }
    pub async fn affects_audio(&self, token: &str) -> bool {
        let change = self
            .leases
            .lock()
            .await
            .get(token)
            .map(|lease| lease.change.clone());
        match change {
            Some(SystemChange::AudioDriver { .. }) => true,
            Some(SystemChange::Restore { id }) => {
                tokio::fs::read(self.root.join(format!("{id}.backup.json")))
                    .await
                    .ok()
                    .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
                    .is_some_and(|backup| backup["originalKind"] == "audio-driver")
            }
            _ => false,
        }
    }
    pub fn new(root: &Path) -> Self {
        Self {
            root: root.join("changes"),
            leases: Mutex::new(HashMap::new()),
            serial: Arc::new(Mutex::new(())),
        }
    }
    pub async fn prepare(&self, tools_root: &Path, change: SystemChange) -> Result<PreparedChange> {
        change.validate()?;
        let body = serde_json::to_string(&change).map_err(|_| error("变更参数无效"))?;
        let response = platform::run_system(
            tools_root,
            "preview",
            &[body, self.root.to_string_lossy().into_owned()],
            Duration::from_secs(60),
        )
        .await?;
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Response {
            preview: ChangePreview,
            fingerprint: String,
            user_sid: Option<String>,
            domain: Option<String>,
        }
        let response: Response =
            serde_json::from_value(response).map_err(|_| error("系统变更预览格式不正确"))?;
        let token = uuid::Uuid::new_v4().to_string();
        // 完整优化清单需要充分阅读时间；实际执行仍逐值验证指纹，不依赖时间窗口判断状态。
        let valid_for =
            Duration::from_secs(if response.domain.as_deref() == Some("optimization") {
                600
            } else {
                120
            });
        let mut leases = self.leases.lock().await;
        leases.retain(|_, value| value.created.elapsed() < value.valid_for);
        if leases.len() >= 32 {
            return Err(error("待确认操作过多，请完成当前操作后重试"));
        }
        leases.insert(
            token.clone(),
            Lease {
                change,
                preview: response.preview.clone(),
                created: Instant::now(),
                fingerprint: response.fingerprint,
                user_sid: response.user_sid,
                domain: response.domain,
                valid_for,
            },
        );
        Ok(PreparedChange {
            token,
            preview: response.preview,
            expires_in_seconds: valid_for
                .as_secs()
                .try_into()
                .map_err(|_| error("确认期限无效"))?,
        })
    }
    /// 独立的一次性确认门禁，不触及文件或系统配置，便于验证过期、取消及重复提交。
    async fn take_confirmed(&self, token: &str, consent: bool) -> Result<Lease> {
        if !consent {
            return Err(error("必须逐项阅读并确认系统修改"));
        }
        uuid::Uuid::parse_str(token).map_err(|_| error("确认凭据格式无效"))?;
        let lease = self
            .leases
            .lock()
            .await
            .remove(token)
            .ok_or_else(|| error("确认凭据无效或已使用，请重新生成预览"))?;
        if lease.created.elapsed() > lease.valid_for {
            return Err(error("系统修改确认已过期，请重新检查当前配置"));
        }
        Ok(lease)
    }
    pub async fn apply(
        &self,
        tools_root: &Path,
        token: &str,
        consent: bool,
    ) -> Result<ChangeReceipt> {
        let lease = self.take_confirmed(token, consent).await?;
        let _guard = self.serial.lock().await;
        if lease.created.elapsed() > lease.valid_for {
            return Err(error("等待其他操作期间确认已过期，请重新生成预览"));
        }
        super::check_local_path(&self.root).await?;
        tokio::fs::create_dir_all(&self.root)
            .await
            .map_err(io_error)?;
        let id = uuid::Uuid::new_v4().to_string();
        let task = self.root.join(format!("{id}.request.json"));
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Task<'a> {
            id: &'a str,
            change: &'a SystemChange,
            fingerprint: &'a str,
            title: &'a str,
            root: &'a Path,
            user_sid: &'a Option<String>,
            domain: &'a Option<String>,
        }
        save_json(
            &task,
            &Task {
                id: &id,
                change: &lease.change,
                fingerprint: &lease.fingerprint,
                title: &lease.preview.title,
                root: &self.root,
                user_sid: &lease.user_sid,
                domain: &lease.domain,
            },
        )
        .await?;
        // 持有拒绝共享写入/删除的句柄，UAC 等待期间请求内容也不能被换包。
        let protected = task.clone();
        let (guard, hash) = tauri::async_runtime::spawn_blocking(move || -> Result<_> {
            let mut options = std::fs::OpenOptions::new();
            options.read(true);
            #[cfg(windows)]
            {
                use std::os::windows::fs::OpenOptionsExt;
                options.share_mode(1);
            }
            let file = options.open(&protected).map_err(io_error)?;
            let bytes = std::fs::read(&protected).map_err(io_error)?;
            Ok((file, format!("{:x}", Sha256::digest(bytes))))
        })
        .await
        .map_err(|_| error("无法锁定系统修改请求"))??;
        let result = platform::run_system(
            tools_root,
            "commit",
            &[task.to_string_lossy().into_owned(), hash],
            Duration::from_secs(900),
        )
        .await;
        drop(guard);
        match result {
            Ok(value) => {
                let mut receipt: ChangeReceipt = serde_json::from_value(value)
                    .map_err(|_| error("执行回执无效，请检查操作记录，切勿重复执行"))?;
                if receipt.id != id {
                    return Err(error("执行回执与当前请求不匹配"));
                }
                receipt.domain = lease.domain.clone();
                // UAC 取消也需要落盘，所有结果使用同一历史记录入口。
                save_json(&self.root.join(format!("{id}.receipt.json")), &receipt).await?;
                Ok(receipt)
            }
            Err(cause) => {
                let recoverable = lease.domain.as_deref() == Some("optimization")
                    && lease.preview.reversible
                    && tokio::fs::metadata(self.root.join(format!("{id}.backup.json")))
                        .await
                        .is_ok();
                let item_ids = if let SystemChange::Optimization { selections } = &lease.change {
                    selections
                        .iter()
                        .map(|selection| selection.id.clone())
                        .collect()
                } else {
                    Vec::new()
                };
                let receipt = ChangeReceipt {
                    id: id.clone(),
                    title: lease.preview.title,
                    state: "unknown".into(),
                    message: "系统操作未返回确定结果，请核实实际状态后再操作".into(),
                    restart_required: lease.preview.restart_required,
                    reversible: recoverable,
                    created_at: std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis()
                        .try_into()
                        .unwrap_or(u64::MAX),
                    domain: lease.domain,
                    item_ids,
                };
                save_json(&self.root.join(format!("{id}.receipt.json")), &receipt).await?;
                Err(cause)
            }
        }
    }
    pub async fn history(&self) -> Result<Vec<ChangeReceipt>> {
        let root = self.root.clone();
        tauri::async_runtime::spawn_blocking(move || -> Result<_> {
            super::ensure_local_path(&root)?;
            let mut receipts = Vec::new();
            if !root.exists() {
                return Ok(receipts);
            }
            for entry in std::fs::read_dir(root).map_err(io_error)?.flatten() {
                if entry
                    .file_name()
                    .to_string_lossy()
                    .ends_with(".receipt.json")
                {
                    super::ensure_local_path(&entry.path())?;
                    if let Ok(bytes) = std::fs::read(entry.path())
                        && let Ok(receipt) = serde_json::from_slice::<ChangeReceipt>(&bytes)
                    {
                        receipts.push(receipt);
                    }
                }
            }
            receipts.sort_by_key(|row| std::cmp::Reverse(row.created_at));
            receipts.truncate(200);
            Ok(receipts)
        })
        .await
        .map_err(|_| error("操作记录读取失败"))?
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn confirmation_is_explicit_single_use_expiring_and_discardable() -> Result<()> {
        tauri::async_runtime::block_on(async {
            let service = ChangeService::new(Path::new("D:/新境/.cache/verification/lease-only"));
            let make = || Lease {
                change: SystemChange::GpuRestart {},
                preview: ChangePreview {
                    title: "测试".into(),
                    summary: vec![],
                    requires_admin: true,
                    restart_required: false,
                    reversible: false,
                    changes: vec![],
                },
                created: Instant::now(),
                fingerprint: String::new(),
                user_sid: None,
                domain: None,
                valid_for: Duration::from_secs(120),
            };
            let token = uuid::Uuid::new_v4().to_string();
            service.leases.lock().await.insert(token.clone(), make());
            assert!(service.take_confirmed(&token, false).await.is_err());
            assert!(service.leases.lock().await.contains_key(&token));
            let _lease = service.take_confirmed(&token, true).await?;
            assert!(service.take_confirmed(&token, true).await.is_err());
            service.leases.lock().await.insert(token.clone(), make());
            service.discard(&token).await?;
            assert!(service.take_confirmed(&token, true).await.is_err());
            let mut expired = make();
            expired.created = Instant::now()
                .checked_sub(Duration::from_secs(2))
                .ok_or_else(|| error("测试计时器不可用"))?;
            expired.valid_for = Duration::from_secs(1);
            service.leases.lock().await.insert(token.clone(), expired);
            assert!(service.take_confirmed(&token, true).await.is_err());
            assert!(service.discard("invalid/path").await.is_err());
            Ok(())
        })
    }
    #[test]
    fn rejects_arbitrary_paths_and_unknown_actions() {
        assert!(
            SystemChange::GpuRename {
                id: "C:/Windows".into(),
                name: "test".into()
            }
            .validate()
            .is_err()
        );
        assert!(
            SystemChange::DriveVisibility {
                letter: "C:&whoami".into(),
                hidden: true
            }
            .validate()
            .is_err()
        );
        assert!(
            serde_json::from_value::<SystemChange>(
                serde_json::json!({"kind":"execute","command":"whoami"})
            )
            .is_err()
        );
        assert!(
            serde_json::from_value::<SystemChange>(
                serde_json::json!({"kind":"gpu-restart","command":"whoami"})
            )
            .is_err()
        );
    }
}
