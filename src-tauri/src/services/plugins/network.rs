//! 插件网络统一出站。逐请求解析并固定公网地址，禁止系统代理代解析造成 DNS 校验失效。
use crate::services::tools::{Result, error};
use futures_util::StreamExt;
use std::{
    collections::BTreeMap,
    net::{IpAddr, SocketAddr},
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::Mutex;
type ClientCache = BTreeMap<String, (Instant, reqwest::Client)>;
#[derive(Clone, Default)]
pub struct Network {
    clients: Arc<Mutex<ClientCache>>,
}
pub fn public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            let [a, b, c, _] = ip.octets();
            !(ip.is_private()
                || ip.is_loopback()
                || ip.is_link_local()
                || ip.is_multicast()
                || ip.is_broadcast()
                || a == 0
                || a >= 240
                || a == 127
                || (a == 100 && (64..=127).contains(&b))
                || (a == 192 && (b == 0 || b == 168 || (b == 88 && c == 99)))
                || (a == 198 && (b == 18 || b == 19 || (b == 51 && c == 100)))
                || (a == 203 && b == 0 && c == 113))
        }
        // 仅接受全球单播；映射 IPv4、ULA、链路本地、文档和隧道地址一律拒绝。
        IpAddr::V6(ip) => {
            let s = ip.segments();
            s[0] & 0xe000 == 0x2000
                && !(s[0] == 0x2001 && (s[1] <= 0x1ff || s[1] == 0xdb8))
                && s[0] != 0x2002
                && !(s[0] == 0x3fff && s[1] & 0xf000 == 0)
        }
    }
}
impl Network {
    async fn client(&self, host: &str) -> Result<reqwest::Client> {
        if let Some((at, client)) = self.clients.lock().await.get(host)
            && at.elapsed() < Duration::from_secs(60)
        {
            return Ok(client.clone());
        }
        let addresses: Vec<SocketAddr> =
            tokio::time::timeout(Duration::from_secs(5), tokio::net::lookup_host((host, 443)))
                .await
                .map_err(|_| error("PLUGIN_NETWORK_TIMEOUT"))?
                .map_err(|_| error("PLUGIN_NETWORK_DNS"))?
                .collect();
        if addresses.is_empty()
            || addresses.len() > 32
            || addresses.iter().any(|address| !public_ip(address.ip()))
        {
            return Err(error("PLUGIN_NETWORK_DENIED：禁止访问本机、内网及保留地址"));
        }
        let client = reqwest::Client::builder()
            .no_proxy()
            .https_only(true)
            .resolve_to_addrs(host, &addresses)
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(20))
            .user_agent(concat!("zhenjing-plugin/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|_| error("PLUGIN_NETWORK_INIT"))?;
        let mut cache = self.clients.lock().await;
        cache.retain(|_, (at, _)| at.elapsed() < Duration::from_secs(60));
        if cache.len() >= 64 {
            cache.clear();
        }
        cache.insert(host.to_owned(), (Instant::now(), client.clone()));
        Ok(client)
    }
    pub async fn fetch(
        &self,
        address: &str,
        origins: &[String],
        maximum: usize,
    ) -> Result<Vec<u8>> {
        if address.len() > 4096 {
            return Err(error("PLUGIN_NETWORK_URL"));
        }
        let mut url = reqwest::Url::parse(address).map_err(|_| error("PLUGIN_NETWORK_URL"))?;
        for redirects in 0..=3 {
            let source = url.origin().ascii_serialization();
            super::model::origin(&source)?;
            if !origins.contains(&source)
                || !url.username().is_empty()
                || url.password().is_some()
                || url.fragment().is_some()
            {
                return Err(error("PLUGIN_NETWORK_DENIED：请求来源未授权"));
            }
            let host = url.host_str().ok_or_else(|| error("PLUGIN_NETWORK_URL"))?;
            let response = self
                .client(host)
                .await?
                .get(url.clone())
                .send()
                .await
                .map_err(|_| error("PLUGIN_NETWORK_FAILED"))?;
            if response.status().is_redirection() {
                if redirects == 3 {
                    return Err(error("PLUGIN_NETWORK_REDIRECT"));
                }
                let location = response
                    .headers()
                    .get(reqwest::header::LOCATION)
                    .and_then(|v| v.to_str().ok())
                    .ok_or_else(|| error("PLUGIN_NETWORK_REDIRECT"))?;
                url = url
                    .join(location)
                    .map_err(|_| error("PLUGIN_NETWORK_REDIRECT"))?;
                continue;
            }
            if !response.status().is_success()
                || response
                    .content_length()
                    .is_some_and(|size| size > maximum as u64)
            {
                return Err(error("PLUGIN_NETWORK_RESPONSE"));
            }
            let mut bytes = Vec::new();
            let mut stream = response.bytes_stream();
            while let Some(chunk) = stream.next().await {
                let chunk = chunk.map_err(|_| error("PLUGIN_NETWORK_RESPONSE"))?;
                if bytes.len() + chunk.len() > maximum {
                    return Err(error("PLUGIN_NETWORK_LIMIT"));
                }
                bytes.extend_from_slice(&chunk);
            }
            return Ok(bytes);
        }
        Err(error("PLUGIN_NETWORK_REDIRECT"))
    }
}
#[cfg(test)]
mod tests {
    #[test]
    fn blocks_private_and_reserved_addresses() -> Result<(), std::net::AddrParseError> {
        for value in [
            "127.0.0.1",
            "10.0.0.1",
            "169.254.169.254",
            "100.64.1.2",
            "192.0.2.1",
            "::1",
            "::ffff:8.8.8.8",
            "2001:db8::1",
        ] {
            assert!(!super::public_ip(value.parse()?), "{value}");
        }
        assert!(super::public_ip("8.8.8.8".parse()?));
        Ok(())
    }
}
