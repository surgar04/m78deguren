//! 默认关闭的局域网只读服务。每次启动生成独立随机凭证，链接用 fragment，API 用 Authorization。
use super::types::{RemoteInfo, Snapshot};
use crate::services::tools::{Result, error, io_error};
use std::{
    net::{Ipv4Addr, SocketAddr},
    sync::Arc,
    time::Duration,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::{Mutex, RwLock, Semaphore},
};
use tokio_util::sync::CancellationToken;

struct Active {
    stop: CancellationToken,
    info: RemoteInfo,
}
#[derive(Default)]
pub struct Remote {
    active: Mutex<Option<Active>>,
}
pub fn addresses(snapshot: &Snapshot) -> Vec<String> {
    let mut values: Vec<_> = snapshot
        .devices
        .iter()
        .filter(|device| device.kind == "network")
        .flat_map(|device| &device.fields)
        .filter(|field| field.label == "IP 地址")
        .flat_map(|field| field.value.split(", "))
        .filter_map(|address| address.parse::<Ipv4Addr>().ok())
        .filter(Ipv4Addr::is_private)
        .map(|address| address.to_string())
        .collect();
    values.sort();
    values.dedup();
    values
}
impl Remote {
    pub async fn is_active(&self) -> bool {
        self.active
            .lock()
            .await
            .as_ref()
            .is_some_and(|active| !active.stop.is_cancelled())
    }
    pub async fn info(&self, snapshot: &Snapshot) -> RemoteInfo {
        let active = self.active.lock().await;
        let mut info = active
            .as_ref()
            .filter(|active| !active.stop.is_cancelled())
            .map_or(RemoteInfo::default(), |active| active.info.clone());
        info.addresses = addresses(snapshot);
        info
    }
    pub async fn stop(&self) {
        if let Some(active) = self.active.lock().await.take() {
            active.stop.cancel();
        }
    }
    pub async fn start(
        &self,
        snapshot: Arc<RwLock<Snapshot>>,
        address: &str,
    ) -> Result<RemoteInfo> {
        let ip: Ipv4Addr = address
            .parse()
            .map_err(|_| error("请选择本机私有 IPv4 地址"))?;
        if !addresses(&*snapshot.read().await).contains(&ip.to_string()) {
            return Err(error("该地址不属于本机已识别的局域网网卡"));
        }
        // 先成功绑定新服务，再撤销旧凭证；失败不会把仍然可用的旧服务关闭。
        let listener = TcpListener::bind(SocketAddr::from((ip, 0)))
            .await
            .map_err(io_error)?;
        let endpoint = listener.local_addr().map_err(io_error)?;
        let token = format!(
            "{}{}",
            uuid::Uuid::new_v4().simple(),
            uuid::Uuid::new_v4().simple()
        );
        let url = format!("http://{endpoint}/#{token}");
        let svg = qrcode::QrCode::new(url.as_bytes())
            .map_err(|_| error("二维码生成失败"))?
            .render::<qrcode::render::svg::Color>()
            .min_dimensions(256, 256)
            .build();
        let expires = chrono::Utc::now().timestamp_millis() + 8 * 60 * 60 * 1000;
        let info = RemoteInfo {
            enabled: true,
            url: Some(url),
            qr_svg: Some(svg),
            expires_at: Some(expires),
            addresses: addresses(&*snapshot.read().await),
        };
        let stop = CancellationToken::new();
        let worker_stop = stop.clone();
        let mut active = self.active.lock().await;
        if let Some(previous) = active.take() {
            previous.stop.cancel();
        }
        let host = endpoint.to_string();
        tokio::spawn(async move {
            let capacity = Arc::new(Semaphore::new(8));
            let deadline = tokio::time::Instant::now() + Duration::from_secs(8 * 60 * 60);
            loop {
                let accepted = tokio::select! { _ = worker_stop.cancelled() => break, _ = tokio::time::sleep_until(deadline) => { worker_stop.cancel(); break; }, result = listener.accept() => result };
                if chrono::Utc::now().timestamp_millis() >= expires {
                    worker_stop.cancel();
                    break;
                }
                let Ok((socket, peer)) = accepted else {
                    worker_stop.cancel();
                    break;
                };
                if !peer.ip().is_ipv4() {
                    continue;
                }
                let Ok(permit) = capacity.clone().try_acquire_owned() else {
                    continue;
                };
                let token = token.clone();
                let host = host.clone();
                let state = snapshot.clone();
                let stop = worker_stop.clone();
                tokio::spawn(async move {
                    let _permit = permit;
                    tokio::select! { _ = stop.cancelled() => {}, _ = tokio::time::timeout(Duration::from_secs(5), serve(socket, &host, &token, state)) => {} }
                });
            }
        });
        *active = Some(Active {
            stop,
            info: info.clone(),
        });
        Ok(info)
    }
}
fn equal_token(left: &str, right: &str) -> bool {
    left.len() == right.len()
        && left
            .bytes()
            .zip(right.bytes())
            .fold(0_u8, |difference, (a, b)| difference | (a ^ b))
            == 0
}
async fn serve(
    mut socket: TcpStream,
    host: &str,
    token: &str,
    snapshot: Arc<RwLock<Snapshot>>,
) -> std::io::Result<()> {
    let mut header = Vec::new();
    let mut buffer = [0_u8; 1024];
    loop {
        let read = socket.read(&mut buffer).await?;
        if read == 0 {
            return Ok(());
        }
        header.extend_from_slice(&buffer[..read]);
        if header.len() > 8192 {
            return Ok(());
        }
        if header.windows(4).any(|bytes| bytes == b"\r\n\r\n") {
            break;
        }
    }
    let Ok(request) = std::str::from_utf8(&header) else {
        return Ok(());
    };
    let mut lines = request.split("\r\n");
    let first = lines.next().unwrap_or_default();
    let headers: Vec<_> = lines
        .filter_map(|line| line.split_once(':'))
        .map(|(key, value)| (key.to_ascii_lowercase(), value.trim()))
        .collect();
    let lookup = |name: &str| {
        headers
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| *value)
    };
    let (status, mime, data) = if lookup("host") != Some(host)
        || lookup("origin").is_some_and(|origin| origin != format!("http://{host}"))
    {
        (403, "text/plain", b"Forbidden".to_vec())
    } else if first == "GET / HTTP/1.1" {
        (
            200,
            "text/html; charset=utf-8",
            include_bytes!("mobile.html").to_vec(),
        )
    } else if first == "GET /monitor.js HTTP/1.1" {
        (
            200,
            "text/javascript; charset=utf-8",
            include_bytes!("../../../resources/hardware-web/mobile.js").to_vec(),
        )
    } else if first == "GET /api/metrics HTTP/1.1"
        && lookup("authorization")
            .and_then(|value| value.strip_prefix("Bearer "))
            .is_some_and(|value| equal_token(value, token))
    {
        let current = snapshot.read().await;
        // 手机只获得实时读数与硬件名称，不发送序列号、MAC、磁盘路径或桌面访问凭证。
        let value = serde_json::json!({"status":current.status,"capturedAt":current.captured_at,"metrics":current.metrics,"gpus":current.gpus,"fps":current.fps});
        match serde_json::to_vec(&value) {
            Ok(bytes) => (200, "application/json", bytes),
            Err(_) => (500, "text/plain", b"Encoding failed".to_vec()),
        }
    } else if first == "GET /api/metrics HTTP/1.1" {
        (401, "text/plain", b"Unauthorized".to_vec())
    } else {
        (404, "text/plain", b"Not found".to_vec())
    };
    let header = format!(
        "HTTP/1.1 {status} {}\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'\r\n\r\n",
        match status {
            200 => "OK",
            401 => "Unauthorized",
            403 => "Forbidden",
            404 => "Not Found",
            _ => "Internal Server Error",
        },
        data.len()
    );
    socket.write_all(header.as_bytes()).await?;
    socket.write_all(&data).await?;
    socket.shutdown().await
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn credentials_are_exact_not_prefix_matches() {
        assert!(equal_token("abcd", "abcd"));
        assert!(!equal_token("abc", "abcd"));
        assert!(!equal_token("abce", "abcd"));
    }
    #[test]
    fn http_api_requires_exact_token_and_origin() -> Result<()> {
        tauri::async_runtime::block_on(async {
            async fn request(auth: &str, origin: &str) -> std::io::Result<String> {
                let listener = TcpListener::bind("127.0.0.1:0").await?;
                let host = listener.local_addr()?.to_string();
                let endpoint = host.clone();
                let state = Arc::new(RwLock::new(Snapshot::default()));
                let handle = tokio::spawn(async move {
                    let (socket, _) = listener.accept().await?;
                    serve(socket, &endpoint, "secret", state).await
                });
                let mut client = TcpStream::connect(&host).await?;
                client.write_all(format!("GET /api/metrics HTTP/1.1\r\nHost: {host}\r\nAuthorization: Bearer {auth}\r\n{origin}\r\n").as_bytes()).await?;
                let mut reply = String::new();
                client.read_to_string(&mut reply).await?;
                let _ = handle.await;
                Ok(reply)
            }
            assert!(
                request("wrong", "")
                    .await
                    .map_err(io_error)?
                    .starts_with("HTTP/1.1 401")
            );
            let good = request("secret", "").await.map_err(io_error)?;
            assert!(good.starts_with("HTTP/1.1 200"));
            assert!(good.contains("\"metrics\""));
            assert!(!good.contains("devices"));
            assert!(
                request("secret", "Origin: http://untrusted.example\r\n")
                    .await
                    .map_err(io_error)?
                    .starts_with("HTTP/1.1 403")
            );
            Ok(())
        })
    }
}
