//! 可恢复分段下载：应用任务目录、条件 Range、实际字节进度、暂停/取消和 SHA256 校验。
use super::{Result, error, io_error};
use futures_util::{StreamExt, future::try_join_all};
use reqwest::{StatusCode, header};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    net::{IpAddr, SocketAddr},
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::{
    fs,
    io::{AsyncReadExt, AsyncWriteExt},
    sync::Mutex,
};
use tokio_util::sync::CancellationToken;

pub fn public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            !ip.is_private()
                && !ip.is_loopback()
                && !ip.is_link_local()
                && !ip.is_unspecified()
                && !ip.is_multicast()
                && !ip.is_broadcast()
                && !ip.is_documentation()
                && ip.octets()[0] != 0
                && ip.octets()[0] < 224
                && !(ip.octets()[0] == 100 && (64..128).contains(&ip.octets()[1]))
                && !(ip.octets()[0] == 192 && ip.octets()[1] == 0 && ip.octets()[2] == 0)
                && !(ip.octets()[0] == 198 && (18..=19).contains(&ip.octets()[1]))
        }
        IpAddr::V6(ip) => ip
            .to_ipv4_mapped()
            .map(|v| public_ip(IpAddr::V4(v)))
            .unwrap_or_else(|| {
                !ip.is_loopback()
                    && !ip.is_unspecified()
                    && !ip.is_multicast()
                    && !ip.is_unique_local()
                    && !ip.is_unicast_link_local()
                    && ip.segments()[0] & 0xe000 == 0x2000
                    && ip.segments()[0..2] != [0x2001, 0x0db8]
            }),
    }
}

pub fn validate_url(value: &str) -> Result<reqwest::Url> {
    if value.len() > 4096 {
        return Err(error("链接过长"));
    }
    let url = reqwest::Url::parse(value).map_err(|_| error("请输入完整HTTP/HTTPS链接"))?;
    if !matches!(url.scheme(), "https" | "http")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err(error("仅支持不含账号密码和片段的HTTP/HTTPS链接"));
    }
    let host = url.host_str().ok_or_else(|| error("链接缺少主机"))?;
    if host == "localhost"
        || host.ends_with(".localhost")
        || host
            .trim_matches(['[', ']'])
            .parse::<IpAddr>()
            .is_ok_and(|ip| !public_ip(ip))
    {
        return Err(error("不允许访问本机、内网或保留地址"));
    }
    Ok(url)
}

struct PublicResolver;
impl reqwest::dns::Resolve for PublicResolver {
    fn resolve(&self, name: reqwest::dns::Name) -> reqwest::dns::Resolving {
        let name = name.as_str().to_owned();
        Box::pin(async move {
            let addresses: Vec<SocketAddr> = tokio::net::lookup_host((name.as_str(), 0))
                .await?
                .filter(|address| public_ip(address.ip()))
                .collect();
            if addresses.is_empty() {
                return Err(std::io::Error::other("域名没有允许的公网地址").into());
            }
            Ok(Box::new(addresses.into_iter()) as reqwest::dns::Addrs)
        })
    }
}

/// 共享连接池；DNS解析阶段过滤内网，重定向每一跳再次验证，防止仅校验初始URL。
pub fn http_client() -> Result<reqwest::Client> {
    reqwest::Client::builder()
        .no_proxy()
        .connect_timeout(Duration::from_secs(10))
        .read_timeout(Duration::from_secs(30))
        .dns_resolver(Arc::new(PublicResolver))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 8
                || validate_url(attempt.url().as_str()).is_err()
                || (attempt.url().scheme() == "http"
                    && attempt.previous().iter().any(|url| url.scheme() == "https"))
            {
                attempt.error("不允许的重定向")
            } else {
                attempt.follow()
            }
        }))
        .user_agent(concat!("zhenjing/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|_| error("网络客户端初始化失败"))
}

pub fn valid_filename(value: &str) -> bool {
    let stem = value
        .split('.')
        .next()
        .unwrap_or_default()
        .trim_end()
        .to_ascii_uppercase()
        .replace('¹', "1")
        .replace('²', "2")
        .replace('³', "3");
    let reserved = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    !value.is_empty()
        && value.encode_utf16().count() <= 120
        && value != "."
        && value != ".."
        && !value.ends_with([' ', '.'])
        && !value
            .chars()
            .any(|c| c.is_control() || "<>:\"/\\|?*".contains(c))
        && !reserved.contains(&stem.as_str())
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DownloadInput {
    pub url: String,
    pub file_name: String,
    pub connections: u8,
    pub limit_kib: u32,
    pub expected_sha256: Option<String>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadTask {
    pub id: String,
    pub url: String,
    pub file_name: String,
    pub status: String,
    pub total: Option<u64>,
    pub downloaded: u64,
    pub bytes_per_second: f64,
    pub connections: u8,
    pub limit_kib: u32,
    pub sha256: Option<String>,
    pub expected_sha256: Option<String>,
    pub message: String,
    pub etag: Option<String>,
    pub modified: Option<String>,
    /// 内部受信下载的硬上限；普通用户下载保留原来的 1TB 上限，旧清单兼容缺失值。
    #[serde(default)]
    pub max_bytes: Option<u64>,
}
pub struct DownloadManager {
    pub root: PathBuf,
    tasks: Mutex<Vec<DownloadTask>>,
    active: Mutex<HashMap<String, CancellationToken>>,
    persistence: Mutex<()>,
    bandwidth: Mutex<Bandwidth>,
    bandwidth_changed: tokio::sync::Notify,
}
struct Bandwidth {
    limit_kib: u32,
    next: tokio::time::Instant,
}
#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DownloadSettings {
    pub limit_kib: u32,
}
#[derive(Clone)]
struct Probe {
    total: Option<u64>,
    range: bool,
    etag: Option<String>,
    modified: Option<String>,
}
impl Probe {
    fn connections(&self, task: &DownloadTask) -> u8 {
        // 没有资源验证器或预期哈希时只用一个响应，避免把变化中的资源拼成不同版本。
        if self.range
            && self.total.is_some_and(|size| size >= 1_048_576)
            && (self.etag.is_some() || self.modified.is_some() || task.expected_sha256.is_some())
        {
            task.connections
        } else {
            1
        }
    }
}
/// 单次传输的共享上下文。分段只接受索引和边界，避免多个位置传递不一致的任务参数。
struct SegmentContext<'a> {
    client: &'a reqwest::Client,
    cancel: &'a CancellationToken,
    task: &'a DownloadTask,
    probe: &'a Probe,
    dir: &'a Path,
    progress: Arc<Mutex<(u64, Instant)>>,
}

impl DownloadManager {
    pub fn load(root: &Path) -> Result<Self> {
        let directory = root.join("downloads");
        super::ensure_local_path(&directory)?;
        std::fs::create_dir_all(&directory).map_err(io_error)?;
        let manifest = directory.join("tasks.json");
        super::ensure_local_path(&manifest)?;
        let mut tasks: Vec<DownloadTask> = if manifest.exists() {
            let bytes = std::fs::read(&manifest).map_err(io_error)?;
            if bytes.len() > 2_097_152 {
                return Err(error("下载任务记录过大，已保留原文件"));
            }
            serde_json::from_slice(&bytes)
                .map_err(|_| error("下载任务记录损坏，已保留原文件，请先备份检查"))?
        } else {
            Vec::new()
        };
        if tasks.len() > 200 {
            return Err(error("下载任务超过200项"));
        }
        for task in &mut tasks {
            if uuid::Uuid::parse_str(&task.id).is_err()
                || !valid_filename(&task.file_name)
                || validate_url(&task.url).is_err()
                || !(1..=8).contains(&task.connections)
            {
                return Err(error("下载记录验证失败，未执行文件操作"));
            }
            if matches!(
                task.status.as_str(),
                "running" | "probing" | "pausing" | "cancelling"
            ) {
                task.status = "paused".into();
                task.message = "上次会话中断，可恢复下载".into();
            }
            task.bytes_per_second = 0.0;
        }
        let settings_path = directory.join("settings.json");
        super::ensure_local_path(&settings_path)?;
        let settings: DownloadSettings = if settings_path.exists() {
            serde_json::from_slice(&std::fs::read(&settings_path).map_err(io_error)?)
                .map_err(|_| error("下载限速配置损坏，原文件已保留"))?
        } else {
            DownloadSettings::default()
        };
        if settings.limit_kib > 1_048_576 {
            return Err(error("全局下载限速无效"));
        }
        Ok(Self {
            root: directory,
            tasks: Mutex::new(tasks),
            active: Mutex::new(HashMap::new()),
            persistence: Mutex::new(()),
            bandwidth: Mutex::new(Bandwidth {
                limit_kib: settings.limit_kib,
                next: tokio::time::Instant::now(),
            }),
            bandwidth_changed: tokio::sync::Notify::new(),
        })
    }
    pub async fn settings(&self) -> DownloadSettings {
        DownloadSettings {
            limit_kib: self.bandwidth.lock().await.limit_kib,
        }
    }
    pub async fn set_limit(&self, limit_kib: u32) -> Result<()> {
        if limit_kib > 1_048_576 {
            return Err(error("全局限速应为0至1048576 KiB/s"));
        }
        let mut meter = self.bandwidth.lock().await;
        super::save_json(
            &self.root.join("settings.json"),
            &DownloadSettings { limit_kib },
        )
        .await?;
        meter.limit_kib = limit_kib;
        meter.next = tokio::time::Instant::now();
        self.bandwidth_changed.notify_waiters();
        Ok(())
    }
    async fn throttle(&self, bytes: usize, cancel: &CancellationToken) -> Result<()> {
        let until = {
            let mut meter = self.bandwidth.lock().await;
            if meter.limit_kib == 0 {
                return Ok(());
            }
            let duration =
                Duration::from_secs_f64(bytes as f64 / (f64::from(meter.limit_kib) * 1024.0));
            meter.next = meter.next.max(tokio::time::Instant::now()) + duration;
            meter.next
        };
        tokio::select! { _ = cancel.cancelled() => Err(error("已暂停")), _ = self.bandwidth_changed.notified() => Ok(()), _ = tokio::time::sleep_until(until) => Ok(()) }
    }
    async fn persist(&self) -> Result<()> {
        let _guard = self.persistence.lock().await;
        let snapshot = self.tasks.lock().await.clone();
        super::save_json(&self.root.join("tasks.json"), &snapshot).await
    }
    pub async fn list(&self) -> Vec<DownloadTask> {
        self.tasks.lock().await.clone()
    }
    pub async fn task(&self, id: &str) -> Result<DownloadTask> {
        self.tasks
            .lock()
            .await
            .iter()
            .find(|task| task.id == id)
            .cloned()
            .ok_or_else(|| error("下载任务不存在"))
    }
    pub fn final_path(&self, task: &DownloadTask) -> PathBuf {
        self.root.join(&task.id).join(&task.file_name)
    }
    async fn patch(&self, id: &str, change: impl FnOnce(&mut DownloadTask)) {
        if let Some(task) = self
            .tasks
            .lock()
            .await
            .iter_mut()
            .find(|task| task.id == id)
        {
            change(task);
        }
    }
    pub async fn create(
        self: &Arc<Self>,
        input: DownloadInput,
        client: reqwest::Client,
    ) -> Result<String> {
        self.create_bounded(input, client, None).await
    }
    pub async fn create_bounded(
        self: &Arc<Self>,
        input: DownloadInput,
        client: reqwest::Client,
        max_bytes: Option<u64>,
    ) -> Result<String> {
        if max_bytes.is_some_and(|size| size == 0 || size > 1_099_511_627_776) {
            return Err(error("下载长度上限无效"));
        }
        validate_url(&input.url)?;
        if !valid_filename(&input.file_name)
            || !(1..=8).contains(&input.connections)
            || input.limit_kib > 1_048_576
            || input.expected_sha256.as_ref().is_some_and(|hash| {
                hash.len() != 64 || !hash.bytes().all(|c| c.is_ascii_hexdigit())
            })
        {
            return Err(error("文件名、连接数、限速或SHA256参数不正确"));
        }
        let id = uuid::Uuid::new_v4().to_string();
        {
            let mut tasks = self.tasks.lock().await;
            if tasks.len() >= 200 {
                return Err(error("下载任务已达200项，请移除已完成任务后重试"));
            }
            tasks.push(DownloadTask {
                id: id.clone(),
                url: input.url,
                file_name: input.file_name,
                status: "paused".into(),
                total: None,
                downloaded: 0,
                bytes_per_second: 0.0,
                connections: input.connections,
                limit_kib: input.limit_kib,
                sha256: None,
                expected_sha256: input.expected_sha256,
                message: String::new(),
                etag: None,
                modified: None,
                max_bytes,
            });
        }
        self.persist().await?;
        self.start(&id, client).await?;
        Ok(id)
    }
    pub async fn start(self: &Arc<Self>, id: &str, client: reqwest::Client) -> Result<()> {
        let task = self.task(id).await?;
        if matches!(task.status.as_str(), "complete" | "cancelled") {
            return Err(error("该任务不能恢复，请新建下载"));
        }
        let mut active = self.active.lock().await;
        if active.len() >= 3 {
            return Err(error("最多同时运行3个下载任务"));
        }
        if active.contains_key(id) {
            return Err(error("任务正在运行或停止中，请稍后重试"));
        }
        let cancellation = CancellationToken::new();
        active.insert(id.into(), cancellation.clone());
        drop(active);
        self.patch(id, |t| {
            t.status = "probing".into();
            t.message.clear();
        })
        .await;
        if let Err(cause) = self.persist().await {
            self.active.lock().await.remove(id);
            return Err(cause);
        }
        let manager = self.clone();
        let id = id.to_owned();
        tauri::async_runtime::spawn(async move {
            let mut attempts = 0;
            let outcome = loop {
                let outcome = manager.transfer(&id, &client, &cancellation).await;
                let transient = outcome.as_ref().err().is_some_and(|cause| {
                    let message = cause.to_string();
                    message.contains("连接")
                        || message.contains("网络读取")
                        || message.contains("分段长度不完整")
                });
                if !transient || attempts >= 2 || cancellation.is_cancelled() {
                    break outcome;
                }
                attempts += 1;
                manager
                    .patch(&id, |task| {
                        task.message = format!("网络中断，正在进行第{attempts}次恢复重试")
                    })
                    .await;
                tokio::select! { _=cancellation.cancelled()=>break outcome, _=tokio::time::sleep(Duration::from_secs(attempts))=>{} }
            };
            let current = manager.task(&id).await.ok();
            manager
                .patch(&id, |task| {
                    task.bytes_per_second = 0.0;
                    if task.status == "complete" {
                        return;
                    }
                    if cancellation.is_cancelled() {
                        task.status = if current.as_ref().is_some_and(|t| t.status == "cancelling")
                        {
                            "cancelled"
                        } else {
                            "paused"
                        }
                        .into();
                        task.message = if task.status == "paused" {
                            "下载已暂停"
                        } else {
                            "下载已取消"
                        }
                        .into();
                    } else if let Err(cause) = outcome {
                        task.status = "failed".into();
                        task.message = cause.to_string();
                    }
                })
                .await;
            manager.active.lock().await.remove(&id);
            if let Err(cause) = manager.persist().await {
                log::error!("下载状态保存失败: {cause}");
            }
        });
        Ok(())
    }
    pub async fn control(
        self: &Arc<Self>,
        id: &str,
        action: &str,
        client: reqwest::Client,
    ) -> Result<()> {
        let task = self.task(id).await?;
        if task.status == "complete" {
            return Err(error("已完成任务无需暂停或取消"));
        }
        if action == "resume" {
            return self.start(id, client).await;
        }
        if !matches!(action, "pause" | "cancel") {
            return Err(error("不支持的下载动作"));
        }
        if let Some(token) = self.active.lock().await.get(id) {
            self.patch(id, |task| {
                if task.status == "complete" {
                    return;
                }
                task.status = if action == "pause" {
                    "pausing"
                } else {
                    "cancelling"
                }
                .into()
            })
            .await;
            token.cancel();
        } else {
            self.patch(id, |task| {
                if task.status != "complete" {
                    task.status = if action == "cancel" {
                        "cancelled"
                    } else {
                        "paused"
                    }
                    .into();
                }
            })
            .await;
            self.persist().await?;
        }
        Ok(())
    }
    pub async fn remove(&self, id: &str) -> Result<()> {
        if self.active.lock().await.contains_key(id) {
            return Err(error("请先暂停或取消运行中的任务"));
        }
        let task = self.task(id).await?;
        // 只移除记录和本工具创建的未完成分段；已完成文件保留供用户管理。
        if task.status != "complete" {
            let path = self.root.join(id).join("parts");
            super::check_local_path(&path).await?;
            if fs::try_exists(&path).await.map_err(io_error)? {
                fs::remove_dir_all(path).await.map_err(io_error)?;
            }
        }
        self.tasks.lock().await.retain(|task| task.id != id);
        self.persist().await
    }
    async fn probe(client: &reqwest::Client, url: &str) -> Result<Probe> {
        let response = client
            .get(url)
            .header(header::RANGE, "bytes=0-0")
            .header(header::ACCEPT_ENCODING, "identity")
            .send()
            .await
            .map_err(|_| error("无法连接下载服务器"))?;
        if response.status() == StatusCode::RANGE_NOT_SATISFIABLE
            && response
                .headers()
                .get(header::CONTENT_RANGE)
                .and_then(|value| value.to_str().ok())
                == Some("bytes */0")
        {
            return Ok(Probe {
                total: Some(0),
                range: false,
                etag: None,
                modified: None,
            });
        }
        if !response.status().is_success() {
            return Err(error(format!(
                "服务器返回HTTP {}",
                response.status().as_u16()
            )));
        }
        let range = response.status() == StatusCode::PARTIAL_CONTENT;
        let total = if range {
            response
                .headers()
                .get(header::CONTENT_RANGE)
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.strip_prefix("bytes 0-0/"))
                .and_then(|v| v.parse::<u64>().ok())
        } else {
            response.content_length()
        };
        if range && total.is_none() {
            return Err(error("服务器Range响应不符合协议"));
        }
        if total.is_some_and(|size| size > 1_099_511_627_776) {
            return Err(error("单个下载不能超过1TB"));
        }
        Ok(Probe {
            total,
            range,
            etag: response
                .headers()
                .get(header::ETAG)
                .and_then(|v| v.to_str().ok())
                .filter(|v| v.len() <= 512 && !v.starts_with("W/"))
                .map(str::to_owned),
            modified: response
                .headers()
                .get(header::LAST_MODIFIED)
                .and_then(|v| v.to_str().ok())
                .filter(|v| v.len() <= 128)
                .map(str::to_owned),
        })
    }
    async fn transfer(
        self: &Arc<Self>,
        id: &str,
        client: &reqwest::Client,
        cancel: &CancellationToken,
    ) -> Result<()> {
        let task = self.task(id).await?;
        let probe = tokio::select! { _=cancel.cancelled()=>return Err(error("已暂停")), result=Self::probe(client,&task.url)=>result? };
        if task
            .max_bytes
            .is_some_and(|limit| probe.total.is_some_and(|size| size > limit))
        {
            return Err(error("服务器报告的下载长度超过受信清单上限"));
        }
        let dir = self.root.join(id);
        super::check_local_path(&dir.join("parts")).await?;
        fs::create_dir_all(dir.join("parts"))
            .await
            .map_err(io_error)?;
        let unchanged = probe.total == task.total
            && (probe.etag.is_some() && probe.etag == task.etag
                || probe.etag.is_none()
                    && task.etag.is_none()
                    && probe.modified.is_some()
                    && probe.modified == task.modified);
        // 没有验证器时从头开始，禁止将两份不同资源拼接成“成功文件”。
        if !unchanged {
            clear_parts(&dir).await?;
        }
        let count = probe.connections(&task);
        self.patch(id, |task| {
            task.status = "running".into();
            task.total = probe.total;
            task.etag = probe.etag.clone();
            task.modified = probe.modified.clone();
            task.downloaded = 0;
        })
        .await;
        self.persist().await?;
        let progress = Arc::new(Mutex::new((0_u64, Instant::now())));
        let ranges = split_ranges(probe.total.unwrap_or(0), count);
        let context = SegmentContext {
            client,
            cancel,
            task: &task,
            probe: &probe,
            dir: &dir,
            progress,
        };
        let result = try_join_all(
            ranges
                .iter()
                .enumerate()
                .map(|(index, (start, end))| self.segment(&context, index, *start, *end)),
        )
        .await;
        let used_ranges = result.is_ok();
        if let Err(cause) = result {
            if cause.to_string().contains("RANGE_IGNORED") && !cancel.is_cancelled() {
                clear_parts(&dir).await?;
                self.patch(id, |t| {
                    t.downloaded = 0;
                    t.message = "服务器忽略Range，已回退单连接".into();
                })
                .await;
                let fallback = Probe {
                    range: false,
                    ..probe.clone()
                };
                let fallback_context = SegmentContext {
                    probe: &fallback,
                    progress: Arc::new(Mutex::new((0, Instant::now()))),
                    ..context
                };
                self.segment(
                    &fallback_context,
                    0,
                    0,
                    probe.total.map(|v| v.saturating_sub(1)),
                )
                .await?;
            } else {
                return Err(cause);
            }
        }
        if cancel.is_cancelled() {
            return Err(error("已暂停"));
        }
        let output = dir.join("assembled.tmp");
        super::check_local_path(&output).await?;
        super::check_local_path(&self.final_path(&task)).await?;
        let mut writer = fs::File::create(&output).await.map_err(io_error)?;
        let mut digest = Sha256::new();
        let mut bytes = 0_u64;
        let parts = if used_ranges { count } else { 1 };
        let mut buffer = vec![0_u8; 128 * 1024];
        for index in 0..parts {
            let mut part = fs::File::open(dir.join("parts").join(format!("{index}.part")))
                .await
                .map_err(io_error)?;
            loop {
                let size = part.read(&mut buffer).await.map_err(io_error)?;
                if size == 0 {
                    break;
                }
                if cancel.is_cancelled() {
                    return Err(error("已暂停"));
                }
                if bytes.saturating_add(size as u64) > task.max_bytes.unwrap_or(1_099_511_627_776) {
                    return Err(error("合并文件超出下载长度上限"));
                }
                writer.write_all(&buffer[..size]).await.map_err(io_error)?;
                digest.update(&buffer[..size]);
                bytes += size as u64;
            }
        }
        writer.sync_all().await.map_err(io_error)?;
        drop(writer);
        if probe.total.is_some_and(|size| size != bytes) {
            return Err(error("下载文件长度校验失败，未发布成品"));
        }
        let hash = format!("{:x}", digest.finalize());
        if task
            .expected_sha256
            .as_ref()
            .is_some_and(|value| !value.eq_ignore_ascii_case(&hash))
        {
            return Err(error("SHA256不匹配，未发布成品，请核对来源"));
        }
        if cancel.is_cancelled() {
            return Err(error("已暂停"));
        }
        // 不再要求 NTFS 硬链接；系统原子移动保持“不覆盖同名成品”的语义。
        let target = self.final_path(&task);
        tauri::async_runtime::spawn_blocking(move || super::publish_owned_file(&output, &target))
            .await
            .map_err(|_| error("成品发布任务异常"))??;
        self.patch(id, |task| {
            task.status = "complete".into();
            task.downloaded = bytes;
            task.total = Some(bytes);
            task.sha256 = Some(hash);
            task.message = "下载完成，已验证文件长度与SHA256".into();
        })
        .await;
        self.persist().await
    }
    async fn segment(
        &self,
        context: &SegmentContext<'_>,
        index: usize,
        start: u64,
        end: Option<u64>,
    ) -> Result<()> {
        let SegmentContext {
            client,
            cancel,
            task,
            probe,
            dir,
            progress,
        } = context;
        let id = &task.id;
        let path = dir.join("parts").join(format!("{index}.part"));
        super::check_local_path(&path).await?;
        let existing = if probe.range {
            fs::metadata(&path).await.map(|m| m.len()).unwrap_or(0)
        } else {
            0
        };
        let expected = end.map(|end| end - start + 1);
        if expected.is_some_and(|size| existing > size) {
            return Err(error("分段长度异常，请重新建立任务"));
        }
        self.patch(id, |t| t.downloaded += existing).await;
        if expected == Some(existing) {
            return Ok(());
        }
        let mut request = client
            .get(&task.url)
            .header(header::ACCEPT_ENCODING, "identity");
        if probe.range {
            let end = end.ok_or_else(|| error("Range缺少总长度"))?;
            request = request.header(header::RANGE, format!("bytes={}-{}", start + existing, end));
            if let Some(etag) = &probe.etag {
                request = request.header(header::IF_MATCH, etag);
            } else if let Some(modified) = &probe.modified {
                request = request.header(header::IF_UNMODIFIED_SINCE, modified);
            }
        }
        let response = tokio::select! { _=cancel.cancelled()=>return Err(error("已暂停")), result=request.send()=>result.map_err(|_|error("下载连接中断，可恢复重试"))? };
        if probe.range && response.status() == StatusCode::OK {
            return Err(error("RANGE_IGNORED"));
        }
        if !response.status().is_success() {
            return Err(error(format!(
                "下载响应HTTP {}；资源可能变化",
                response.status().as_u16()
            )));
        }
        if probe.range {
            let expected_header = format!(
                "bytes {}-{}/{}",
                start + existing,
                end.unwrap_or(0),
                probe.total.unwrap_or(0)
            );
            if response
                .headers()
                .get(header::CONTENT_RANGE)
                .and_then(|v| v.to_str().ok())
                != Some(expected_header.as_str())
            {
                return Err(error("服务器分段范围与请求不一致"));
            }
        }
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(!probe.range)
            .append(probe.range)
            .open(path)
            .await
            .map_err(io_error)?;
        let mut stream = response.bytes_stream();
        let mut received = existing;
        let started = Instant::now();
        let mut new_bytes = 0_u64;
        loop {
            let chunk = tokio::select! { _=cancel.cancelled()=>{file.sync_all().await.map_err(io_error)?;return Err(error("已暂停"));}, value=stream.next()=>value };
            let Some(chunk) = chunk else { break };
            let chunk = chunk.map_err(|_| error("网络读取中断，可恢复下载"))?;
            received += chunk.len() as u64;
            new_bytes += chunk.len() as u64;
            if expected.is_some_and(|size| received > size) {
                return Err(error("服务器返回超量分段，已停止"));
            }
            if received > task.max_bytes.unwrap_or(1_099_511_627_776) {
                return Err(error("下载超过允许的长度上限"));
            }
            self.throttle(chunk.len(), cancel).await?;
            file.write_all(&chunk).await.map_err(io_error)?;
            let mut meter = progress.lock().await;
            meter.0 += chunk.len() as u64;
            let rate = meter.0 as f64 / meter.1.elapsed().as_secs_f64().max(0.001);
            self.patch(id, |t| {
                t.downloaded += chunk.len() as u64;
                t.bytes_per_second = rate;
            })
            .await;
            drop(meter);
            if task.limit_kib > 0 {
                let actual_connections = probe.connections(task);
                let per_connection =
                    f64::from(task.limit_kib) * 1024.0 / f64::from(actual_connections);
                let target = Duration::from_secs_f64(new_bytes as f64 / per_connection);
                if let Some(wait) = target.checked_sub(started.elapsed()) {
                    tokio::select! {_=cancel.cancelled()=>{file.sync_all().await.map_err(io_error)?; return Err(error("已暂停"));},_=tokio::time::sleep(wait)=>{}}
                }
            }
        }
        file.sync_all().await.map_err(io_error)?;
        if expected.is_some_and(|size| received != size) {
            return Err(error("分段长度不完整，可恢复下载"));
        }
        Ok(())
    }
}
async fn clear_parts(directory: &Path) -> Result<()> {
    let path = directory.join("parts");
    super::check_local_path(&path).await?;
    if fs::try_exists(&path).await.map_err(io_error)? {
        fs::remove_dir_all(&path).await.map_err(io_error)?;
    }
    fs::create_dir_all(path).await.map_err(io_error)
}
pub fn split_ranges(total: u64, count: u8) -> Vec<(u64, Option<u64>)> {
    if total == 0 {
        return vec![(0, None)];
    }
    let count = u64::from(count).min(total).max(1);
    (0..count)
        .map(|index| {
            let start = total * index / count;
            let end = total * (index + 1) / count - 1;
            (start, Some(end))
        })
        .collect()
}
