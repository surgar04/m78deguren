//! 官方开发者发行身份。私钥只存在维护者的忽略目录；客户端只内嵌验签公钥。
//! 认证仅保留在当前进程，不把邮箱或 stoken 写入用户配置、日志或命令行。
use crate::services::tools::{Result, error, io_error, save_json};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use ed25519_dalek::{Signature, VerifyingKey};
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    sync::atomic::{AtomicU8, AtomicU64, Ordering},
};
use tokio::sync::Mutex;

const LOCKED: u8 = 0;
const STABLE: u8 = 1;
const DEVELOPER: u8 = 2;
// 仅此原生状态决定活动通道，前端偏好、环境变量和本地 JSON 均不能授予开发者身份。
static MODE: AtomicU8 = AtomicU8::new(if cfg!(feature = "developer-edition") {
    LOCKED
} else {
    STABLE
});
static EXPIRY: AtomicU64 = AtomicU64::new(0);

pub fn locked() -> bool {
    MODE.load(Ordering::Acquire) == LOCKED
}
pub fn enabled() -> bool {
    MODE.load(Ordering::Acquire) == DEVELOPER
        && std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .is_ok_and(|now| now.as_secs() < EXPIRY.load(Ordering::Acquire))
}
pub fn build_number() -> u64 {
    option_env!("ZHENJING_DEVELOPER_BUILD")
        .and_then(|value| value.parse().ok())
        .unwrap_or(0)
}
pub fn build_version() -> String {
    if cfg!(feature = "developer-edition") {
        format!("{}-dev.{}", env!("CARGO_PKG_VERSION"), build_number())
    } else {
        env!("CARGO_PKG_VERSION").into()
    }
}
pub fn update_version() -> String {
    if enabled() {
        build_version()
    } else {
        env!("CARGO_PKG_VERSION").into()
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Claims {
    v: u8,
    aud: String,
    email: String,
    jti: String,
    iat: u64,
    exp: u64,
}

fn normalized_email(value: &str) -> Result<String> {
    let value = value.trim().to_ascii_lowercase();
    if value.len() > 254
        || !value.is_ascii()
        || value
            .bytes()
            .any(|b| b.is_ascii_whitespace() || b.is_ascii_control())
        || value.split('@').count() != 2
        || value.starts_with('@')
        || value.ends_with('@')
    {
        return Err(error("邮箱或开发者凭据无效"));
    }
    Ok(value)
}

/// 对收到的原始 payload 验签，验签后才解析，避免不同 JSON 序列化造成签名语义差异。
fn verify_with_key(email: &str, token: &str, now: u64, key: &VerifyingKey) -> Result<u64> {
    let invalid = || error("邮箱或开发者凭据无效、已过期或被修改");
    if token.len() > 4096 {
        return Err(invalid());
    }
    let fields: Vec<_> = token.trim().split('.').collect();
    if fields.len() != 3 || fields[0] != "zjdev1" {
        return Err(invalid());
    }
    let bytes = URL_SAFE_NO_PAD.decode(fields[1]).map_err(|_| invalid())?;
    let signature = URL_SAFE_NO_PAD.decode(fields[2]).map_err(|_| invalid())?;
    let signature = Signature::from_slice(&signature).map_err(|_| invalid())?;
    key.verify_strict(&bytes, &signature)
        .map_err(|_| invalid())?;
    let claims: Claims = serde_json::from_slice(&bytes).map_err(|_| invalid())?;
    if claims.v != 1
        || claims.aud != "dev.zhenjing.desktop.developer"
        || claims.email != normalized_email(email)?
        || uuid::Uuid::parse_str(&claims.jti).is_err()
        || claims.iat > now.saturating_add(300)
        || claims.exp <= now
        || claims.exp <= claims.iat
        || claims.exp - claims.iat > 366 * 86400
    {
        return Err(invalid());
    }
    Ok(claims.exp)
}

fn verify(email: &str, token: &str) -> Result<u64> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct PublicKey {
        algorithm: String,
        public_key: String,
    }
    let public: PublicKey = serde_json::from_str(include_str!("../../developer-channel.json"))
        .map_err(|_| error("开发者验签配置损坏"))?;
    if public.algorithm != "Ed25519" {
        return Err(error("开发者验签算法不受支持"));
    }
    let bytes: [u8; 32] = base64::engine::general_purpose::STANDARD
        .decode(public.public_key)
        .map_err(|_| error("开发者公钥无效"))?
        .try_into()
        .map_err(|_| error("开发者公钥长度错误"))?;
    let key = VerifyingKey::from_bytes(&bytes).map_err(|_| error("开发者公钥无效"))?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| error("系统时间错误"))?
        .as_secs();
    verify_with_key(email, token, now, &key)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub edition: &'static str,
    pub mode: &'static str,
    pub build: String,
    pub expires_at: Option<u64>,
    pub message: String,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Fallback {
    build: String,
    mode: String,
}
pub struct DeveloperState {
    path: PathBuf,
    pub serial: Mutex<()>,
    status: Mutex<(Option<u64>, String)>,
}
impl DeveloperState {
    pub fn new(root: &Path) -> Result<Self> {
        let path = root.join("settings/developer-mode.json");
        crate::services::tools::ensure_local_path(&path)?;
        if cfg!(feature = "developer-edition") {
            if build_number() == 0 {
                return Err(error("开发者构建缺少有效构建编号"));
            }
            // 此文件只能记住降权，任何值都不能使程序获得开发者身份。
            if std::fs::metadata(&path).is_ok_and(|m| m.is_file() && m.len() <= 1024)
                && std::fs::read(&path)
                    .ok()
                    .and_then(|bytes| serde_json::from_slice::<Fallback>(&bytes).ok())
                    .is_some_and(|v| v.build == build_version() && v.mode == "stable")
            {
                MODE.store(STABLE, Ordering::Release);
            }
        }
        Ok(Self {
            path,
            serial: Mutex::new(()),
            status: Mutex::new((None, String::new())),
        })
    }
    pub async fn snapshot(&self) -> Status {
        let value = self.status.lock().await;
        Status {
            edition: if cfg!(feature = "developer-edition") {
                "developer"
            } else {
                "stable"
            },
            mode: if locked() {
                "locked"
            } else if enabled() {
                "developer"
            } else {
                "stable"
            },
            build: build_version(),
            expires_at: value.0,
            message: value.1.clone(),
        }
    }
    pub async fn fallback(&self, message: &str) -> Result<Status> {
        MODE.store(STABLE, Ordering::Release);
        *self.status.lock().await = (None, message.into());
        // 写入失败仍先在内存降权；不会因为磁盘已满而继续暴露开发功能。
        save_json(
            &self.path,
            &Fallback {
                build: build_version(),
                mode: "stable".into(),
            },
        )
        .await?;
        Ok(self.snapshot().await)
    }
    pub async fn authenticate(&self, email: &str, token: &str) -> Result<Status> {
        if !cfg!(feature = "developer-edition") {
            return Err(error("发布版不开放开发者认证，请使用官方开发者安装包"));
        }
        match verify(email, token) {
            Ok(expiry) => {
                match tokio::fs::remove_file(&self.path).await {
                    Ok(()) => {}
                    Err(cause) if cause.kind() == std::io::ErrorKind::NotFound => {}
                    Err(cause) => return Err(io_error(cause)),
                }
                *self.status.lock().await = (
                    Some(expiry),
                    "开发者身份已认证；stoken 仅用于当前会话，不保存在本机".into(),
                );
                EXPIRY.store(expiry, Ordering::Release);
                MODE.store(DEVELOPER, Ordering::Release);
                Ok(self.snapshot().await)
            }
            Err(_) => {
                self.fallback("认证未通过，已自动回退到稳定功能与更新通道；用户数据不变")
                    .await
            }
        }
    }
    pub async fn expire_if_needed(&self) -> bool {
        let expiry = self.status.lock().await.0;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(u64::MAX, |v| v.as_secs());
        if MODE.load(Ordering::Acquire) == DEVELOPER && expiry.is_none_or(|value| value <= now) {
            let _ = self.fallback("开发者身份已过期，已回退到稳定通道").await;
            return true;
        }
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    fn token(
        payload: serde_json::Value,
        key: &SigningKey,
    ) -> std::result::Result<String, Box<dyn std::error::Error>> {
        let bytes = serde_json::to_vec(&payload)?;
        Ok(format!(
            "zjdev1.{}.{}",
            URL_SAFE_NO_PAD.encode(&bytes),
            URL_SAFE_NO_PAD.encode(key.sign(&bytes).to_bytes())
        ))
    }
    #[test]
    fn identity_signature_expiry_and_audience_are_enforced()
    -> std::result::Result<(), Box<dyn std::error::Error>> {
        let key = SigningKey::from_bytes(&[43; 32]);
        let claims = serde_json::json!({"v":1,"aud":"dev.zhenjing.desktop.developer","email":"test@example.com","jti":"54886e64-4538-418f-9d18-ce8510f9d115","iat":1000,"exp":2000});
        let good = token(claims.clone(), &key)?;
        assert_eq!(
            verify_with_key(" Test@Example.COM ", &good, 1500, &key.verifying_key())?,
            2000
        );
        assert!(verify_with_key("other@example.com", &good, 1500, &key.verifying_key()).is_err());
        assert!(verify_with_key("test@example.com", &good, 2000, &key.verifying_key()).is_err());
        assert!(verify_with_key("test@example.com", &good, 1, &key.verifying_key()).is_err());
        assert!(
            verify_with_key(
                "test@example.com",
                &good,
                1500,
                &SigningKey::from_bytes(&[44; 32]).verifying_key()
            )
            .is_err()
        );
        for (field, value) in [
            ("aud", serde_json::json!("other")),
            ("exp", serde_json::json!(999)),
            ("extra", serde_json::json!(true)),
        ] {
            let mut changed = claims.clone();
            changed[field] = value;
            assert!(
                verify_with_key(
                    "test@example.com",
                    &token(changed, &key)?,
                    1500,
                    &key.verifying_key()
                )
                .is_err()
            );
        }
        let mut tampered = good.into_bytes();
        tampered[10] ^= 1;
        assert!(
            verify_with_key(
                "test@example.com",
                &String::from_utf8(tampered)?,
                1500,
                &key.verifying_key()
            )
            .is_err()
        );
        assert!(
            verify_with_key(
                "test@example.com",
                &"a".repeat(4097),
                1500,
                &key.verifying_key()
            )
            .is_err()
        );
        Ok(())
    }
}
