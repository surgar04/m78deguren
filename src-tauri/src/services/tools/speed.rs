//! 有界并行 HTTP 测速。固定节点、共享连接池、明确流量上限；测量字节不落盘。
use super::{Result, error, network::now_ms};
use serde::Serialize;
use std::{
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};
use tokio::{sync::Mutex, task::JoinSet};
use tokio_util::sync::CancellationToken;

#[derive(Clone, Copy)]
struct Node {
    id: &'static str,
    name: &'static str,
    down: &'static str,
    ping: &'static str,
    up: &'static str,
}
const NODES: [Node; 4] = [
    Node {
        id: "cloudflare",
        name: "Cloudflare",
        down: "https://speed.cloudflare.com/__down",
        ping: "https://speed.cloudflare.com/__down?bytes=0",
        up: "https://speed.cloudflare.com/__up",
    },
    Node {
        id: "nuaa",
        name: "南京航空航天大学（HTTP）",
        down: "http://speed.nuaa.edu.cn/backend/garbage.php",
        ping: "http://speed.nuaa.edu.cn/backend/empty.php",
        up: "http://speed.nuaa.edu.cn/backend/empty.php",
    },
    Node {
        id: "zju",
        name: "浙江大学（HTTP；上传南航）",
        down: "http://speedtest.zju.edu.cn/garbage.php",
        ping: "http://speedtest.zju.edu.cn/empty.php",
        up: "http://speed.nuaa.edu.cn/backend/empty.php",
    },
    Node {
        id: "ustc",
        name: "中国科学技术大学（上传南航）",
        down: "https://test.ustc.edu.cn/backend/garbage.php",
        ping: "https://test.ustc.edu.cn/backend/empty.php",
        up: "http://speed.nuaa.edu.cn/backend/empty.php",
    },
];
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Point {
    pub seconds: f64,
    pub mbps: f64,
    pub phase: String,
}
#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeedSnapshot {
    pub running: bool,
    pub phase: String,
    pub latency_ms: Option<f64>,
    pub jitter_ms: Option<f64>,
    pub failure_percent: Option<f64>,
    pub download_mbps: Option<f64>,
    pub upload_mbps: Option<f64>,
    pub transferred: u64,
    pub message: String,
    pub captured_at: Option<f64>,
    pub node: String,
    pub connections: u32,
    pub series: Vec<Point>,
}
#[derive(Default)]
pub struct SpeedService {
    snapshot: Mutex<SpeedSnapshot>,
    cancellation: Mutex<Option<CancellationToken>>,
}
impl SpeedService {
    pub async fn snapshot(&self) -> SpeedSnapshot {
        self.snapshot.lock().await.clone()
    }
    pub async fn stop(&self) {
        if let Some(token) = self.cancellation.lock().await.as_ref() {
            token.cancel();
        }
    }
    pub async fn start(
        self: &Arc<Self>,
        client: reqwest::Client,
        node: Option<String>,
        connections: Option<u32>,
    ) -> Result<()> {
        let node = node.unwrap_or_else(|| "cloudflare".into());
        let node = *NODES
            .iter()
            .find(|value| value.id == node)
            .ok_or_else(|| error("测速节点不在白名单中"))?;
        let connections = connections.unwrap_or(4);
        if ![1, 4, 8].contains(&connections) {
            return Err(error("并发连接数必须为 1、4 或 8"));
        }
        let mut current = self.cancellation.lock().await;
        if current.is_some() {
            return Err(error("已有测速任务正在运行或停止"));
        }
        let cancel = CancellationToken::new();
        *current = Some(cancel.clone());
        drop(current);
        *self.snapshot.lock().await = SpeedSnapshot {
            running: true,
            phase: "latency".into(),
            message: format!("正在连接 {}", node.name),
            node: node.id.into(),
            connections,
            ..SpeedSnapshot::default()
        };
        let service = self.clone();
        tokio::spawn(async move {
            let result = tokio::select! {_=cancel.cancelled()=>Err(error("测速已停止")),result=service.run(client,node,connections)=>result};
            {
                let mut value = service.snapshot.lock().await;
                value.running = false;
                value.captured_at = Some(now_ms());
                match result {
                    Ok(()) => {
                        value.phase = "complete".into();
                        value.message = format!("{} 测试完成；反映该节点 HTTP 链路", node.name);
                    }
                    Err(cause) => {
                        value.phase = if cancel.is_cancelled() {
                            "stopped"
                        } else {
                            "failed"
                        }
                        .into();
                        value.message = cause.to_string();
                    }
                }
            }
            *service.cancellation.lock().await = None;
        });
        Ok(())
    }
    async fn run(&self, client: reqwest::Client, node: Node, connections: u32) -> Result<()> {
        let mut delays = Vec::new();
        let mut failed = 0;
        for _ in 0..5 {
            let start = Instant::now();
            let probe = async {
                let response = client
                    .get(node.ping)
                    .header("Cache-Control", "no-cache")
                    .timeout(Duration::from_secs(6))
                    .send()
                    .await
                    .map_err(|_| ())?;
                if !response.status().is_success() {
                    return Err(());
                }
                let mut response = response;
                let mut bytes = 0;
                while let Some(chunk) = response.chunk().await.map_err(|_| ())? {
                    bytes += chunk.len();
                    if bytes > 65536 {
                        return Err(());
                    }
                }
                Ok(())
            };
            if probe.await.is_ok() {
                delays.push(start.elapsed().as_secs_f64() * 1000.0);
            } else {
                failed += 1;
            }
        }
        {
            let mut value = self.snapshot.lock().await;
            value.failure_percent = Some(f64::from(failed) * 20.0);
            value.jitter_ms = jitter(&delays);
            let mut sorted = delays.clone();
            sorted.sort_by(f64::total_cmp);
            value.latency_ms = sorted.get(sorted.len() / 2).copied();
        }
        if delays.is_empty() {
            return Err(error(
                "所选节点 5 次 HTTP 探测均失败，请切换节点；没有使用模拟延迟",
            ));
        }
        for upload in [false, true] {
            let phase = if upload { "upload" } else { "download" };
            let baseline = self.snapshot.lock().await.transferred;
            let counter = Arc::new(AtomicU64::new(0));
            let mut tasks = JoinSet::new();
            let each = if upload {
                4_194_304 / connections
            } else {
                33_554_432 / connections
            };
            {
                let mut value = self.snapshot.lock().await;
                value.phase = phase.into();
                value.message = if upload {
                    "正在测量服务器确认的上传吞吐"
                } else {
                    "正在测量实际下载吞吐"
                }
                .into();
            }
            let start = Instant::now();
            for index in 0..connections {
                let client = client.clone();
                let counter = counter.clone();
                tasks.spawn(async move {
                    let mut response = if upload {
                        client
                            .post(node.up)
                            .header("Content-Type", "application/octet-stream")
                            .body(vec![0; each as usize])
                            .timeout(Duration::from_secs(12))
                            .send()
                            .await
                    } else {
                        client
                            .get(node.down)
                            .query(&[
                                ("bytes", each.to_string()),
                                ("ckSize", "32".into()),
                                ("zhenjing", format!("{}-{index}", now_ms())),
                            ])
                            .header("Cache-Control", "no-cache")
                            .timeout(Duration::from_secs(10))
                            .send()
                            .await
                    }
                    .map_err(|_| error("测速连接失败"))?;
                    if !response.status().is_success() {
                        return Err(error(format!(
                            "测速节点 HTTP {}",
                            response.status().as_u16()
                        )));
                    }
                    let mut received = 0_u64;
                    while let Some(chunk) =
                        response.chunk().await.map_err(|_| error("测速响应中断"))?
                    {
                        if upload {
                            received += chunk.len() as u64;
                            if received > 65536 {
                                return Err(error("上传确认响应过大"));
                            }
                        } else {
                            let count = (chunk.len() as u64).min(u64::from(each) - received);
                            received += count;
                            counter.fetch_add(count, Ordering::Relaxed);
                            if received >= u64::from(each) {
                                break;
                            }
                        }
                    }
                    if upload {
                        counter.fetch_add(u64::from(each), Ordering::Relaxed);
                    } else if received == 0 {
                        return Err(error("节点未返回测试字节"));
                    }
                    Ok::<(), crate::error::AppError>(())
                });
            }
            let mut errors = 0;
            let mut ticker = tokio::time::interval(Duration::from_millis(250));
            while !tasks.is_empty() {
                tokio::select! {result=tasks.join_next()=>{if !matches!(result,Some(Ok(Ok(())))){errors+=1;}},_=ticker.tick()=>{self.progress(phase,start,baseline,counter.load(Ordering::Relaxed)).await;},_=tokio::time::sleep_until(tokio::time::Instant::from_std(start+Duration::from_secs(if upload{13}else{8})))=>{tasks.abort_all();break;}}
            }
            tasks.shutdown().await;
            let bytes = counter.load(Ordering::Relaxed);
            self.progress(phase, start, baseline, bytes).await;
            if bytes == 0 {
                return Err(error(if upload {
                    "上传未获得服务器确认；已保留实际下载结果"
                } else {
                    "没有收到下载字节，请切换节点"
                }));
            }
            if errors > 0 {
                let mut value = self.snapshot.lock().await;
                value.message = format!("{errors} 个连接失败，保留实际成功连接的测量值");
            }
        }
        Ok(())
    }
    async fn progress(&self, phase: &str, start: Instant, baseline: u64, bytes: u64) {
        let seconds = start.elapsed().as_secs_f64().max(0.001);
        let mbps = bytes as f64 * 8.0 / seconds / 1_000_000.0;
        let mut value = self.snapshot.lock().await;
        if bytes > 0 {
            if phase == "download" {
                value.download_mbps = Some(mbps);
            } else {
                value.upload_mbps = Some(mbps);
            }
        }
        value.transferred = baseline + bytes;
        if value.series.len() < 112 {
            value.series.push(Point {
                seconds,
                mbps,
                phase: phase.into(),
            });
        }
    }
}
fn jitter(values: &[f64]) -> Option<f64> {
    if values.len() < 2 {
        return None;
    }
    Some(
        values
            .windows(2)
            .map(|pair| (pair[0] - pair[1]).abs())
            .sum::<f64>()
            / (values.len() - 1) as f64,
    )
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn jitter_uses_ordered_successful_samples() {
        assert_eq!(jitter(&[]), None);
        assert_eq!(jitter(&[10.0]), None);
        assert_eq!(jitter(&[10.0, 30.0, 20.0]), Some(15.0));
    }
}
