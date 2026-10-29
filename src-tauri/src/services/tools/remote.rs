//! 官方只读数据源。固定 HTTPS 地址、有界响应、超时与应用缓存，网络失败不伪造版本列表。
use super::{Result, ToolsState, error, io_error, save_json};
use futures_util::{StreamExt, stream};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::Path,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

fn allowed_source_host(host: &str) -> bool {
    // NVIDIA 全球端点在中国网络会跳转到此区域端点；只放行确切主机，不使用后缀匹配。
    matches!(
        host,
        "gfwsl.geforce.com" | "gfwsl.geforce.cn" | "raw.githubusercontent.com" | "i.elaina.vin"
    )
}

async fn fetch(client: &reqwest::Client, url: &str) -> Result<Vec<u8>> {
    let mut response = client
        .get(url)
        .timeout(Duration::from_secs(25))
        .send()
        .await
        .map_err(|cause| {
            log::warn!("官方源请求失败：{cause}");
            error("官方数据源暂时无法连接，请稍后刷新")
        })?
        .error_for_status()
        .map_err(|cause| {
            log::warn!("官方源 HTTP 状态异常：{cause}");
            error("官方数据源返回错误状态")
        })?;
    let host = response.url().host_str().unwrap_or_default();
    if !allowed_source_host(host) {
        return Err(error("官方源重定向到了未授权域名"));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|cause| {
        log::warn!("官方响应接收中断：{cause}");
        error("官方响应接收中断，请重试")
    })? {
        if bytes.len() + chunk.len() > 4_194_304 {
            return Err(error("官方响应超过大小上限"));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Password {
    pub name: String,
    pub password: String,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Passwords {
    pub items: Vec<Password>,
    pub fetched_at: u64,
    pub source: String,
}
pub async fn delta_passwords(state: &ToolsState) -> Result<Passwords> {
    let path = state.root.join("delta-passwords.json");
    super::check_local_path(&path).await?;
    if let Ok(bytes) = tokio::fs::read(&path).await
        && bytes.len() < 16384
        && let Ok(value) = serde_json::from_slice::<Passwords>(&bytes)
        && (now() + 28800) / 86400 == (value.fetched_at + 28800) / 86400
        && now().saturating_sub(value.fetched_at) < 300
    {
        return Ok(value);
    }
    let bytes = fetch(
        &state.http,
        "https://i.elaina.vin/api/%E4%B8%89%E8%A7%92%E6%B4%B2/%E5%AF%86%E7%A0%81/",
    )
    .await?;
    #[derive(Deserialize)]
    struct Api {
        status: String,
        data: Vec<Password>,
    }
    let response: Api =
        serde_json::from_slice(&bytes).map_err(|_| error("社区密码数据格式无效"))?;
    if response.status != "success"
        || response.data.is_empty()
        || response.data.len() > 12
        || response.data.iter().any(|row| {
            row.name.chars().count() > 40
                || row.name.chars().any(char::is_control)
                || row.password.len() != 4
                || !row.password.bytes().all(|v| v.is_ascii_digit())
        })
    {
        return Err(error("社区密码数据不完整，无法确认有效性"));
    }
    let value = Passwords {
        items: response.data,
        fetched_at: now(),
        source: "Elaina 社区接口（第三方）".into(),
    };
    save_json(&path, &value).await?;
    Ok(value)
}
fn decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut result = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%'
            && index + 2 < bytes.len()
            && let (Some(a), Some(b)) = (
                (bytes[index + 1] as char).to_digit(16),
                (bytes[index + 2] as char).to_digit(16),
            )
        {
            result.push((a * 16 + b) as u8);
            index += 3;
            continue;
        }
        result.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&result)
        .chars()
        .filter(|v| !v.is_control())
        .take(500)
        .collect()
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Driver {
    pub id: String,
    pub version: String,
    pub name: String,
    pub date: String,
    pub channel: String,
    pub detail_url: String,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriverHistory {
    pub updated_at: u64,
    pub drivers: Vec<Driver>,
    pub warnings: Vec<String>,
}
#[derive(Deserialize)]
struct ApiResponse {
    #[serde(rename = "IDS", default)]
    ids: Vec<ApiItem>,
}
#[derive(Deserialize)]
struct ApiItem {
    #[serde(rename = "downloadInfo")]
    info: ApiInfo,
}
#[derive(Deserialize)]
struct ApiInfo {
    #[serde(rename = "ID", default)]
    id: String,
    #[serde(rename = "Version", default)]
    version: String,
    #[serde(rename = "Name", default)]
    name: String,
    #[serde(rename = "ReleaseDateTime", default)]
    date: String,
    #[serde(rename = "IsCRD", default)]
    studio: String,
}

/// 只接纳官方返回的数字 ID 和版本；下载详情地址不能来自外部响应中的任意 URL。
fn parse_drivers(bytes: &[u8], laptop: bool) -> Result<Vec<Driver>> {
    let response: ApiResponse = serde_json::from_slice(bytes).map_err(|cause| {
        log::warn!("NVIDIA 驱动列表解析失败：{cause}");
        error("NVIDIA 返回的数据格式已变化")
    })?;
    Ok(response
        .ids
        .into_iter()
        .filter_map(|row| {
            let data = row.info;
            if data.id.is_empty()
                || data.id.len() > 12
                || !data.id.bytes().all(|value| value.is_ascii_digit())
                || data.version.is_empty()
                || data.version.len() > 32
                || !data
                    .version
                    .bytes()
                    .all(|value| value.is_ascii_digit() || value == b'.')
                || data.studio == "1"
            {
                return None;
            }
            Some(Driver {
                detail_url: format!(
                    "https://www.nvidia.cn/Download/driverResults.aspx/{}/zh-cn",
                    data.id
                ),
                id: data.id,
                version: data.version,
                name: decode(&data.name),
                date: decode(&data.date),
                channel: if laptop { "laptop" } else { "desktop" }.into(),
            })
        })
        .collect())
}

async fn driver_channel(
    client: &reqwest::Client,
    series: u16,
    product: u16,
    laptop: bool,
) -> Result<Vec<Driver>> {
    let url = format!(
        "https://gfwsl.geforce.com/services_toolkit/services/com/nvidia/services/AjaxDriverService.php?func=DriverManualLookup&psid={series}&pfid={product}&osID=57&languageID=1&dch=1&upCRD=0&qnf=0&sort1=0&numberOfResults=50&dltype=1"
    );
    // 只读 GET 遇到网络抖动最多重试一次；解析失败不重试，不掩盖上游格式变化。
    let bytes = match fetch(client, &url).await {
        Ok(bytes) => bytes,
        Err(cause) => {
            log::warn!("NVIDIA 渠道 {series}/{product} 首次查询失败：{cause}");
            tokio::time::sleep(Duration::from_millis(400)).await;
            fetch(client, &url).await?
        }
    };
    parse_drivers(&bytes, laptop)
}

pub async fn drivers(state: &ToolsState, refresh: bool) -> Result<DriverHistory> {
    let file = state.root.join("nvidia-driver-history.json");
    super::check_local_path(&file).await?;
    if !refresh
        && let Ok(bytes) = tokio::fs::read(&file).await
        && let Ok(history) = serde_json::from_slice::<DriverHistory>(&bytes)
        && now().saturating_sub(history.updated_at) < 900
    {
        return Ok(history);
    }
    // 新旧两代渠道覆盖历史版本，桌面与笔记本保持独立，不能按版本号拼造下载链接。
    let channels = [
        (131, 1066, false),
        (101, 845, false),
        (133, 1073, true),
        (102, 819, true),
    ];
    let results = stream::iter(channels)
        .map(|(series, product, laptop)| driver_channel(&state.http, series, product, laptop))
        .buffer_unordered(2)
        .collect::<Vec<_>>()
        .await;
    let mut rows = HashMap::new();
    let mut warnings = Vec::new();
    for result in results {
        match result {
            Ok(values) => {
                for row in values {
                    rows.entry(format!("{}:{}", row.channel, row.id))
                        .or_insert(row);
                }
            }
            Err(cause) => warnings.push(cause.to_string()),
        }
    }
    if rows.is_empty() {
        log::warn!("NVIDIA 驱动列表为空：{}", warnings.join("；"));
        warnings.sort();
        warnings.dedup();
        return Err(error(if warnings.is_empty() {
            "NVIDIA 官方源没有返回符合条件的 Game Ready 驱动".into()
        } else {
            format!("无法取得驱动列表：{}", warnings.join("；"))
        }));
    }
    let mut drivers: Vec<Driver> = rows.into_values().collect();
    drivers.sort_by_key(|row| std::cmp::Reverse(version(&row.version)));
    let history = DriverHistory {
        updated_at: now(),
        drivers,
        warnings,
    };
    save_json(&file, &history).await?;
    Ok(history)
}
fn version(value: &str) -> Vec<u32> {
    value
        .split('.')
        .filter_map(|part| part.parse().ok())
        .collect()
}

pub async fn dictionary(root: &Path) -> Result<HashMap<u32, String>> {
    let file = root.join("feature-dictionary.json");
    super::check_local_path(&file).await?;
    match tokio::fs::metadata(&file).await {
        Ok(meta) if meta.len() <= 4_194_304 => {
            let data = tokio::fs::read(file).await.map_err(io_error)?;
            serde_json::from_slice(&data).map_err(|_| error("功能名称字典损坏，请重新更新"))
        }
        Ok(_) => Err(error("功能字典超过大小上限")),
        Err(cause) if cause.kind() == std::io::ErrorKind::NotFound => Ok(HashMap::new()),
        Err(cause) => Err(io_error(cause)),
    }
}
pub async fn update_dictionary(state: &ToolsState) -> Result<usize> {
    let bytes = fetch(
        &state.http,
        "https://raw.githubusercontent.com/thebookisclosed/ViVe/master/Extra/FeatureDictionary.pfs",
    )
    .await?;
    let text = std::str::from_utf8(&bytes).map_err(|_| error("功能字典不是 UTF-8 文本"))?;
    let mut rows = HashMap::new();
    for line in text.lines().take(100_000) {
        if let Some((name, id)) = line.trim().rsplit_once(',')
            && let Ok(id) = id.parse::<u32>()
            && id > 0
            && !name.is_empty()
            && name.len() <= 512
            && !name.chars().any(char::is_control)
        {
            rows.insert(id, name.to_owned());
        }
    }
    if rows.len() < 1000 {
        return Err(error("官方功能字典内容异常，已保留原字典"));
    }
    save_json(&state.root.join("feature-dictionary.json"), &rows).await?;
    Ok(rows.len())
}
pub async fn prepare_audio_driver(state: &ToolsState) -> Result<()> {
    let directory = state.root.join("eq-driver");
    super::check_local_path(&directory).await?;
    tokio::fs::create_dir_all(&directory)
        .await
        .map_err(io_error)?;
    // 固定上游提交和 SHA256；不接受用户传来的安装 URL，也不运行未签名的设备管理辅助 EXE。
    for (name, hash) in [
        (
            "fxvad.inf",
            "b7049bfce3bd60ede027518785d3087c48f546e0ff082af634eb9d819c81d273",
        ),
        (
            "fxvad.sys",
            "425629b6309000013e8cd1a9b827bee365d21c9f743873aadd0c3bc96a999d2a",
        ),
        (
            "fxvadntamd64.cat",
            "25c8dae186155d20f74feedeb4f84161e4215925b8fd0c898f68f3e50ebcd7d",
        ),
    ] {
        use sha2::{Digest, Sha256};
        let file = directory.join(name);
        super::check_local_path(&file).await?;
        if tokio::fs::read(&file)
            .await
            .is_ok_and(|bytes| format!("{:x}", Sha256::digest(bytes)) == hash)
        {
            continue;
        }
        let url = format!(
            "https://raw.githubusercontent.com/fxsound2/fxsound-app/4383180e02ff435d191f71220e8da41f9fa06951/Installer/Drivers/Version14/win10/x64/{name}"
        );
        let bytes = fetch(&state.http, &url).await?;
        if format!("{:x}", Sha256::digest(&bytes)) != hash {
            return Err(error("官方音频驱动包哈希不匹配，已停止"));
        }
        tokio::fs::write(file, bytes).await.map_err(io_error)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    /// 公网检查显式启用；只查询官方元数据，结果和缓存写入独立 D 盘测试目录。
    #[test]
    #[ignore = "需要公网，仅通过 --ignored 手动执行"]
    fn live_official_driver_history() -> Result<()> {
        tauri::async_runtime::block_on(async {
            let root = super::super::test_root("official-drivers")?;
            let state = ToolsState::new(&root)?;
            let history = drivers(&state, true).await?;
            assert!(!history.drivers.is_empty());
            println!(
                "官方驱动真实记录：{}，证据：{}",
                history.drivers.len(),
                state.root.display()
            );
            Ok(())
        })
    }
    #[test]
    fn parses_external_text_without_html_execution() {
        assert_eq!(
            decode("Game%20Ready%20%E9%A9%B1%E5%8A%A8"),
            "Game Ready 驱动"
        );
        assert!(version("610.12") > version("599.99"));
    }
    #[test]
    fn driver_metadata_rejects_injected_ids_and_studio_rows() -> Result<()> {
        let bytes = br#"{"IDS":[{"downloadInfo":{"ID":"282412","Version":"621.01","Name":"Game%20Ready","IsCRD":"0"}},{"downloadInfo":{"ID":"282413","Version":"621.01","IsCRD":"1"}},{"downloadInfo":{"ID":"../bad","Version":"621.01"}}]}"#;
        let rows = parse_drivers(bytes, true)?;
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].name, "Game Ready");
        assert_eq!(rows[0].channel, "laptop");
        assert_eq!(
            rows[0].detail_url,
            "https://www.nvidia.cn/Download/driverResults.aspx/282412/zh-cn"
        );
        assert!(parse_drivers(br#"{"IDS":null}"#, false).is_err());
        Ok(())
    }
    #[test]
    fn official_region_redirect_does_not_allow_lookalike_hosts() {
        assert!(allowed_source_host("gfwsl.geforce.cn"));
        assert!(allowed_source_host("gfwsl.geforce.com"));
        assert!(!allowed_source_host("gfwsl.geforce.cn.example.com"));
        assert!(!allowed_source_host("geforce.cn"));
        assert!(!allowed_source_host("127.0.0.1"));
    }
}
