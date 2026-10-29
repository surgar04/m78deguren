//! 更新源固定为用户指定的 GitHub Releases。只有内嵌公钥验证通过的清单可用于下载/替换。
use crate::services::tools::{
    Result, ToolsState,
    downloads::{DownloadInput, DownloadManager},
    error, io_error, save_json,
};
use base64::Engine;
use ed25519_dalek::{Signature, VerifyingKey};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    time::{Duration, Instant},
};
use tokio::sync::Mutex;

pub const FEED: &str =
    "https://github.com/surgar04/m78deguren/releases/latest/download/zhenjing-update.json";
fn github_host(host: &str) -> bool {
    matches!(
        host,
        "github.com"
            | "api.github.com"
            | "release-assets.githubusercontent.com"
            | "objects.githubusercontent.com"
            | "github-releases.githubusercontent.com"
    )
}
/// 固定 GitHub 源单独复用系统代理；不削弱任意站点测试/用户下载的公网 DNS 边界。
/// 清单签名、固定仓库、文件长度和哈希仍是执行前置条件，代理不能授予代码执行权限。
pub fn github_client() -> Result<reqwest::Client> {
    reqwest::Client::builder()
        .https_only(true)
        .connect_timeout(Duration::from_secs(10))
        .read_timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 8
                || !github_host(attempt.url().host_str().unwrap_or_default())
                || attempt.url().scheme() != "https"
                || attempt.url().port_or_known_default() != Some(443)
                || crate::services::tools::downloads::validate_url(attempt.url().as_str()).is_err()
            {
                attempt.error("不允许 GitHub 白名单之外的更新重定向")
            } else {
                attempt.follow()
            }
        }))
        .user_agent(concat!("zhenjing/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|_| error("GitHub 安全下载客户端初始化失败"))
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Channel {
    pub repository: String,
    pub author: String,
    pub public_key: String,
}
pub fn channel() -> Result<Channel> {
    let channel: Channel = serde_json::from_str(include_str!("../../../release-channel.json"))
        .map_err(|_| error("内嵌发布通道损坏"))?;
    if channel.repository != "surgar04/m78deguren" {
        return Err(error("发布仓库不匹配"));
    }
    Ok(channel)
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Envelope {
    pub payload: String,
    pub signature: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Release {
    pub app_id: String,
    pub version: String,
    pub platform: String,
    pub channel: String,
    pub url: String,
    pub sha256: String,
    pub bytes: u64,
    pub changelog: String,
    pub release_url: String,
}
struct PublishedRelease {
    version: semver::Version,
    url: String,
    notes: String,
}
enum CheckedRelease {
    Signed(Envelope, Release),
    Unverified(PublishedRelease),
    Absent,
}
fn published_release(bytes: &[u8]) -> Result<PublishedRelease> {
    #[derive(Deserialize)]
    struct Metadata {
        tag_name: String,
        html_url: String,
        body: Option<String>,
    }
    let value: Metadata = serde_json::from_slice(bytes).map_err(|_| error("发布元数据结构无效"))?;
    if value.tag_name.len() > 80 {
        return Err(error("发布标签过长"));
    }
    let version =
        semver::Version::parse(value.tag_name.strip_prefix('v').unwrap_or(&value.tag_name))
            .map_err(|_| error("发布标签不是有效版本号"))?;
    if !version.pre.is_empty()
        || value.html_url
            != format!(
                "https://github.com/surgar04/m78deguren/releases/tag/{}",
                value.tag_name
            )
    {
        return Err(error("发布标签不属于固定仓库的稳定通道"));
    }
    Ok(PublishedRelease {
        version,
        url: value.html_url,
        notes: value.body.unwrap_or_default().chars().take(12000).collect(),
    })
}
pub(crate) async fn response_bytes(response: reqwest::Response, limit: usize) -> Result<Vec<u8>> {
    let mut stream = response.bytes_stream();
    let mut bytes = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| error("发布内容传输中断"))?;
        if bytes.len() + chunk.len() > limit {
            return Err(error("发布内容超过大小限制"));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}
pub fn verify(envelope: &Envelope) -> Result<Release> {
    if envelope.payload.len() > 100_000 || envelope.signature.len() > 128 {
        return Err(error("更新清单过大"));
    }
    let engine = base64::engine::general_purpose::STANDARD;
    let channel = channel()?;
    let key_bytes = engine
        .decode(channel.public_key)
        .map_err(|_| error("发布公钥格式不合法"))?;
    let key_bytes: [u8; 32] = key_bytes
        .try_into()
        .map_err(|_| error("发布公钥长度错误"))?;
    let key = VerifyingKey::from_bytes(&key_bytes).map_err(|_| error("发布公钥无效"))?;
    verify_with_key(envelope, &key)
}
fn verify_with_key(envelope: &Envelope, key: &VerifyingKey) -> Result<Release> {
    if envelope.payload.len() > 100_000 || envelope.signature.len() > 128 {
        return Err(error("更新清单过大"));
    }
    let engine = base64::engine::general_purpose::STANDARD;
    let payload = engine
        .decode(&envelope.payload)
        .map_err(|_| error("更新清单内容格式不合法"))?;
    let signature = engine
        .decode(&envelope.signature)
        .map_err(|_| error("更新签名格式不合法"))?;
    let signature = Signature::from_slice(&signature).map_err(|_| error("更新签名长度不合法"))?;
    key.verify_strict(&payload, &signature)
        .map_err(|_| error("更新清单未通过发布签名，已拒绝"))?;
    let release: Release =
        serde_json::from_slice(&payload).map_err(|_| error("更新清单结构不符合约定"))?;
    validate_release(&release)?;
    Ok(release)
}
fn validate_release(release: &Release) -> Result<()> {
    let version = semver::Version::parse(&release.version).map_err(|_| error("发布版本号无效"))?;
    let url = crate::services::tools::downloads::validate_url(&release.url)?;
    let expected = format!(
        "/surgar04/m78deguren/releases/download/v{}/{}",
        release.version,
        installer_file_name(&release.version)?
    );
    let legacy =
        release.app_id == "dev.xinjing.desktop" && version <= semver::Version::new(0, 4, 0);
    let expected = if legacy {
        expected.replace("zhenjing-", "xinjing-")
    } else {
        expected
    };
    if (!legacy && release.app_id != "dev.zhenjing.desktop")
        || release.platform != "windows-x86_64"
        || release.channel != "stable"
        || !version.pre.is_empty()
        || url.scheme() != "https"
        || url.host_str() != Some("github.com")
        // 仅为检查旧已签名版本保留 0.2.x 的清单兼容；新版本必须使用安装包。
        || (url.path() != expected && !(version<=semver::Version::new(0,2,0) && url.path()==expected.replace("-setup.exe",".exe")))
        || url.query().is_some()
        || release.release_url
            != format!(
                "https://github.com/surgar04/m78deguren/releases/tag/v{}",
                release.version
            )
        || release.sha256.len() != 64
        || !release.sha256.bytes().all(|byte| byte.is_ascii_hexdigit())
        || !(1_048_576..=268_435_456).contains(&release.bytes)
        || release.changelog.len() > 65_536
    {
        return Err(error("更新清单不属于本应用、平台、稳定通道或固定发布仓库"));
    }
    Ok(())
}
/// 0.6.0 起只接受 MSI；旧清单只用于展示历史版本，不允许新版本降回 EXE 发布格式。
fn installer_file_name(version: &str) -> Result<String> {
    let parsed = semver::Version::parse(version).map_err(|_| error("发布版本号无效"))?;
    let suffix = if parsed >= semver::Version::new(0, 6, 0) {
        ".msi"
    } else {
        "-setup.exe"
    };
    Ok(format!("zhenjing-{version}-windows-x64{suffix}"))
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub phase: String,
    pub current_version: String,
    pub latest_version: Option<String>,
    pub message: String,
    pub changelog: String,
    pub downloaded: u64,
    pub total: Option<u64>,
    pub checked_at: Option<f64>,
    pub token: Option<String>,
    pub sha256: Option<String>,
    pub release_url: Option<String>,
}
impl Default for Status {
    fn default() -> Self {
        Self {
            phase: "idle".into(),
            current_version: env!("CARGO_PKG_VERSION").into(),
            latest_version: None,
            message: "尚未检查更新".into(),
            changelog: String::new(),
            downloaded: 0,
            total: None,
            checked_at: None,
            token: None,
            sha256: None,
            release_url: None,
        }
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Pending {
    envelope: Envelope,
    download_id: String,
}
struct Lease {
    token: String,
    created: Instant,
    path: PathBuf,
    release: Release,
}
pub struct UpdateService {
    directory: PathBuf,
    pub status: Mutex<Status>,
    release: Mutex<Option<(Envelope, Release)>>,
    pending: Mutex<Option<Pending>>,
    lease: Mutex<Option<Lease>>,
    serial: Mutex<()>,
}
impl UpdateService {
    /// 所有待更新指针变更都在 serial 内执行；旧任务仍留在下载列表，不删除用户已下载文件。
    async fn forget_superseded(&self, latest: &semver::Version) {
        let old = self
            .pending
            .lock()
            .await
            .as_ref()
            .and_then(|pending| verify(&pending.envelope).ok())
            .and_then(|release| semver::Version::parse(&release.version).ok());
        if old.is_some_and(|version| version < *latest) {
            *self.pending.lock().await = None;
            *self.lease.lock().await = None;
            let _ = tokio::fs::remove_file(self.directory.join("update-pending.json")).await;
        }
    }
    pub fn new(directory: &Path) -> Result<Self> {
        let pending = match std::fs::read(directory.join("update-pending.json")) {
            Ok(bytes) => {
                // 不兼容、过期或损坏的待更新指针不能阻止应用正常启动。
                let record: Option<Pending> = serde_json::from_slice(&bytes).ok();
                record.filter(|record| {
                    uuid::Uuid::parse_str(&record.download_id).is_ok()
                        && verify(&record.envelope).is_ok()
                })
            }
            Err(cause) if cause.kind() == std::io::ErrorKind::NotFound => None,
            Err(cause) => return Err(io_error(cause)),
        };
        let release = pending
            .as_ref()
            .map(|record| {
                verify(&record.envelope).map(|release| (record.envelope.clone(), release))
            })
            .transpose()?;
        Ok(Self {
            directory: directory.to_owned(),
            status: Mutex::new(Status::default()),
            release: Mutex::new(release),
            pending: Mutex::new(pending),
            lease: Mutex::new(None),
            serial: Mutex::new(()),
        })
    }
    pub async fn check(&self, http: &reqwest::Client) -> Result<Status> {
        let _guard = self
            .serial
            .try_lock()
            .map_err(|_| error("更新任务正在处理，请稍后再试"))?;
        let busy = { self.status.lock().await.phase == "downloading" };
        if busy {
            return Ok(self.status.lock().await.clone());
        }
        {
            let mut status = self.status.lock().await;
            status.phase = "checking".into();
            status.message = "正在读取 GitHub Releases 签名清单".into();
        }
        let result = async {
            let response = http
                .get(FEED)
                .timeout(Duration::from_secs(25))
                .header("Cache-Control", "no-cache")
                .send()
                .await
                .map_err(|_| error("无法连接 GitHub Releases，请检查网络"))?;
            if response.status() == reqwest::StatusCode::NOT_FOUND {
                // 缺少清单不等于没有 Release；只展示官方元数据，不将未签名资产作为可执行更新。
                let metadata = http
                    .get("https://api.github.com/repos/surgar04/m78deguren/releases/latest")
                    .timeout(Duration::from_secs(20))
                    .send()
                    .await
                    .map_err(|_| error("无法读取发布元数据"))?;
                if metadata.status() == reqwest::StatusCode::NOT_FOUND {
                    return Ok(CheckedRelease::Absent);
                }
                if !metadata.status().is_success() {
                    return Err(error(format!(
                        "发布元数据返回 HTTP {}",
                        metadata.status().as_u16()
                    )));
                }
                return Ok(CheckedRelease::Unverified(published_release(
                    &response_bytes(metadata, 262144).await?,
                )?));
            }
            if !response.status().is_success() {
                return Err(error(format!(
                    "发布源返回 HTTP {}",
                    response.status().as_u16()
                )));
            }
            let bytes = response_bytes(response, 131072).await?;
            let envelope: Envelope =
                serde_json::from_slice(&bytes).map_err(|_| error("发布源未返回有效的签名清单"))?;
            let release = verify(&envelope)?;
            Ok(CheckedRelease::Signed(envelope, release))
        }
        .await;
        let mut status = self.status.lock().await;
        status.checked_at = Some(crate::services::tools::network::now_ms());
        match result {
            Ok(CheckedRelease::Signed(envelope, release)) => {
                let current = semver::Version::parse(env!("CARGO_PKG_VERSION"))
                    .map_err(|_| error("本机版本号无效"))?;
                let latest = semver::Version::parse(&release.version)
                    .map_err(|_| error("更新版本号无效"))?;
                status.phase = if latest > current {
                    "available"
                } else {
                    "up-to-date"
                }
                .into();
                status.message = if latest > current {
                    "发现可信的新版本；下载后仍需确认重启替换"
                } else if latest < current {
                    "本机版本领先发布源，不会降级安装"
                } else {
                    "当前版本已是此发布源的最新稳定版本"
                }
                .into();
                status.latest_version = Some(release.version.clone());
                status.changelog = release.changelog.clone();
                status.release_url = Some(release.release_url.clone());
                status.sha256 = Some(release.sha256.clone());
                status.token = None;
                // 新版本替代旧待更新项时，不再让旧任务把界面覆盖回旧版本；下载文件仍保留在应用数据目录。
                self.forget_superseded(&latest).await;
                *self.release.lock().await = Some((envelope, release));
            }
            Ok(CheckedRelease::Unverified(metadata)) => {
                self.forget_superseded(&metadata.version).await;
                let current = semver::Version::parse(env!("CARGO_PKG_VERSION"))
                    .map_err(|_| error("本机版本号无效"))?;
                status.phase = if metadata.version > current {
                    "unverified"
                } else {
                    "up-to-date"
                }
                .into();
                status.message = "已读取发布版本，但缺少可信签名清单，暂不能自动下载或安装".into();
                status.latest_version = Some(metadata.version.to_string());
                status.release_url = Some(metadata.url);
                status.changelog = metadata.notes;
                status.token = None;
                status.sha256 = None;
                *self.release.lock().await = None;
            }
            Ok(CheckedRelease::Absent) => {
                status.phase = "no-release".into();
                status.message = "仓库尚无可用的签名更新清单".into();
                status.latest_version = None;
                status.token = None;
                status.changelog.clear();
                status.sha256 = None;
                status.release_url = None;
                *self.release.lock().await = None;
            }
            Err(cause) => {
                status.phase = "error".into();
                status.message = cause.to_string();
                status.token = None;
                return Err(cause);
            }
        }
        Ok(status.clone())
    }
    pub async fn status(&self, manager: &DownloadManager) -> Result<Status> {
        // 与检查、下载串行，避免轮询拿旧 pending 快照覆盖刚检测到的新版本。
        let _guard = self.serial.lock().await;
        self.current_status(manager).await
    }
    async fn current_status(&self, manager: &DownloadManager) -> Result<Status> {
        let pending = self.pending.lock().await.clone();
        if let Some(pending) = pending {
            let release = verify(&pending.envelope)?;
            let current = semver::Version::parse(env!("CARGO_PKG_VERSION"))
                .map_err(|_| error("本机版本号错误"))?;
            if semver::Version::parse(&release.version).map_err(|_| error("待更新版本无效"))?
                <= current
            {
                *self.pending.lock().await = None;
                let _ = tokio::fs::remove_file(self.directory.join("update-pending.json")).await;
            } else if let Ok(task) = manager.task(&pending.download_id).await {
                let mut status = self.status.lock().await;
                status.latest_version = Some(release.version.clone());
                status.release_url = Some(release.release_url.clone());
                status.changelog = release.changelog.clone();
                status.downloaded = task.downloaded;
                status.total = Some(release.bytes);
                status.sha256 = Some(release.sha256.clone());
                if task.status == "complete" {
                    let mut lease = self.lease.lock().await;
                    if lease
                        .as_ref()
                        .is_none_or(|lease| lease.created.elapsed() >= Duration::from_secs(600))
                    {
                        let path = manager.final_path(&task);
                        let check = path.clone();
                        let expected = release.sha256.clone();
                        let size = release.bytes;
                        let checked = tauri::async_runtime::spawn_blocking(move || {
                            super::storage::verify_file(&check, &expected, size)
                        })
                        .await
                        .map_err(|_| error("更新包核验任务中断"))?;
                        if let Err(cause) = checked {
                            *lease = None;
                            *self.pending.lock().await = None;
                            let _ =
                                tokio::fs::remove_file(self.directory.join("update-pending.json"))
                                    .await;
                            status.phase = "error".into();
                            status.token = None;
                            status.message = cause.to_string();
                            return Err(cause);
                        }
                        *lease = Some(Lease {
                            token: uuid::Uuid::new_v4().to_string(),
                            created: Instant::now(),
                            path,
                            release,
                        });
                    }
                    status.phase = "ready".into();
                    status.message = "更新包哈希和发布签名已验证，等待你确认重启".into();
                    status.token = lease.as_ref().map(|value| value.token.clone());
                } else if matches!(
                    task.status.as_str(),
                    "running"
                        | "probing"
                        | "pausing"
                        | "cancelling"
                        | "queued"
                        | "downloading"
                        | "verifying"
                ) {
                    status.phase = "downloading".into();
                    status.message = "正在下载并校验更新".into();
                    status.token = None;
                } else {
                    status.phase = "available".into();
                    status.message = format!("下载未完成：{}；可重新开始或续传", task.message);
                    status.token = None;
                }
            } else {
                // 下载工具允许用户移除任务；更新服务不能永久卡住已不存在的任务 ID。
                let mut status = self.status.lock().await;
                status.phase = "available".into();
                status.message = "更新下载任务已移除，可重新下载".into();
                status.token = None;
                *self.lease.lock().await = None;
            }
        }
        Ok(self.status.lock().await.clone())
    }
    pub async fn download(&self, tools: &ToolsState, http: &reqwest::Client) -> Result<Status> {
        let _guard = self
            .serial
            .try_lock()
            .map_err(|_| error("更新任务正在处理"))?;
        let (envelope, release) = self
            .release
            .lock()
            .await
            .clone()
            .ok_or_else(|| error("请先检查并验证更新清单"))?;
        if semver::Version::parse(&release.version).map_err(|_| error("版本号无效"))?
            <= semver::Version::parse(env!("CARGO_PKG_VERSION"))
                .map_err(|_| error("本机版本号无效"))?
        {
            return Err(error("没有比当前版本更新的包，不执行降级或重复替换"));
        }
        let existing = self.pending.lock().await.clone();
        let reusable = if let Some(record) =
            existing.filter(|pending| pending.envelope.payload == envelope.payload)
        {
            tools
                .downloads
                .task(&record.download_id)
                .await
                .ok()
                .filter(|task| task.status != "cancelled")
                .map(|task| (record, task))
        } else {
            None
        };
        let id = if let Some((existing, task)) = reusable {
            if matches!(task.status.as_str(), "paused" | "failed") {
                tools
                    .downloads
                    .control(&existing.download_id, "resume", http.clone())
                    .await?;
            }
            existing.download_id
        } else {
            tools
                .downloads
                .create_bounded(
                    DownloadInput {
                        url: release.url.clone(),
                        file_name: installer_file_name(&release.version)?,
                        connections: 4,
                        limit_kib: 0,
                        expected_sha256: Some(release.sha256.clone()),
                    },
                    http.clone(),
                    Some(release.bytes),
                )
                .await?
        };
        let pending = Pending {
            envelope,
            download_id: id,
        };
        save_json(&self.directory.join("update-pending.json"), &pending).await?;
        *self.pending.lock().await = Some(pending);
        self.current_status(&tools.downloads).await
    }
    pub async fn consume(&self, token: &str, consent: bool) -> Result<(PathBuf, Release)> {
        let _guard = self
            .serial
            .try_lock()
            .map_err(|_| error("更新检查或下载任务正在处理，请稍后安装"))?;
        if !consent {
            return Err(error("必须确认重启并替换应用"));
        }
        uuid::Uuid::parse_str(token).map_err(|_| error("更新确认凭据无效"))?;
        let mut lease = self.lease.lock().await;
        if !lease.as_ref().is_some_and(|lease| {
            lease.token == token && lease.created.elapsed() < Duration::from_secs(600)
        }) {
            return Err(error("更新确认已过期，请刷新待更新状态"));
        }
        let lease = lease.take().ok_or_else(|| error("更新凭据已使用"))?;
        Ok((lease.path, lease.release))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn metadata_never_accepts_other_repositories_or_preview_tags() -> Result<()> {
        let valid = br#"{"tag_name":"v1.2.3","html_url":"https://github.com/surgar04/m78deguren/releases/tag/v1.2.3","body":"release notes"}"#;
        assert_eq!(published_release(valid)?.version.to_string(), "1.2.3");
        for bad in [
            br#"{"tag_name":"v1.2.3","html_url":"https://github.com/other/repo/releases/tag/v1.2.3"}"#.as_slice(),
            br#"{"tag_name":"v1.2.3-beta","html_url":"https://github.com/surgar04/m78deguren/releases/tag/v1.2.3-beta"}"#.as_slice(),
        ] { assert!(published_release(bad).is_err()); }
        Ok(())
    }
    #[test]
    fn release_redirect_allowlist_rejects_lookalikes_and_private_hosts() {
        assert!(github_host("github.com"));
        assert!(github_host("release-assets.githubusercontent.com"));
        for host in [
            "github.com.evil.invalid",
            "127.0.0.1",
            "localhost",
            "example.com",
        ] {
            assert!(!github_host(host));
        }
    }
    #[test]
    #[ignore = "需要当前网络/系统代理；仅验证公开发布源，不下载或执行更新"]
    fn live_signed_release_feed_transport() -> Result<()> {
        tauri::async_runtime::block_on(async {
            let response = github_client()?
                .get(FEED)
                .timeout(Duration::from_secs(25))
                .send()
                .await
                .map_err(|cause| error(format!("发布源连接失败：{cause}")))?;
            assert!(
                response.status().is_success()
                    || response.status() == reqwest::StatusCode::NOT_FOUND,
                "发布源 HTTP {}",
                response.status()
            );
            Ok(())
        })
    }
    #[test]
    fn valid_signature_roundtrip_and_tamper_rejection() -> Result<()> {
        use ed25519_dalek::{Signer, SigningKey};
        // 固定测试密钥与真实发布私钥无关；测试不得读取开发机的发布签名文件。
        let key = SigningKey::from_bytes(&[17_u8; 32]);
        let engine = base64::engine::general_purpose::STANDARD;
        let release=Release{app_id:"dev.zhenjing.desktop".into(),version:"9.0.0".into(),platform:"windows-x86_64".into(),channel:"stable".into(),url:"https://github.com/surgar04/m78deguren/releases/download/v9.0.0/zhenjing-9.0.0-windows-x64.msi".into(),sha256:"b".repeat(64),bytes:30_000_000,changelog:"真实变更日志".into(),release_url:"https://github.com/surgar04/m78deguren/releases/tag/v9.0.0".into()};
        let payload = serde_json::to_vec(&release).map_err(|_| error("测试序列化失败"))?;
        let mut envelope = Envelope {
            payload: engine.encode(&payload),
            signature: engine.encode(key.sign(&payload).to_bytes()),
        };
        assert_eq!(
            verify_with_key(&envelope, &key.verifying_key())?.version,
            "9.0.0"
        );
        assert!(verify(&envelope).is_err());
        envelope.payload = engine.encode(b"{}");
        assert!(verify_with_key(&envelope, &key.verifying_key()).is_err());
        Ok(())
    }
    #[test]
    fn signatures_and_release_scope_are_mandatory() {
        assert!(
            verify(&Envelope {
                payload: "e30=".into(),
                signature: "AA==".into()
            })
            .is_err()
        );
        let mut release=Release{app_id:"dev.zhenjing.desktop".into(),version:"0.2.0".into(),platform:"windows-x86_64".into(),channel:"stable".into(),url:"https://github.com/surgar04/m78deguren/releases/download/v0.2.0/zhenjing-0.2.0-windows-x64-setup.exe".into(),sha256:"a".repeat(64),bytes:20_000_000,changelog:"test".into(),release_url:"https://github.com/surgar04/m78deguren/releases/tag/v0.2.0".into()};
        assert!(validate_release(&release).is_ok());
        release.url = "https://github.com/other/repo/releases/download/v0.2.0/update.exe".into();
        assert!(validate_release(&release).is_err());
    }
}
