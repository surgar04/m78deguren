//! 真正的HTTP吞吐采样与NTP四时间戳探测；不随机填充数值，不将HTTP时延称为游戏Ping。
pub use super::speed::SpeedService;
use super::{Result, error, platform};
use serde::Serialize;
use std::{
    path::Path,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tokio::net::UdpSocket;

pub fn now_ms() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|v| v.as_secs_f64() * 1000.0)
        .unwrap_or(0.0)
}
const NTP_EPOCH: f64 = 2_208_988_800.0;
pub const NTP_SERVERS: [(&str, &str, &str); 6] = [
    ("aliyun", "阿里云公共NTP", "ntp.aliyun.com"),
    ("tencent", "腾讯公共NTP", "ntp.tencent.com"),
    ("neu", "东北大学NTP", "ntp.neu.edu.cn"),
    ("pool", "NTP公共池", "pool.ntp.org"),
    ("apple", "Apple时间服务", "time.apple.com"),
    ("microsoft", "Windows时间服务", "time.windows.com"),
];
#[derive(Clone)]
pub struct Probe {
    pub server: String,
    pub offset_ms: f64,
    pub measured: Instant,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NtpResult {
    pub token: String,
    pub server: String,
    pub local_time_ms: f64,
    pub server_time_ms: f64,
    pub offset_ms: f64,
    pub delay_ms: f64,
    pub stratum: u8,
}

/// 2036年的NTP秒字段回绕按最接近本机时刻的纪元展开，不能直接减1900纪元常数。
fn timestamp(bytes: &[u8], near: f64) -> Result<f64> {
    let seconds = u32::from_be_bytes(
        bytes
            .get(..4)
            .and_then(|v| v.try_into().ok())
            .ok_or_else(|| error("NTP时间戳过短"))?,
    );
    let fraction = u32::from_be_bytes(
        bytes
            .get(4..8)
            .and_then(|v| v.try_into().ok())
            .ok_or_else(|| error("NTP时间戳过短"))?,
    );
    let raw = f64::from(seconds) + f64::from(fraction) / 4_294_967_296.0;
    let era = ((near / 1000.0 + NTP_EPOCH - raw) / 4_294_967_296.0).round();
    Ok((raw + era * 4_294_967_296.0 - NTP_EPOCH) * 1000.0)
}
fn request_timestamp(time: f64) -> [u8; 8] {
    let seconds = time / 1000.0 + NTP_EPOCH;
    let integer = (seconds.floor() as u64 & 0xffff_ffff) as u32;
    let fractional = (seconds.fract() * 4_294_967_296.0) as u32;
    let mut output = [0; 8];
    output[..4].copy_from_slice(&integer.to_be_bytes());
    output[4..].copy_from_slice(&fractional.to_be_bytes());
    output
}
pub fn parse_ntp(response: &[u8], sent: [u8; 8], t1: f64, t4: f64) -> Result<(f64, f64, f64, u8)> {
    if response.len() < 48
        || response[0] >> 6 == 3
        || !matches!((response[0] >> 3) & 7, 3 | 4)
        || response[0] & 7 != 4
        || !(1..=15).contains(&response[1])
    {
        return Err(error("NTP服务器未同步、被限流或返回了无效协议响应"));
    }
    if response[24..32] != sent || response[40..48] == [0; 8] {
        return Err(error("NTP响应不属于本次请求"));
    }
    let t2 = timestamp(&response[32..40], t1)?;
    let t3 = timestamp(&response[40..48], t1)?;
    let delay = (t4 - t1) - (t3 - t2);
    let offset = ((t2 - t1) + (t3 - t4)) / 2.0;
    if !offset.is_finite()
        || !delay.is_finite()
        || t3 < t2
        || !(-2.0..=10_000.0).contains(&delay)
        || (t4 - t1) < 0.0
    {
        return Err(error("NTP时序不可信，请重新查询"));
    }
    Ok((offset, delay.max(0.0), t3, response[1]))
}
pub async fn query_ntp(server: &str) -> Result<NtpResult> {
    let host = NTP_SERVERS
        .iter()
        .find(|(id, _, _)| *id == server)
        .map(|(_, _, host)| *host)
        .ok_or_else(|| error("请选择已登记的NTP服务器"))?;
    let query = async {
        let address = tokio::net::lookup_host((host, 123))
            .await
            .map_err(|_| error("NTP域名解析失败"))?
            .find(|a| super::downloads::public_ip(a.ip()))
            .ok_or_else(|| error("NTP服务器没有允许的公网地址"))?;
        let socket = UdpSocket::bind(if address.is_ipv4() {
            "0.0.0.0:0"
        } else {
            "[::]:0"
        })
        .await
        .map_err(|_| error("无法创建NTP套接字"))?;
        socket
            .connect(address)
            .await
            .map_err(|_| error("NTP连接失败"))?;
        let t1 = now_ms();
        let sent = request_timestamp(t1);
        let mut request = [0_u8; 48];
        request[0] = 0x23;
        request[40..48].copy_from_slice(&sent);
        socket
            .send(&request)
            .await
            .map_err(|_| error("NTP发送失败"))?;
        let mut response = [0_u8; 512];
        let length = socket
            .recv(&mut response)
            .await
            .map_err(|_| error("NTP接收失败"))?;
        let t4 = now_ms();
        let (offset, delay, time, stratum) = parse_ntp(&response[..length], sent, t1, t4)?;
        Ok(NtpResult {
            token: uuid::Uuid::new_v4().to_string(),
            server: server.into(),
            local_time_ms: t4,
            server_time_ms: time,
            offset_ms: offset,
            delay_ms: delay,
            stratum,
        })
    };
    tokio::time::timeout(Duration::from_secs(5), query)
        .await
        .map_err(|_| error("NTP查询超时，UDP123可能不可达，请切换服务器"))?
}
pub async fn apply_time(root: &Path, probe: Probe) -> Result<serde_json::Value> {
    if probe.measured.elapsed() > Duration::from_secs(60) {
        return Err(error("检测结果已过期，请重新查询"));
    }
    if probe.offset_ms.abs() > 86_400_000.0 {
        return Err(error("偏差超过一天，请先手动核对系统日期"));
    }
    let fresh = query_ntp(&probe.server).await?;
    if fresh.offset_ms.abs() > 86_400_000.0 {
        return Err(error("校时偏差超过一天，已停止"));
    }
    platform::run(
        root,
        "clock",
        &[format!("{:.3}", fresh.offset_ms)],
        Duration::from_secs(20),
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_ntp_request_binding_and_era() -> Result<()> {
        let t1 = 2_200_000_000_000.0;
        let sent = request_timestamp(t1);
        let mut response = [0_u8; 48];
        response[0] = 0x24;
        response[1] = 2;
        response[24..32].copy_from_slice(&sent);
        response[32..40].copy_from_slice(&request_timestamp(t1 + 110.0));
        response[40..48].copy_from_slice(&request_timestamp(t1 + 120.0));
        let (offset, delay, _, _) = parse_ntp(&response, sent, t1, t1 + 40.0)?;
        assert!((offset - 95.0).abs() < 0.01);
        assert!((delay - 30.0).abs() < 0.01);
        response[24] = response[24].wrapping_add(1);
        assert!(parse_ntp(&response, sent, t1, t1 + 40.0).is_err());
        Ok(())
    }
    #[test]
    fn rejects_unsynced_and_kiss_of_death() {
        let mut response = [0_u8; 48];
        let sent = [1_u8; 8];
        response[24..32].copy_from_slice(&sent);
        response[0] = 0xe4;
        response[1] = 2;
        assert!(parse_ntp(&response, sent, 0.0, 1.0).is_err());
        response[0] = 0x24;
        response[1] = 0;
        assert!(parse_ntp(&response, sent, 0.0, 1.0).is_err());
    }
}
