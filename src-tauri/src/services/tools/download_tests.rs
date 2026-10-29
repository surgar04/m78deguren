//! 真正使用本地HTTP服务验证Range、恢复、回退及哈希；生产DNS策略没有测试后门。
use super::downloads::*;
use super::{Result, error, io_error, test_root};
use sha2::{Digest, Sha256};
use std::{net::SocketAddr, sync::Arc, time::Duration};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};

fn client(address: SocketAddr) -> Result<reqwest::Client> {
    reqwest::Client::builder()
        .no_proxy()
        .resolve("fixture.invalid", address)
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|_| error("测试客户端创建失败"))
}
async fn fixture(
    ignore_segments: bool,
    empty: bool,
) -> Result<(SocketAddr, Vec<u8>, tokio::task::JoinHandle<()>)> {
    let content: Vec<u8> = (0..if empty { 0 } else { 2_097_152 })
        .map(|index| (index % 251) as u8)
        .collect();
    let data = Arc::new(content.clone());
    let listener = TcpListener::bind("127.0.0.1:0").await.map_err(io_error)?;
    let address = listener.local_addr().map_err(io_error)?;
    let handle = tokio::spawn(async move {
        while let Ok((mut stream, _)) = listener.accept().await {
            let data = data.clone();
            tokio::spawn(async move {
                let mut request = Vec::new();
                let mut buffer = [0; 1024];
                loop {
                    let Ok(length) = stream.read(&mut buffer).await else {
                        return;
                    };
                    if length == 0 || request.len() > 8192 {
                        return;
                    }
                    request.extend_from_slice(&buffer[..length]);
                    if request.windows(4).any(|part| part == b"\r\n\r\n") {
                        break;
                    }
                }
                let request = String::from_utf8_lossy(&request).to_ascii_lowercase();
                let range = request
                    .lines()
                    .find_map(|line| line.strip_prefix("range: bytes="));
                if data.is_empty() {
                    let response = if range.is_some() {
                        "HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */0\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                    } else {
                        "HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                    };
                    let _ = stream.write_all(response.as_bytes()).await;
                    return;
                }
                let range = if ignore_segments && range != Some("0-0") {
                    None
                } else {
                    range
                };
                let (start, end) = range
                    .and_then(|value| value.split_once('-'))
                    .and_then(|(start, end)| {
                        Some((start.parse::<usize>().ok()?, end.parse::<usize>().ok()?))
                    })
                    .unwrap_or((0, data.len() - 1));
                if start > end || end >= data.len() {
                    return;
                }
                let status = if range.is_some() {
                    "206 Partial Content"
                } else {
                    "200 OK"
                };
                let range_header = if range.is_some() {
                    format!("Content-Range: bytes {start}-{end}/{}\r\n", data.len())
                } else {
                    String::new()
                };
                let headers = format!(
                    "HTTP/1.1 {status}\r\nContent-Length: {}\r\n{range_header}ETag: \"stable-fixture-v1\"\r\nConnection: close\r\n\r\n",
                    end - start + 1
                );
                if stream.write_all(headers.as_bytes()).await.is_err() {
                    return;
                }
                for chunk in data[start..=end].chunks(16_384) {
                    if stream.write_all(chunk).await.is_err() {
                        return;
                    }
                    tokio::time::sleep(Duration::from_millis(2)).await;
                }
            });
        }
    });
    Ok((address, content, handle))
}
async fn finished(manager: &DownloadManager, id: &str) -> Result<DownloadTask> {
    tokio::time::timeout(Duration::from_secs(15), async {
        loop {
            let task = manager.task(id).await?;
            if matches!(
                task.status.as_str(),
                "complete" | "failed" | "paused" | "cancelled"
            ) {
                return Ok(task);
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .map_err(|_| error("下载测试超时"))?
}
#[test]
fn url_and_windows_filename_boundaries() -> Result<()> {
    for value in [
        "http://127.0.0.1/a",
        "http://[::1]/a",
        "https://10.1.2.3/a",
        "http://169.254.169.254/",
        "http://100.64.0.1/",
        "http://198.18.0.1/",
        "http://[::ffff:192.168.1.1]/",
        "file:///D:/test",
        "https://user:pass@example.com/a",
        "https://example.com/a#b",
    ] {
        assert!(validate_url(value).is_err(), "应拒绝 {value}");
    }
    assert!(validate_url("https://example.com/file?q=1").is_ok());
    for value in [
        "CON", "aux.exe", "com1.txt", "../x", "a/b", "a\\b", "x.", "x ", "a:b", "", "nul",
    ] {
        assert!(!valid_filename(value), "应拒绝 {value}");
    }
    assert!(valid_filename("游戏更新 1.2.3.zip"));
    Ok(())
}
#[test]
fn segmented_ranges_cover_resource_exactly_once() {
    for total in 1..500_u64 {
        for connections in 1..=8 {
            let ranges = split_ranges(total, connections);
            let mut position = 0;
            for (start, end) in ranges {
                assert_eq!(start, position);
                assert!(end.is_some_and(|end| end >= start));
                position = end.unwrap_or(0) + 1;
            }
            assert_eq!(position, total);
        }
    }
    assert_eq!(split_ranges(0, 8), vec![(0, None)]);
}
#[test]
fn trusted_download_stops_at_declared_size() -> Result<()> {
    tauri::async_runtime::block_on(async {
        let root = test_root("bounded-http")?;
        let (address, _, server) = fixture(false, false).await?;
        let client = client(address)?;
        let manager = Arc::new(DownloadManager::load(&root)?);
        let id = manager
            .create_bounded(
                DownloadInput {
                    url: format!("http://fixture.invalid:{}/file", address.port()),
                    file_name: "受限下载.bin".into(),
                    connections: 4,
                    limit_kib: 0,
                    expected_sha256: None,
                },
                client,
                Some(10),
            )
            .await?;
        let task = finished(&manager, &id).await?;
        assert_eq!(task.status, "failed");
        assert_eq!(task.downloaded, 0);
        assert!(!manager.final_path(&task).exists());
        server.abort();
        Ok(())
    })
}
#[test]
fn downloads_real_http_resume_fallback_and_checksum() -> Result<()> {
    tauri::async_runtime::block_on(async {
        for (ignore, hash_matches, pause, empty) in [
            (false, true, true, false),
            (true, true, false, false),
            (false, false, false, false),
            (false, true, false, true),
        ] {
            let root = test_root("http")?;
            let (address, data, server) = fixture(ignore, empty).await?;
            let client = client(address)?;
            let manager = Arc::new(DownloadManager::load(&root)?);
            let expected = if hash_matches {
                format!("{:x}", Sha256::digest(&data))
            } else {
                "0".repeat(64)
            };
            let id = manager
                .create(
                    DownloadInput {
                        url: format!("http://fixture.invalid:{}/file", address.port()),
                        file_name: "验收文件.bin".into(),
                        connections: 4,
                        limit_kib: if pause { 1024 } else { 0 },
                        expected_sha256: Some(expected.clone()),
                    },
                    client.clone(),
                )
                .await?;
            if pause {
                tokio::time::timeout(Duration::from_secs(5), async {
                    loop {
                        if manager.task(&id).await?.downloaded > 0 {
                            return Ok::<(), crate::error::AppError>(());
                        }
                        tokio::time::sleep(Duration::from_millis(10)).await;
                    }
                })
                .await
                .map_err(|_| error("未产生下载进度"))??;
                manager.control(&id, "pause", client.clone()).await?;
                assert_eq!(finished(&manager, &id).await?.status, "paused");
                let restored = Arc::new(DownloadManager::load(&root)?);
                restored.start(&id, client.clone()).await?;
                let task = finished(&restored, &id).await?;
                assert_eq!(task.status, "complete", "{}", task.message);
                assert_eq!(task.sha256.as_deref(), Some(expected.as_str()));
                assert_eq!(
                    tokio::fs::read(restored.final_path(&task))
                        .await
                        .map_err(io_error)?,
                    data
                );
                assert!(restored.control(&id, "cancel", client).await.is_err());
            } else {
                let task = finished(&manager, &id).await?;
                assert_eq!(
                    task.status,
                    if hash_matches { "complete" } else { "failed" },
                    "{}",
                    task.message
                );
                if hash_matches {
                    assert_eq!(
                        tokio::fs::read(manager.final_path(&task))
                            .await
                            .map_err(io_error)?,
                        data
                    );
                } else {
                    assert!(!manager.final_path(&task).exists());
                }
            }
            server.abort();
        }
        Ok(())
    })
}
