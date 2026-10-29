//! 站点测试测量真实 HTTP 响应头耗时，包含 DNS/TLS，不称为 ICMP 或游戏延迟。
use super::config::Server;
use crate::services::tools::{Result, downloads, error};
use futures_util::{StreamExt, stream};
use serde::Serialize;
use std::time::{Duration, Instant};

const PRESETS: [(&str, &str, &str); 10] = [
    ("baidu", "百度", "https://www.baidu.com/"),
    ("gitcode", "GitCode", "https://gitcode.com/"),
    ("github", "GitHub", "https://github.com/"),
    ("qq", "腾讯", "https://www.qq.com/"),
    ("aliyun", "阿里云", "https://www.aliyun.com/"),
    ("wangyi", "网易", "https://www.163.com/"),
    ("bilibili", "哔哩哔哩", "https://www.bilibili.com/"),
    ("douyin", "抖音", "https://www.douyin.com/"),
    ("jd", "京东", "https://www.jd.com/"),
    ("zhihu", "知乎", "https://www.zhihu.com/"),
];
pub fn servers(custom: &[Server]) -> Vec<Server> {
    PRESETS
        .iter()
        .map(|(id, name, url)| Server {
            id: (*id).into(),
            name: (*name).into(),
            url: (*url).into(),
            custom: false,
        })
        .chain(custom.iter().cloned())
        .collect()
}
pub fn validated_url(value: &str) -> Result<reqwest::Url> {
    let url = downloads::validate_url(value)?;
    if url.scheme() != "https"
        || url.query().is_some()
        || url.port().is_some_and(|port| port != 443)
    {
        return Err(error("站点测试只接受不含查询参数的公网 HTTPS 地址"));
    }
    Ok(url)
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Measurement {
    pub id: String,
    pub measured_at: f64,
    pub elapsed_ms: Option<f64>,
    pub http_status: Option<u16>,
    pub error: Option<String>,
}
pub async fn test(
    http: &reqwest::Client,
    all: Vec<Server>,
    ids: Vec<String>,
) -> Result<Vec<Measurement>> {
    if ids.is_empty()
        || ids.len() > 40
        || ids.iter().collect::<std::collections::HashSet<_>>().len() != ids.len()
    {
        return Err(error("请选择 1–40 个不重复的站点"));
    }
    let mut selected = Vec::new();
    for id in ids {
        selected.push(
            all.iter()
                .find(|server| server.id == id)
                .cloned()
                .ok_or_else(|| error("站点已移除，请刷新后重试"))?,
        );
    }
    // 最多四个并发请求；只读取响应头，避免把测速变成大文件下载。
    Ok(stream::iter(selected)
        .map(|server| async move {
            let started = Instant::now();
            let response = http
                .head(&server.url)
                .timeout(Duration::from_secs(8))
                .header("Cache-Control", "no-cache")
                .send()
                .await;
            match response {
                Ok(response) => Measurement {
                    id: server.id,
                    measured_at: crate::services::tools::network::now_ms(),
                    elapsed_ms: Some(started.elapsed().as_secs_f64() * 1000.0),
                    http_status: Some(response.status().as_u16()),
                    error: None,
                },
                Err(cause) => Measurement {
                    id: server.id,
                    measured_at: crate::services::tools::network::now_ms(),
                    elapsed_ms: None,
                    http_status: None,
                    error: Some(
                        if cause.is_timeout() {
                            "请求超时"
                        } else if cause.is_connect() {
                            "DNS、连接或 TLS 失败"
                        } else {
                            "站点请求失败"
                        }
                        .into(),
                    ),
                },
            }
        })
        .buffer_unordered(4)
        .collect()
        .await)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn presets_are_real_https_and_private_targets_are_rejected() {
        assert_eq!(servers(&[]).len(), 10);
        for server in servers(&[]) {
            assert!(validated_url(&server.url).is_ok());
        }
        for url in [
            "https://127.0.0.1/",
            "https://192.168.1.1/",
            "http://example.com/",
            "https://example.com/?token=test",
            "https://user:pass@example.com/",
        ] {
            assert!(validated_url(url).is_err());
        }
    }
}
