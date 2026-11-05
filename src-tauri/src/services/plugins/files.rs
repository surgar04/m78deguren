//! 文件票据由宿主原生选择器签发。插件只见随机票据和文件名，不接收任意磁盘路径。
use super::{PluginState, model::identifier, storage};
use crate::services::tools::{Result, error, io_error};
use base64::Engine;
use serde::Serialize;
use std::{
    io::{Read, Write},
    path::PathBuf,
    time::{Duration, Instant},
};
use tauri_plugin_dialog::DialogExt;
pub const MAX_FILE: usize = 512 * 1024;
pub struct Grant {
    pub owner: String,
    pub digest: String,
    pub created: Instant,
    pub target: Target,
}
pub enum Target {
    Read(std::fs::File),
    Write(PathBuf),
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ticket {
    pub ticket: String,
    pub name: String,
    pub mode: String,
}
impl PluginState {
    pub async fn pick_file(
        &self,
        app: &tauri::AppHandle,
        id: &str,
        mode: &str,
    ) -> Result<Option<Ticket>> {
        identifier(id)?;
        self.available(id)?;
        let permission = match mode {
            "read" => "file.read",
            "write" => "file.write",
            _ => return Err(error("PLUGIN_FILE_MODE")),
        };
        let record = self
            .registry
            .lock()
            .await
            .records
            .get(id)
            .filter(|r| r.enabled && !r.quarantined && r.grants.iter().any(|p| p == permission))
            .cloned()
            .ok_or_else(|| error("PLUGIN_PERMISSION_DENIED"))?;
        let picker = app.clone();
        Self::verify_channel(&record)?;
        let write = mode == "write";
        let title = format!(
            "臻境插件「{}」：{}（最多 512 KiB）",
            record.manifest.name,
            if write {
                "另存为新文件"
            } else {
                "授权读取单个文件"
            }
        );
        let selected = tauri::async_runtime::spawn_blocking(move || {
            if write {
                picker
                    .dialog()
                    .file()
                    .set_title(&title)
                    .blocking_save_file()
            } else {
                picker
                    .dialog()
                    .file()
                    .set_title(&title)
                    .blocking_pick_file()
            }
        })
        .await
        .map_err(|_| error("PLUGIN_DIALOG"))?;
        let Some(selected) = selected else {
            return Ok(None);
        };
        self.available(id)?;
        if self.registry.lock().await.records.get(id).is_none_or(|r| {
            !r.enabled || r.digest != record.digest || !r.grants.iter().any(|p| p == permission)
        }) {
            return Err(error("PLUGIN_SESSION_REVOKED"));
        }
        let path = selected
            .into_path()
            .map_err(|_| error("PLUGIN_FILE_PATH"))?;
        crate::storage_policy::validate_local_path(
            &path,
            write && crate::storage_policy::restricted_to_d(),
        )
        .map_err(io_error)?;
        let private = self
            .root
            .parent()
            .ok_or_else(|| error("PLUGIN_FILE_PATH"))?
            .to_path_buf();
        let installation = std::env::current_exe()
            .map_err(io_error)?
            .parent()
            .ok_or_else(|| error("PLUGIN_FILE_PATH"))?
            .to_path_buf();
        let (target, name) = tauri::async_runtime::spawn_blocking(move || {
            storage::ordinary_tree(&path)?;
            let parent =
                std::fs::canonicalize(path.parent().ok_or_else(|| error("PLUGIN_FILE_PATH"))?)
                    .map_err(io_error)?;
            let name = path
                .file_name()
                .ok_or_else(|| error("PLUGIN_FILE_PATH"))?
                .to_owned();
            let path = parent.join(&name);
            // 凭据、应用配置、安装组件和开发源码不能通过文件票据绕过插件能力代理。
            let mut protected = vec![private, installation];
            #[cfg(debug_assertions)]
            protected.push(
                std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                    .parent()
                    .ok_or_else(|| error("PLUGIN_FILE_PATH"))?
                    .to_path_buf(),
            );
            let candidate = path.to_string_lossy().replace(r"\\?\", "").to_lowercase();
            for directory in protected {
                let directory = std::fs::canonicalize(directory)
                    .map_err(io_error)?
                    .to_string_lossy()
                    .replace(r"\\?\", "")
                    .to_lowercase();
                if candidate == directory || candidate.starts_with(&(directory + "\\")) {
                    return Err(error(
                        "PLUGIN_FILE_PROTECTED：不能选择应用私有目录、安装组件或开发工作区",
                    ));
                }
            }
            let target = if write {
                if path.exists() {
                    return Err(error(
                        "PLUGIN_FILE_EXISTS：仅允许另存为新文件，不覆盖已有文件",
                    ));
                }
                Target::Write(path)
            } else {
                let mut options = std::fs::OpenOptions::new();
                options.read(true);
                #[cfg(windows)]
                {
                    use std::os::windows::fs::OpenOptionsExt;
                    options.share_mode(1);
                }
                let file = options.open(path).map_err(io_error)?;
                if !file.metadata().map_err(io_error)?.is_file()
                    || file.metadata().map_err(io_error)?.len() > MAX_FILE as u64
                {
                    return Err(error("PLUGIN_FILE_LIMIT：所选文件必须小于 512 KiB"));
                }
                Target::Read(file)
            };
            Ok::<_, crate::error::AppError>((target, name.to_string_lossy().into_owned()))
        })
        .await
        .map_err(|_| error("PLUGIN_FILE_PATH"))??;
        let ticket = uuid::Uuid::new_v4().to_string();
        let mut files = self.files.lock().await;
        // 与 stop 的票据清理使用同一锁：撤权先发生就拒绝签发，签发先发生则由 stop 随后撤销。
        self.available(id)?;
        if self.registry.lock().await.records.get(id).is_none_or(|r| {
            !r.enabled
                || r.quarantined
                || r.digest != record.digest
                || !r.grants.iter().any(|p| p == permission)
        }) {
            return Err(error("PLUGIN_SESSION_REVOKED"));
        }
        files.retain(|_, grant| grant.created.elapsed() < Duration::from_secs(300));
        if files.len() >= 32 {
            return Err(error("PLUGIN_FILE_TICKET_LIMIT"));
        }
        files.insert(
            ticket.clone(),
            Grant {
                owner: id.to_owned(),
                digest: record.digest,
                created: Instant::now(),
                target,
            },
        );
        Ok(Some(Ticket {
            ticket,
            name,
            mode: mode.to_owned(),
        }))
    }
    pub async fn file_call(
        &self,
        id: &str,
        digest: &str,
        method: &str,
        params: serde_json::Value,
    ) -> Result<serde_json::Value> {
        let ticket = params
            .get("ticket")
            .and_then(|v| v.as_str())
            .ok_or_else(|| error("PLUGIN_FILE_TICKET"))?;
        uuid::Uuid::parse_str(ticket).map_err(|_| error("PLUGIN_FILE_TICKET"))?;
        let mut files = self.files.lock().await;
        if !files.get(ticket).is_some_and(|g| {
            g.owner == id && g.digest == digest && g.created.elapsed() < Duration::from_secs(300)
        }) {
            return Err(error("PLUGIN_FILE_TICKET_EXPIRED"));
        }
        let grant = files
            .remove(ticket)
            .ok_or_else(|| error("PLUGIN_FILE_TICKET_EXPIRED"))?;
        drop(files);
        // 一次性票据在 I/O 前消耗，即使调用失败也不能反复重放写入。
        let method = method.to_owned();
        self.data_io(move || match (method.as_str(), grant.target) {
            ("file.read", Target::Read(mut file)) => {
                let mut bytes = Vec::new();
                Read::by_ref(&mut file)
                    .take((MAX_FILE + 1) as u64)
                    .read_to_end(&mut bytes)
                    .map_err(io_error)?;
                if bytes.len() > MAX_FILE {
                    return Err(error("PLUGIN_FILE_LIMIT"));
                }
                Ok(serde_json::Value::String(
                    base64::engine::general_purpose::STANDARD.encode(bytes),
                ))
            }
            ("file.write", Target::Write(path)) => {
                let encoded = params
                    .get("base64")
                    .and_then(|v| v.as_str())
                    .filter(|s| s.len() <= MAX_FILE * 2)
                    .ok_or_else(|| error("PLUGIN_FILE_DATA"))?;
                let bytes = base64::engine::general_purpose::STANDARD
                    .decode(encoded)
                    .map_err(|_| error("PLUGIN_FILE_DATA"))?;
                if bytes.len() > MAX_FILE {
                    return Err(error("PLUGIN_FILE_LIMIT"));
                }
                storage::ordinary_tree(&path)?;
                let mut output = tempfile::NamedTempFile::new_in(
                    path.parent().ok_or_else(|| error("PLUGIN_FILE_PATH"))?,
                )
                .map_err(io_error)?;
                output.write_all(&bytes).map_err(io_error)?;
                output.as_file().sync_all().map_err(io_error)?;
                output
                    .persist_noclobber(path)
                    .map_err(|e| io_error(e.error))?;
                Ok(serde_json::Value::Null)
            }
            _ => Err(error("PLUGIN_FILE_MODE")),
        })
        .await
    }
}
