//! 插件管理唯一状态源。包与授权事务在操作锁内提交，运行调用不持有此锁，允许随时撤销。
pub mod dues;
mod files;
mod isolation;
pub mod model;
mod network;
pub mod package;
pub mod runtime;
pub mod storage;
#[cfg(test)]
mod tests;
mod transaction;

use crate::services::tools::{Result, error, io_error};
use model::{MAX_PACKAGE, Manifest, Record, Registry, identifier};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager};
use tokio::sync::{Mutex, watch};
use tokio_util::sync::CancellationToken;

/// 只在修改版本/授权期间阻止该插件新调用；RAII 保证任意错误路径都会解除临时标记。
struct Mutation<'a> {
    set: &'a std::sync::Mutex<std::collections::BTreeSet<String>>,
    id: String,
}
impl Drop for Mutation<'_> {
    fn drop(&mut self) {
        if let Ok(mut set) = self.set.lock() {
            set.remove(&self.id);
        }
    }
}

struct Pending {
    bytes: Vec<u8>,
    created: Instant,
    allow_unsigned: bool,
    previous_digest: Option<String>,
}
struct Starting {
    cancellation: CancellationToken,
    completion: watch::Receiver<()>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    ticket: String,
    manifest: Manifest,
    publisher_key: Option<String>,
    digest: String,
    previous: Option<String>,
    added_permissions: Vec<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    #[serde(flatten)]
    record: Record,
    running: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    revision: u64,
    safe_mode: bool,
    runtime_available: bool,
    notice: Option<String>,
    items: Vec<Item>,
    native_extensions: bool,
    builtins: Vec<Builtin>,
}
/// 第一方内置模块显式区别于独立 Wasm 包，不能伪装发布者签名或宣称沙箱执行。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Builtin {
    id: &'static str,
    name: &'static str,
    description: &'static str,
    version: &'static str,
}
pub struct PluginState {
    dues: dues::State,
    root: PathBuf,
    registry: Mutex<Registry>,
    operation: Mutex<()>,
    pending: Mutex<BTreeMap<String, Pending>>,
    sessions: Mutex<BTreeMap<String, Arc<runtime::Session>>>,
    starting: Mutex<BTreeMap<String, Starting>>,
    mutating: std::sync::Mutex<std::collections::BTreeSet<String>>,
    safe: std::sync::atomic::AtomicBool,
    rate: Mutex<BTreeMap<String, (Instant, u32)>>,
    files: Mutex<BTreeMap<String, files::Grant>>,
    data_gate: Arc<Mutex<()>>,
    task_runs: Mutex<BTreeMap<String, Instant>>,
    network: network::Network,
    process_group: Option<isolation::ProcessGroup>,
    notice: Option<String>,
    write_blocked: bool,
    pub shutdown: CancellationToken,
}
fn encode<T: Serialize>(value: &T) -> Result<Vec<u8>> {
    serde_json::to_vec(value).map_err(|_| error("PLUGIN_ENCODING"))
}
impl PluginState {
    /// 开发者状态可能在安装后失效；每个执行/授权边界都重新检查，不能把安装时的认证永久缓存。
    fn verify_channel(record: &Record) -> Result<()> {
        if record.publisher_key.is_none()
            && !(cfg!(debug_assertions) || crate::services::developer::enabled())
        {
            return Err(error(
                "PLUGIN_DEVELOPER_REQUIRED：未签名插件需要有效开发者身份",
            ));
        }
        Ok(())
    }
    pub fn new(data_root: &Path) -> Result<Self> {
        let root = data_root.join("plugins");
        crate::storage_policy::validate_data_root(data_root).map_err(io_error)?;
        storage::ordinary_tree(&root)?;
        std::fs::create_dir_all(root.join("packages")).map_err(io_error)?;
        let path = root.join("registry.json");
        let mut notice = None;
        let mut write_blocked = false;
        let mut registry = if path.exists() {
            match storage::read_bounded(&path, 2 * 1024 * 1024).and_then(|bytes| {
                serde_json::from_slice::<Registry>(&bytes)
                    .map_err(|_| error("PLUGIN_REGISTRY_CORRUPT"))
            }) {
                Ok(value)
                    if value.records.len() <= 128
                        && value.records.iter().all(|(id, r)| {
                            id == &r.manifest.id
                                && r.manifest.validate().is_ok()
                                && package::hex::<32>(&r.digest).is_ok()
                        }) =>
                {
                    value
                }
                _ => {
                    // 插件索引损坏不能阻止主程序启动；原文件保留，用户仍可从插件中心进入安全恢复。
                    notice =
                        Some("插件索引损坏，已进入安全模式；原索引保留在插件数据目录。".to_owned());
                    let backup =
                        root.join(format!("registry-corrupt-{}.json", uuid::Uuid::new_v4()));
                    write_blocked = std::fs::rename(&path, backup).is_err();
                    Registry {
                        safe_mode: true,
                        ..Registry::default()
                    }
                }
            }
        } else {
            Registry::default()
        };
        if transaction::recover(&root, &registry).is_err() {
            registry.safe_mode = true;
            notice =
                Some("插件数据事务需要人工恢复，已阻止插件运行；备份和事务日志已保留。".to_owned());
        }
        registry.safe_mode |= root.join("safe-mode").exists();
        let process_group = isolation::ProcessGroup::new().ok();
        if process_group.is_none() {
            registry.safe_mode = true;
            notice.get_or_insert_with(|| {
                "插件进程回收保护不可用，已进入安全模式；请重启或修复应用。".to_owned()
            });
        }
        let safe = std::sync::atomic::AtomicBool::new(registry.safe_mode);
        Ok(Self {
            dues: dues::State::new(&root),
            root,
            registry: Mutex::new(registry),
            operation: Mutex::new(()),
            pending: Mutex::new(BTreeMap::new()),
            sessions: Mutex::new(BTreeMap::new()),
            starting: Mutex::new(BTreeMap::new()),
            mutating: std::sync::Mutex::new(std::collections::BTreeSet::new()),
            safe,
            files: Mutex::new(BTreeMap::new()),
            rate: Mutex::new(BTreeMap::new()),
            data_gate: Arc::new(Mutex::new(())),
            task_runs: Mutex::new(BTreeMap::new()),
            network: network::Network::default(),
            process_group,
            notice,
            write_blocked,
            shutdown: CancellationToken::new(),
        })
    }
    fn mutation(&self, id: &str) -> Result<Mutation<'_>> {
        let mut set = self.mutating.lock().map_err(|_| error("PLUGIN_STATE"))?;
        if !set.insert(id.to_owned()) {
            return Err(error("PLUGIN_BUSY：插件正在变更"));
        }
        Ok(Mutation {
            set: &self.mutating,
            id: id.to_owned(),
        })
    }
    fn available(&self, id: &str) -> Result<()> {
        if self.safe.load(std::sync::atomic::Ordering::Acquire) {
            return Err(error("PLUGIN_SAFE_MODE"));
        }
        if self
            .mutating
            .lock()
            .map_err(|_| error("PLUGIN_STATE"))?
            .contains(id)
        {
            return Err(error("PLUGIN_BUSY：插件正在变更"));
        }
        Ok(())
    }
    async fn limit(&self, key: String, maximum: u32) -> Result<()> {
        let mut rate = self.rate.lock().await;
        rate.retain(|_, (at, _)| at.elapsed() < Duration::from_secs(60));
        let entry = rate.entry(key).or_insert((Instant::now(), 0));
        if entry.1 >= maximum {
            return Err(error("PLUGIN_RATE_LIMIT"));
        }
        entry.1 += 1;
        Ok(())
    }
    fn archive(&self, id: &str, digest: &str) -> Result<PathBuf> {
        identifier(id)?;
        package::hex::<32>(digest)?;
        Ok(self
            .root
            .join("packages")
            .join(id)
            .join(format!("{digest}.zjplug")))
    }
    async fn commit(&self, mut candidate: Registry) -> Result<()> {
        if self.write_blocked {
            return Err(error(
                "PLUGIN_REGISTRY_READ_ONLY：旧索引未能安全归档，已阻止覆盖",
            ));
        }
        candidate.revision = candidate
            .revision
            .checked_add(1)
            .ok_or_else(|| error("PLUGIN_REVISION"))?;
        let path = self.root.join("registry.json");
        let bytes = encode(&candidate)?;
        if bytes.len() > 2 * 1024 * 1024 {
            return Err(error("PLUGIN_REGISTRY_QUOTA：插件索引超过容量上限"));
        }
        tauri::async_runtime::spawn_blocking(move || storage::atomic_write(&path, &bytes))
            .await
            .map_err(|_| error("PLUGIN_STORAGE"))??;
        *self.registry.lock().await = candidate;
        Ok(())
    }
    pub async fn snapshot(&self) -> Snapshot {
        let runtime_available = self.process_group.is_some()
            && tauri::async_runtime::spawn_blocking(|| runtime::host_path().is_ok())
                .await
                .unwrap_or(false);
        let registry = self.registry.lock().await.clone();
        let mut sessions = self.sessions.lock().await;
        sessions.retain(|_, session| session.is_alive());
        Snapshot {
            revision: registry.revision,
            safe_mode: self.safe.load(std::sync::atomic::Ordering::Acquire),
            runtime_available,
            notice: self.notice.clone(),
            native_extensions: false,
            builtins: if dues::visible() {
                vec![Builtin {
                    id: dues::ID,
                    name: "群会费智能表格",
                    description: "同步群成员，管理月费与年费，按月筛选和统计缴纳情况。",
                    version: "1.0.0",
                }]
            } else {
                Vec::new()
            },
            items: registry
                .records
                .into_values()
                .map(|record| Item {
                    running: sessions
                        .get(&record.manifest.id)
                        .is_some_and(|s| !s.cancellation.is_cancelled()),
                    record,
                })
                .collect(),
        }
    }
    pub async fn builtin_dues(&self, request: dues::Request) -> Result<Value> {
        dues::require_developer()?;
        self.available(dues::ID)?;
        self.limit("builtin-dues".to_owned(), 600).await?;
        let result = self.dues.execute(request).await?;
        // 包括头像缓存命中在内，异步等待结束后再次复核认证，避免过期会话取得延迟响应。
        dues::require_developer()?;
        self.available(dues::ID)?;
        Ok(result)
    }
    pub async fn preview(&self, bytes: Vec<u8>, allow_unsigned: bool) -> Result<Preview> {
        if bytes.len() > MAX_PACKAGE {
            return Err(error("PLUGIN_PACKAGE_LIMIT"));
        }
        let (manifest, key, digest) = tauri::async_runtime::spawn_blocking({
            let bytes = bytes.clone();
            move || {
                let package = package::read(&bytes, allow_unsigned)?;
                Ok::<_, crate::error::AppError>((
                    package.manifest,
                    package.publisher_key,
                    package.digest,
                ))
            }
        })
        .await
        .map_err(|_| error("PLUGIN_PACKAGE"))??;
        let registry = self.registry.lock().await;
        let old = registry.records.get(&manifest.id);
        if registry
            .publishers
            .get(&manifest.id)
            .is_some_and(|saved| saved != &key)
        {
            return Err(error(
                "PLUGIN_PUBLISHER_CHANGED：该插件 ID 已绑定其他发布者",
            ));
        }
        if let Some(old) = old {
            if old.publisher_key != key {
                return Err(error(
                    "PLUGIN_PUBLISHER_CHANGED：更新发布者与已安装版本不同",
                ));
            }
            if semver::Version::parse(&manifest.version).ok()
                <= semver::Version::parse(&old.manifest.version).ok()
            {
                return Err(error(
                    "PLUGIN_VERSION：安装更新必须使用更高版本，回退请使用专用入口",
                ));
            }
        }
        let added_permissions = manifest
            .permissions
            .iter()
            .filter(|p| {
                old.is_none_or(|o| {
                    !o.manifest
                        .permissions
                        .iter()
                        .any(|v| v.id == p.id && v.origins == p.origins)
                })
            })
            .map(|p| p.id.clone())
            .collect();
        let previous = old.map(|o| o.manifest.version.clone());
        let previous_digest = old.map(|o| o.digest.clone());
        drop(registry);
        let ticket = uuid::Uuid::new_v4().to_string();
        let mut pending = self.pending.lock().await;
        pending.retain(|_, v| v.created.elapsed() < Duration::from_secs(600));
        if pending.len() >= 2 {
            return Err(error("PLUGIN_PENDING_LIMIT：请先完成或取消已有安装预览"));
        }
        pending.insert(
            ticket.clone(),
            Pending {
                bytes,
                created: Instant::now(),
                allow_unsigned,
                previous_digest,
            },
        );
        Ok(Preview {
            ticket,
            manifest,
            publisher_key: key,
            digest,
            previous,
            added_permissions,
        })
    }
    pub async fn cancel_preview(&self, ticket: &str) {
        self.pending.lock().await.remove(ticket);
    }
    pub async fn install<R: tauri::Runtime>(
        &self,
        app: &tauri::AppHandle<R>,
        ticket: &str,
        grants: Vec<String>,
        revision: u64,
        consent: bool,
    ) -> Result<()> {
        if !consent {
            return Err(error("PLUGIN_CONSENT_REQUIRED"));
        }
        let _operation = self.operation.lock().await;
        let mut registry = self.registry.lock().await.clone();
        if registry.revision != revision {
            return Err(error("PLUGIN_CONFLICT：插件列表已变化，请重新预览"));
        }
        let pending = self
            .pending
            .lock()
            .await
            .remove(ticket)
            .ok_or_else(|| error("PLUGIN_TICKET_EXPIRED"))?;
        if pending.created.elapsed() > Duration::from_secs(600) {
            return Err(error("PLUGIN_TICKET_EXPIRED"));
        }
        if pending.allow_unsigned
            && !(cfg!(debug_assertions) || crate::services::developer::enabled())
        {
            return Err(error("PLUGIN_DEVELOPER_REQUIRED"));
        }
        let bytes = pending.bytes;
        let mut package = tauri::async_runtime::spawn_blocking({
            let bytes = bytes.clone();
            move || package::read(&bytes, pending.allow_unsigned)
        })
        .await
        .map_err(|_| error("PLUGIN_PACKAGE"))??;
        Self::validate_grants(&package.manifest, &grants)?;
        let id = package.manifest.id.clone();
        let old = registry.records.get(&id).cloned();
        if old.as_ref().map(|r| &r.digest) != pending.previous_digest.as_ref() {
            return Err(error(
                "PLUGIN_CONFLICT：预览后插件版本已变化，请重新选择安装包",
            ));
        }
        if old.as_ref().is_some_and(|r| {
            semver::Version::parse(&package.manifest.version).ok()
                <= semver::Version::parse(&r.manifest.version).ok()
        }) {
            return Err(error("PLUGIN_VERSION"));
        }
        let _mutation = self.mutation(&id)?;
        if registry
            .publishers
            .get(&id)
            .is_some_and(|saved| saved != &package.publisher_key)
        {
            return Err(error("PLUGIN_PUBLISHER_CHANGED"));
        }
        if registry.records.len() >= 128 && old.is_none() {
            return Err(error("PLUGIN_INSTALL_LIMIT"));
        }
        if old
            .as_ref()
            .is_some_and(|old| old.publisher_key != package.publisher_key)
        {
            return Err(error("PLUGIN_PUBLISHER_CHANGED"));
        }
        let from = registry
            .data_versions
            .get(&id)
            .copied()
            .or_else(|| old.as_ref().map(|r| r.manifest.data_version));
        if from.is_some_and(|v| v > package.manifest.data_version) {
            return Err(error(
                "PLUGIN_DATA_DOWNGRADE：降低数据版本必须使用带备份的回退入口",
            ));
        }
        self.stop(&id).await;
        let path = self.archive(&id, &package.digest)?;
        tauri::async_runtime::spawn_blocking(move || storage::atomic_write(&path, &bytes))
            .await
            .map_err(|_| error("PLUGIN_STORAGE"))??;
        let next = Record {
            manifest: package.manifest,
            digest: package.digest,
            publisher_key: package.publisher_key,
            grants,
            enabled: false,
            quarantined: false,
            failures: 0,
            previous: old.as_ref().map(|v| v.digest.clone()),
        };
        let active = self.root.join("data").join(&id);
        let had_data = tokio::fs::try_exists(&active).await.map_err(io_error)?;
        if (old.is_some() || had_data)
            && from.is_some_and(|version| version != next.manifest.data_version)
            && self.safe.load(std::sync::atomic::Ordering::Acquire)
        {
            return Err(error(
                "PLUGIN_SAFE_MODE：数据升级需要运行迁移代码，请先明确关闭安全模式",
            ));
        }
        if old.is_some() || had_data {
            let root = self.root.clone();
            let plugin_id = id.clone();
            let source = active.clone();
            let working = self
                .data_io(move || transaction::prepare(&root, &plugin_id, &source))
                .await?;
            if from.is_some_and(|version| version != next.manifest.data_version) {
                let component = package
                    .files
                    .remove(&next.manifest.entry)
                    .ok_or_else(|| error("PLUGIN_COMPONENT"))?;
                let migration = async {
                    let session = runtime::Session::start(
                        &self.root,
                        &next,
                        component,
                        self.shutdown.child_token(),
                        self.process_group
                            .as_ref()
                            .ok_or_else(|| error("PLUGIN_PROCESS_GUARD"))?,
                    )
                    .await?;
                    let result = session
                        .invoke(
                            self,
                            app,
                            &next,
                            "migrate",
                            json!({"from":from,"to":next.manifest.data_version}),
                            Some(&working),
                        )
                        .await;
                    session.stop().await;
                    if result?["dataVersion"].as_u64()
                        != Some(u64::from(next.manifest.data_version))
                    {
                        return Err(error("PLUGIN_MIGRATION：迁移未确认目标数据版本"));
                    }
                    Ok(())
                }
                .await;
                if let Err(cause) = migration {
                    let root = self.root.clone();
                    let id = id.clone();
                    let _ = self.data_io(move || transaction::discard(&root, &id)).await;
                    return Err(cause);
                }
            }
            let journal = transaction::Journal {
                id: id.clone(),
                old_digest: old
                    .as_ref()
                    .map(|r| r.digest.clone())
                    .unwrap_or_else(|| "0".repeat(64)),
                new_digest: next.digest.clone(),
                had_data,
            };
            self.switch_data(journal).await?;
        }
        registry
            .publishers
            .insert(id.clone(), next.publisher_key.clone());
        registry
            .data_versions
            .insert(id.clone(), next.manifest.data_version);
        registry.records.insert(id.clone(), next);
        let committed = self.commit(registry).await;
        // 无论提交成功与否，都按磁盘索引恢复数据；不能出现旧代码读取新格式数据。
        self.recover_data().await?;
        committed?;
        self.prune(&id).await
    }
    fn validate_grants(manifest: &Manifest, grants: &[String]) -> Result<()> {
        let unique: std::collections::BTreeSet<_> = grants.iter().collect();
        if unique.len() != grants.len()
            || grants.len() > 16
            || grants
                .iter()
                .any(|id| !manifest.permissions.iter().any(|p| &p.id == id))
            || manifest
                .permissions
                .iter()
                .any(|p| !p.optional && !grants.contains(&p.id))
        {
            return Err(error("PLUGIN_PERMISSION：必需权限未授权或包含未知权限"));
        }
        Ok(())
    }
    pub async fn configure(
        &self,
        id: &str,
        enabled: bool,
        grants: Vec<String>,
        revision: u64,
        consent: bool,
        digest: &str,
    ) -> Result<()> {
        identifier(id)?;
        if enabled && !consent {
            return Err(error("PLUGIN_CONSENT_REQUIRED"));
        }
        if grants.len() > 16
            || grants
                .iter()
                .collect::<std::collections::BTreeSet<_>>()
                .len()
                != grants.len()
        {
            return Err(error("PLUGIN_PERMISSION"));
        }
        let _mutation = self.mutation(id)?;
        self.stop(id).await;
        let _operation = self.operation.lock().await;
        let mut registry = self.registry.lock().await.clone();
        if registry.revision != revision {
            return Err(error("PLUGIN_CONFLICT"));
        }
        if enabled && self.safe.load(std::sync::atomic::Ordering::Acquire) {
            return Err(error("PLUGIN_SAFE_MODE"));
        }
        let record = registry
            .records
            .get_mut(id)
            .ok_or_else(|| error("PLUGIN_NOT_FOUND"))?;
        // 用户复核的是某个确定包的权限与理由，不能把旧弹窗的同名权限授予后来安装的新包。
        if record.digest != digest {
            return Err(error("PLUGIN_CONFLICT：复核的插件版本已变化"));
        }
        // 禁用/撤销不要求继续保留必需权限；重新启用时必须再次满足完整声明。
        if enabled {
            Self::verify_channel(record)?;
            Self::validate_grants(&record.manifest, &grants)?;
        } else if grants
            .iter()
            .any(|id| !record.manifest.permissions.iter().any(|p| &p.id == id))
        {
            return Err(error("PLUGIN_PERMISSION"));
        }
        record.enabled = enabled;
        record.grants = grants;
        record.quarantined = false;
        record.failures = 0;
        self.commit(registry).await?;
        self.stop(id).await;
        Ok(())
    }
    pub async fn stop(&self, id: &str) {
        self.files.lock().await.retain(|_, grant| grant.owner != id);
        if let Some(starting) = self.starting.lock().await.get(id) {
            starting.cancellation.cancel();
        }
        if let Some(session) = self.sessions.lock().await.remove(id) {
            session.stop().await;
        }
        // spawn_blocking 不可强行取消；等待其持有的真实 I/O 锁释放，再允许版本/数据切换。
        let _drained = self.data_gate.lock().await;
    }
    async fn session(&self, record: &Record) -> Result<Arc<runtime::Session>> {
        let id = &record.manifest.id;
        // 启动票据只在短临界区登记；编译组件时不占住全部插件的列表锁与停止入口。
        let mut starting = self.starting.lock().await;
        self.available(id)?;
        let mut sessions = self.sessions.lock().await;
        sessions.retain(|_, session| session.is_alive());
        if let Some(session) = sessions
            .get(id)
            .filter(|s| s.digest == record.digest && !s.cancellation.is_cancelled())
        {
            return Ok(session.clone());
        }
        // RPC Future 意外取消时发送端会销毁；清理遗留启动条目，后续请求仍可重新启动。
        if starting
            .get(id)
            .is_some_and(|active| active.completion.has_changed().is_err())
        {
            starting.remove(id);
        }
        if let Some(active) = starting.get(id) {
            let cancellation = active.cancellation.clone();
            let mut completion = active.completion.clone();
            drop(sessions);
            drop(starting);
            // watch 在发送端销毁时也会唤醒，任何错误/取消路径都不会遗失通知；等待者不重复计入启动故障。
            tokio::select! {_ = cancellation.cancelled()=>return Err(error("PLUGIN_CANCELLED")),_ = tokio::time::timeout(Duration::from_secs(65),completion.changed())=>{}}
            self.available(id)?;
            return self
                .sessions
                .lock()
                .await
                .get(id)
                .filter(|s| s.digest == record.digest && !s.cancellation.is_cancelled())
                .cloned()
                .ok_or_else(|| {
                    error("PLUGIN_START_SHARED_FAILURE：同一次插件启动失败，请检查首个错误")
                });
        }
        sessions.remove(id);
        if sessions.len() + starting.len() >= 8 {
            return Err(error("PLUGIN_ACTIVE_LIMIT"));
        }
        let cancellation = self.shutdown.child_token();
        let (_completion, completion) = watch::channel(());
        starting.insert(
            id.clone(),
            Starting {
                cancellation: cancellation.clone(),
                completion,
            },
        );
        drop(sessions);
        drop(starting);
        let result = async {
            let mut package = self.load(record).await?;
            if encode(&package.manifest)? != encode(&record.manifest)? {
                return Err(error("PLUGIN_MANIFEST_INTEGRITY：索引清单与已签名包不一致"));
            }
            let component = package
                .files
                .remove(&record.manifest.entry)
                .ok_or_else(|| error("PLUGIN_COMPONENT"))?;
            runtime::Session::start(
                &self.root,
                record,
                component,
                cancellation.clone(),
                self.process_group
                    .as_ref()
                    .ok_or_else(|| error("PLUGIN_PROCESS_GUARD"))?,
            )
            .await
        }
        .await;
        let mut starting = self.starting.lock().await;
        starting.remove(id);
        match result {
            Ok(session) if !cancellation.is_cancelled() && self.available(id).is_ok() => {
                let current = self.registry.lock().await.records.get(id).cloned();
                if current.is_none_or(|r| {
                    !r.enabled
                        || r.quarantined
                        || r.digest != record.digest
                        || r.grants != record.grants
                }) {
                    drop(starting);
                    session.stop().await;
                    return Err(error("PLUGIN_CANCELLED"));
                }
                self.sessions
                    .lock()
                    .await
                    .insert(id.clone(), session.clone());
                Ok(session)
            }
            Ok(session) => {
                drop(starting);
                session.stop().await;
                Err(error("PLUGIN_CANCELLED"))
            }
            Err(cause) => Err(cause),
        }
    }
    async fn outcome(&self, record: &Record, failed: bool) -> Result<()> {
        let _operation = self.operation.lock().await;
        let mut registry = self.registry.lock().await.clone();
        if let Some(current) = registry
            .records
            .get_mut(&record.manifest.id)
            .filter(|r| r.digest == record.digest && r.enabled)
        {
            if failed {
                current.failures = current.failures.saturating_add(1);
                current.quarantined = current.failures >= 3;
            } else if current.failures > 0 {
                current.failures = 0;
            } else {
                return Ok(());
            }
        } else {
            return Ok(());
        }
        self.commit(registry).await
    }
    /// 锁归属于实际阻塞任务，调用 Future 被取消也不会提前释放，避免旧写入穿越迁移边界。
    async fn data_io<T: Send + 'static>(
        &self,
        work: impl FnOnce() -> Result<T> + Send + 'static,
    ) -> Result<T> {
        let guard = self.data_gate.clone().lock_owned().await;
        tauri::async_runtime::spawn_blocking(move || {
            let _guard = guard;
            work()
        })
        .await
        .map_err(|_| error("PLUGIN_STORAGE"))?
    }
    async fn recover_data(&self) -> Result<()> {
        let root = self.root.clone();
        let registry = self.registry.lock().await.clone();
        let result = self
            .data_io(move || transaction::recover(&root, &registry))
            .await;
        if result.is_err() {
            // 恢复失败时立即拒绝全部调用；即使索引无法写入，也以独立标记维持重启后的安全模式。
            self.safe.store(true, std::sync::atomic::Ordering::Release);
            let path = self.root.join("safe-mode");
            let _ = self
                .data_io(move || storage::atomic_write(&path, b"1"))
                .await;
            for token in self.starting.lock().await.values() {
                token.cancellation.cancel();
            }
            self.files.lock().await.clear();
            let sessions = std::mem::take(&mut *self.sessions.lock().await);
            for session in sessions.into_values() {
                session.stop().await;
            }
        }
        result
    }
    async fn switch_data(&self, journal: transaction::Journal) -> Result<()> {
        let root = self.root.clone();
        let result = self
            .data_io(move || transaction::switch(&root, &journal))
            .await;
        if let Err(cause) = result {
            self.recover_data().await?;
            return Err(cause);
        }
        Ok(())
    }
    pub async fn safe_mode(&self, enabled: bool, consent: bool) -> Result<()> {
        if !consent {
            return Err(error("PLUGIN_CONSENT_REQUIRED"));
        }
        if !enabled {
            self.recover_data().await?;
        }
        let path = self.root.join("safe-mode");
        if enabled {
            let path = path.clone();
            tauri::async_runtime::spawn_blocking(move || storage::atomic_write(&path, b"1"))
                .await
                .map_err(|_| error("PLUGIN_STORAGE"))??;
        }
        if enabled {
            self.safe.store(true, std::sync::atomic::Ordering::Release);
        }
        let _operation = self.operation.lock().await;
        let mut registry = self.registry.lock().await.clone();
        registry.safe_mode = enabled;
        if enabled {
            self.files.lock().await.clear();
            for (_, starting) in self.starting.lock().await.iter() {
                starting.cancellation.cancel();
            }
            let sessions = std::mem::take(&mut *self.sessions.lock().await);
            for (_, session) in sessions {
                session.stop().await;
            }
            let _drained = self.data_gate.lock().await;
        }
        self.commit(registry).await?;
        if !enabled {
            self.data_io(move || {
                storage::ordinary_tree(&path)?;
                if path.exists() {
                    std::fs::remove_file(path).map_err(io_error)?;
                }
                Ok(())
            })
            .await?;
        }
        self.safe
            .store(enabled, std::sync::atomic::Ordering::Release);
        Ok(())
    }
    pub async fn uninstall(
        &self,
        id: &str,
        purge: bool,
        revision: u64,
        consent: bool,
    ) -> Result<()> {
        identifier(id)?;
        if !consent {
            return Err(error("PLUGIN_CONSENT_REQUIRED"));
        }
        let _mutation = self.mutation(id)?;
        self.stop(id).await;
        let _operation = self.operation.lock().await;
        let mut registry = self.registry.lock().await.clone();
        if registry.revision != revision {
            return Err(error("PLUGIN_CONFLICT"));
        }
        let record = registry
            .records
            .get_mut(id)
            .ok_or_else(|| error("PLUGIN_NOT_FOUND"))?;
        // 先持久化撤权。删除数据失败时仍保留可重试的禁用记录，不会恢复运行半清理的数据。
        record.enabled = false;
        record.grants.clear();
        let data_version = record.manifest.data_version;
        if !purge {
            registry
                .data_versions
                .entry(id.to_owned())
                .or_insert(data_version);
        }
        self.commit(registry).await?;
        {
            let mut paths = vec![self.root.join("packages").join(id)];
            if purge {
                paths.extend([
                    self.root.join("data").join(id),
                    self.root.join("backups").join(id),
                ]);
            }
            self.data_io(move || {
                for path in paths {
                    storage::ordinary_tree(&path)?;
                    if path.exists() {
                        std::fs::remove_dir_all(path).map_err(io_error)?;
                    }
                }
                Ok::<_, crate::error::AppError>(())
            })
            .await?;
        }
        let mut registry = self.registry.lock().await.clone();
        registry.records.remove(id);
        if purge {
            registry.data_versions.remove(id);
        }
        // 发布者绑定单独保留，重新安装不能由同名的新发布者接管旧数据。
        self.commit(registry).await?;
        Ok(())
    }
    /// 仅保留当前及上一版的包与备份；先完成事务再回收，绝不清理待恢复目录。
    async fn prune(&self, id: &str) -> Result<()> {
        identifier(id)?;
        let record = self.registry.lock().await.records.get(id).cloned();
        let retained = record
            .into_iter()
            .flat_map(|r| std::iter::once(r.digest).chain(r.previous))
            .collect::<std::collections::BTreeSet<_>>();
        let root = self.root.clone();
        let id = id.to_owned();
        tauri::async_runtime::spawn_blocking(move || {
            if root.join("transactions").join(&id).exists() {
                return Ok(());
            }
            for (directory, archives) in [
                (root.join("packages").join(&id), true),
                (root.join("backups").join(&id), false),
            ] {
                storage::ordinary_tree(&directory)?;
                if !directory.exists() {
                    continue;
                }
                for entry in std::fs::read_dir(&directory).map_err(io_error)? {
                    let entry = entry.map_err(io_error)?;
                    let path = entry.path();
                    storage::ordinary_tree(&path)?;
                    let name = entry.file_name();
                    let name = name.to_str().ok_or_else(|| error("PLUGIN_PATH"))?;
                    let digest = if archives {
                        name.strip_suffix(".zjplug")
                            .ok_or_else(|| error("PLUGIN_PATH"))?
                    } else {
                        name
                    };
                    package::hex::<32>(digest)?;
                    // 重新安装并迁移保留数据时没有上一版代码，零摘要目录仍保存迁移前原数据。
                    let emergency_data = !archives && digest.bytes().all(|byte| byte == b'0');
                    if !retained.contains(digest) && !emergency_data {
                        if archives {
                            std::fs::remove_file(path).map_err(io_error)?;
                        } else {
                            std::fs::remove_dir_all(path).map_err(io_error)?;
                        }
                    }
                }
            }
            Ok(())
        })
        .await
        .map_err(|_| error("PLUGIN_STORAGE"))?
    }
    async fn load(&self, record: &Record) -> Result<package::Package> {
        let path = self.archive(&record.manifest.id, &record.digest)?;
        let expected = record.digest.clone();
        let key = record.publisher_key.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let bytes = storage::read_bounded(&path, MAX_PACKAGE)?;
            if package::digest(&bytes) != expected {
                return Err(error("PLUGIN_INTEGRITY"));
            }
            let package = package::read(
                &bytes,
                key.is_none() && (cfg!(debug_assertions) || crate::services::developer::enabled()),
            )?;
            if package.publisher_key != key {
                return Err(error("PLUGIN_PUBLISHER_CHANGED"));
            }
            Ok(package)
        })
        .await
        .map_err(|_| error("PLUGIN_PACKAGE"))?
    }
    pub async fn rollback(&self, id: &str, revision: u64, consent: bool) -> Result<()> {
        identifier(id)?;
        if !consent {
            return Err(error("PLUGIN_CONSENT_REQUIRED"));
        }
        self.stop(id).await;
        let _mutation = self.mutation(id)?;
        let _operation = self.operation.lock().await;
        let mut registry = self.registry.lock().await.clone();
        if registry.revision != revision {
            return Err(error("PLUGIN_CONFLICT"));
        }
        let current = registry
            .records
            .get(id)
            .cloned()
            .ok_or_else(|| error("PLUGIN_NOT_FOUND"))?;
        let previous = current
            .previous
            .clone()
            .ok_or_else(|| error("PLUGIN_NO_ROLLBACK"))?;
        let mut old = current.clone();
        old.digest = previous;
        let package = self.load(&old).await?;
        let backup = self.root.join("backups").join(id).join(&package.digest);
        if !tokio::fs::try_exists(&backup).await.map_err(io_error)? {
            return Err(error(
                "PLUGIN_ROLLBACK_DATA_MISSING：回退数据备份缺失，拒绝仅回退代码",
            ));
        }
        let root = self.root.clone();
        let plugin_id = id.to_owned();
        self.data_io(move || transaction::prepare(&root, &plugin_id, &backup))
            .await?;
        let journal = transaction::Journal {
            id: id.to_owned(),
            old_digest: current.digest.clone(),
            new_digest: package.digest.clone(),
            had_data: tokio::fs::try_exists(self.root.join("data").join(id))
                .await
                .map_err(io_error)?,
        };
        self.switch_data(journal).await?;
        old.manifest = package.manifest;
        old.previous = Some(current.digest);
        old.enabled = false;
        old.grants.clear();
        old.failures = 0;
        old.quarantined = false;
        registry
            .data_versions
            .insert(id.to_owned(), old.manifest.data_version);
        registry.records.insert(id.to_owned(), old);
        let result = self.commit(registry).await;
        self.recover_data().await?;
        result?;
        self.prune(id).await
    }
    pub async fn invoke<R: tauri::Runtime>(
        &self,
        app: &tauri::AppHandle<R>,
        id: &str,
        command: &str,
        input: Value,
    ) -> Result<Value> {
        identifier(id)?;
        identifier(command)?;
        if encode(&input)?.len() > 65536 {
            return Err(error("PLUGIN_INPUT_LIMIT"));
        }
        self.available(id)?;
        self.limit(format!("invoke:{id}"), 60).await?;
        let record = {
            let registry = self.registry.lock().await;
            if registry.safe_mode {
                return Err(error("PLUGIN_SAFE_MODE"));
            }
            registry
                .records
                .get(id)
                .filter(|r| r.enabled && !r.quarantined)
                .cloned()
                .ok_or_else(|| error("PLUGIN_DISABLED"))?
        };
        if command != "render"
            && !record
                .manifest
                .contributions
                .iter()
                .any(|c| c.command == command)
            && !record.manifest.tasks.iter().any(|t| t.command == command)
        {
            return Err(error("PLUGIN_COMMAND_DENIED"));
        }
        // 周期调度快照可能早于撤权；执行边界仍须检查当前权限。
        if record
            .manifest
            .tasks
            .iter()
            .any(|task| task.command == command)
            && !record
                .grants
                .iter()
                .any(|permission| permission == "background")
        {
            return Err(error("PLUGIN_PERMISSION_DENIED：后台任务权限已撤销"));
        }
        if record.publisher_key.is_none()
            && !(cfg!(debug_assertions) || crate::services::developer::enabled())
        {
            self.stop(id).await;
            return Err(error("PLUGIN_DEVELOPER_REQUIRED"));
        }
        let session = match self.session(&record).await {
            Ok(session) => session,
            Err(cause) => {
                if !matches!(&cause,crate::error::AppError::Tool(message) if message.starts_with("PLUGIN_BUSY")||message.starts_with("PLUGIN_START_SHARED_FAILURE")||message.starts_with("PLUGIN_ACTIVE_LIMIT")||message.starts_with("PLUGIN_CANCELLED"))
                {
                    self.outcome(&record, true).await?;
                }
                return Err(cause);
            }
        };
        let result = session
            .invoke(self, app, &record, command, input, None)
            .await
            .and_then(|value| {
                if command == "render"
                    || record.manifest.contributions.iter().any(|c| {
                        c.command == command
                            && ["page", "tool", "widget"].contains(&c.kind.as_str())
                    })
                {
                    model::validate_view(&value, &record.manifest.contributions)?;
                }
                Ok(value)
            });
        if result.is_err() {
            session.stop().await;
        }
        // 主动撤销、停用或退出属于正常生命周期，不记为插件崩溃。
        let cancelled = matches!(&result,Err(crate::error::AppError::Tool(message)) if message.starts_with("PLUGIN_CANCELLED"));
        if !cancelled {
            self.outcome(&record, result.is_err()).await?;
        }
        result
    }
    /// 更新包必须来自已安装清单的固定 HTTPS 地址，并继续使用原发布者密钥。只预览，不自动授权。
    pub async fn update(&self, id: &str) -> Result<Preview> {
        identifier(id)?;
        let record = self
            .registry
            .lock()
            .await
            .records
            .get(id)
            .cloned()
            .ok_or_else(|| error("PLUGIN_NOT_FOUND"))?;
        let url = record
            .manifest
            .update_url
            .ok_or_else(|| error("PLUGIN_NO_UPDATE_SOURCE"))?;
        let origin = reqwest::Url::parse(&url)
            .map_err(|_| error("PLUGIN_UPDATE_URL"))?
            .origin()
            .ascii_serialization();
        let bytes = self.network.fetch(&url, &[origin], MAX_PACKAGE).await?;
        // 固定下载地址仍可能被服务端误配；不能让 A 的更新入口安装 B 或换用其他签名身份。
        let expected_id = id.to_owned();
        let expected_key = record.publisher_key;
        let checked = bytes.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let package = package::read(&checked, false)?;
            if package.manifest.id != expected_id || package.publisher_key != expected_key {
                return Err(error("PLUGIN_UPDATE_IDENTITY"));
            }
            Ok(())
        })
        .await
        .map_err(|_| error("PLUGIN_PACKAGE"))??;
        self.preview(bytes, false).await
    }
    /// 定时任务复用唯一宿主与 Query 状态；启动周期不立即执行，避免打开应用就修改外部状态。
    pub fn start_scheduler(app: tauri::AppHandle) {
        tauri::async_runtime::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(5));
            loop {
                let state = app.state::<Self>();
                tokio::select! {_ = state.shutdown.cancelled()=>break,_=interval.tick()=>{}}
                let registry = state.registry.lock().await.clone();
                // 版本切换/卸载后丢弃旧调度键，避免长期运行累计所有历史版本的计时状态。
                let current = registry
                    .records
                    .values()
                    .flat_map(|r| {
                        r.manifest
                            .tasks
                            .iter()
                            .map(move |task| format!("{}:{}:{}", r.manifest.id, r.digest, task.id))
                    })
                    .collect::<std::collections::BTreeSet<_>>();
                state
                    .task_runs
                    .lock()
                    .await
                    .retain(|key, _| current.contains(key));
                if registry.safe_mode {
                    continue;
                }
                for record in registry.records.values().filter(|r| {
                    r.enabled && !r.quarantined && r.grants.iter().any(|p| p == "background")
                }) {
                    for task in &record.manifest.tasks {
                        let key = format!("{}:{}:{}", record.manifest.id, record.digest, task.id);
                        let mut runs = state.task_runs.lock().await;
                        let last = runs.entry(key).or_insert_with(Instant::now);
                        if last.elapsed() < Duration::from_secs(task.interval_seconds) {
                            continue;
                        }
                        *last = Instant::now();
                        drop(runs);
                        let _ = state
                            .invoke(&app, &record.manifest.id, &task.command, Value::Null)
                            .await;
                    }
                }
            }
            log::info!("插件调度器已停止");
        });
        log::info!("插件调度器已启动");
    }
    async fn capability<R: tauri::Runtime>(
        &self,
        app: &tauri::AppHandle<R>,
        owner: &Record,
        request: &str,
        data_scope: Option<&Path>,
    ) -> Result<Value> {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Call {
            method: String,
            #[serde(default)]
            params: Value,
        }
        if request.len() > 1024 * 1024 {
            return Err(error("PLUGIN_INPUT_LIMIT"));
        }
        if data_scope.is_none() {
            self.available(&owner.manifest.id)?;
        }
        self.limit(format!("capability:{}", owner.manifest.id), 600)
            .await?;
        Self::verify_channel(owner)?;
        let call: Call = serde_json::from_str(request).map_err(|_| error("PLUGIN_INPUT"))?;
        let permission = match call.method.as_str() {
            "storage.get" | "storage.put" | "storage.delete" => "storage",
            "file.read" => "file.read",
            "file.write" => "file.write",
            "settings.get" => "settings",
            "network.get" => "network",
            "notifications.show" => "notifications",
            "hardware.read" => "hardware.read",
            "games.read" => "games.read",
            _ => return Err(error("PLUGIN_CAPABILITY_UNKNOWN")),
        };
        let current = if data_scope.is_some() {
            // 安装事务只能操作服务创建的私有副本，不得产生网络或系统副作用。
            if permission != "storage" {
                return Err(error("PLUGIN_MIGRATION_CAPABILITY_DENIED"));
            }
            owner.clone()
        } else {
            let registry = self.registry.lock().await;
            registry
                .records
                .get(&owner.manifest.id)
                .filter(|r| {
                    r.enabled && !r.quarantined && r.digest == owner.digest && !registry.safe_mode
                })
                .cloned()
                .ok_or_else(|| error("PLUGIN_SESSION_REVOKED"))?
        };
        let declared = current
            .manifest
            .permissions
            .iter()
            .find(|p| p.id == permission && current.grants.contains(&p.id))
            .ok_or_else(|| error("PLUGIN_PERMISSION_DENIED"))?
            .clone();
        match call.method.as_str() {
            "file.read" | "file.write" => {
                self.file_call(&owner.manifest.id, &owner.digest, &call.method, call.params)
                    .await
            }
            "storage.get" | "storage.put" | "storage.delete" => {
                let key = call
                    .params
                    .get("key")
                    .and_then(Value::as_str)
                    .ok_or_else(|| error("PLUGIN_STORAGE_KEY"))?;
                identifier(key)?;
                model::package_path(&format!("{key}.json"))?;
                let directory = data_scope
                    .map(Path::to_path_buf)
                    .unwrap_or_else(|| self.root.join("data").join(&owner.manifest.id));
                let path = directory.join(format!("{key}.json"));
                let method = call.method;
                let value = call.params.get("value").cloned().unwrap_or(Value::Null);
                let maximum = u64::from(owner.manifest.limits.storage_mb) * 1024 * 1024;
                self.data_io(move || {
                    storage::ordinary_tree(&path)?;
                    if method == "storage.get" {
                        return if path.exists() {
                            serde_json::from_slice(&storage::read_bounded(&path, 1024 * 1024)?)
                                .map_err(|_| error("PLUGIN_STORAGE_CORRUPT"))
                        } else {
                            Ok(Value::Null)
                        };
                    }
                    if method == "storage.delete" {
                        if path.exists() {
                            std::fs::remove_file(path).map_err(io_error)?;
                        }
                        return Ok(Value::Null);
                    }
                    let bytes = encode(&value)?;
                    if bytes.len() > 1024 * 1024 {
                        return Err(error("PLUGIN_STORAGE_LIMIT"));
                    }
                    let parent = path.parent().ok_or_else(|| error("PLUGIN_STORAGE"))?;
                    if !path.exists()
                        && parent.exists()
                        && std::fs::read_dir(parent)
                            .map_err(io_error)?
                            .take(4096)
                            .count()
                            >= 4096
                    {
                        return Err(error("PLUGIN_STORAGE_QUOTA：存储条目达到上限"));
                    }
                    let old = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
                    if storage::usage(parent)?.saturating_sub(old) + bytes.len() as u64 > maximum {
                        return Err(error("PLUGIN_STORAGE_QUOTA"));
                    }
                    storage::atomic_write(&path, &bytes)?;
                    Ok(Value::Null)
                })
                .await
            }
            "settings.get" => Ok(
                json!({"apiVersion":model::API_VERSION,"hostVersion":env!("CARGO_PKG_VERSION"),"platform":std::env::consts::OS}),
            ),
            "network.get" => {
                let address = call
                    .params
                    .get("url")
                    .and_then(Value::as_str)
                    .ok_or_else(|| error("PLUGIN_NETWORK_URL"))?;
                let bytes = self
                    .network
                    .fetch(address, &declared.origins, 1024 * 1024)
                    .await?;
                Ok(Value::String(
                    String::from_utf8(bytes).map_err(|_| error("PLUGIN_NETWORK_TEXT"))?,
                ))
            }
            "notifications.show" => {
                self.limit(format!("notification:{}", owner.manifest.id), 10)
                    .await?;
                let message = call
                    .params
                    .get("text")
                    .and_then(Value::as_str)
                    .ok_or_else(|| error("PLUGIN_INPUT"))?;
                model::text(message, 512)?;
                app.emit_to(
                    "main",
                    "plugin-notification",
                    json!({"pluginId":owner.manifest.id,"name":owner.manifest.name,"text":message}),
                )
                .map_err(|_| error("PLUGIN_NOTIFICATION"))?;
                Ok(Value::Null)
            }
            "hardware.read" => {
                let snapshot = app
                    .state::<crate::services::hardware::Hardware>()
                    .read()
                    .await;
                // 设备型号、账号、路径与原始传感器不在摘要权限中；只提供经过选择的利用率字段。
                let value = serde_json::to_value(snapshot).map_err(|_| error("PLUGIN_HARDWARE"))?;
                Ok(
                    json!({"status":value.get("status"),"capturedAt":value.get("capturedAt"),"metrics":value.get("metrics")}),
                )
            }
            "games.read" => {
                let snapshot = app
                    .state::<crate::services::steam::SteamState>()
                    .current()
                    .await?;
                let value = serde_json::to_value(snapshot).map_err(|_| error("PLUGIN_GAMES"))?;
                let games=value.get("games").and_then(Value::as_array).map(|games|games.iter().take(10000).map(|game|json!({"appId":game.get("appId"),"name":game.get("name"),"installed":game.get("installed")})).collect::<Vec<_>>()).unwrap_or_default();
                Ok(json!({"games":games}))
            }
            _ => Err(error("PLUGIN_CAPABILITY_UNKNOWN")),
        }
    }
}
