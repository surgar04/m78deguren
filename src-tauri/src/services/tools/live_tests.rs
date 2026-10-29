//! 显式手动执行的只读联网验收；常规测试不依赖公网、不修改时钟、不执行安装器。
use super::{Result, downloads, network, platform, runtime, save_json, test_root};
use std::time::Duration;

#[test]
#[ignore = "需要当前Windows及公网，仅通过 --ignored 手动执行"]
fn live_windows_and_official_sources() -> Result<()> {
    tauri::async_runtime::block_on(async {
        let root = test_root("live")?;
        let client = downloads::http_client()?;
        let packages = futures_util::future::join_all(runtime::PACKAGES.iter().map(|package| {
            let client = client.clone();
            async move {
                let result = client.get(package.url).header("Range","bytes=0-0").timeout(Duration::from_secs(25)).send().await;
                match result {
                    Ok(response) => serde_json::json!({"id":package.id,"url":package.url,"status":response.status().as_u16(),"finalUrl":response.url().as_str(),"passed":response.status().is_success()}),
                    Err(cause) => serde_json::json!({"id":package.id,"passed":false,"error":cause.to_string()}),
                }
            }
        })).await;
        let mut windows = serde_json::Map::new();
        for operation in ["admin", "runtimes", "crashes", "display"] {
            let result = platform::run(&root, operation, &[], Duration::from_secs(45)).await;
            windows.insert(
                operation.into(),
                match result {
                    Ok(value) => serde_json::json!({"passed":true,"data":value}),
                    Err(cause) => serde_json::json!({"passed":false,"error":cause.to_string()}),
                },
            );
        }
        let ntp = futures_util::future::join_all(network::NTP_SERVERS.iter().map(
            |(id, _, _)| async move {
                match network::query_ntp(id).await {
                    Ok(value) => serde_json::json!({"passed":true,"data":value}),
                    Err(cause) => {
                        serde_json::json!({"id":id,"passed":false,"error":cause.to_string()})
                    }
                }
            },
        ))
        .await;
        let latency = client
            .get("https://speed.cloudflare.com/__down?bytes=0")
            .timeout(Duration::from_secs(20))
            .send()
            .await;
        let latency = match latency {
            Ok(value) => {
                serde_json::json!({"status":value.status().as_u16(),"passed":value.status().is_success()})
            }
            Err(cause) => serde_json::json!({"passed":false,"error":cause.to_string()}),
        };
        let report = serde_json::json!({"packages":packages,"windows":windows,"ntp":ntp,"speedEndpoint":latency});
        save_json(&root.join("live-results.json"), &report).await?;
        println!(
            "真实联网及Windows证据：{}",
            root.join("live-results.json").display()
        );
        assert!(
            windows.values().all(|entry| entry["passed"] == true),
            "Windows只读探测失败，见证据"
        );
        assert!(
            packages.iter().all(|entry| entry["passed"] == true),
            "官方安装包连接失败，见证据"
        );
        Ok(())
    })
}
