//! 蓝屏证据分析：只读转储头与事件；用户态异常码和内核 BugCheck 分开，绝不冒充符号栈分析。
use super::{Result, ToolsState, error, platform};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    io::{Read, Seek, SeekFrom},
    path::PathBuf,
    time::Duration,
};

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Header {
    pub format: String,
    pub code_kind: String,
    pub code: Option<u32>,
    pub parameters: Vec<String>,
    pub exception_address: Option<String>,
    pub architecture: Option<String>,
    pub os_version: Option<String>,
    pub processors: Option<u32>,
    pub note: String,
}
fn u32_at(bytes: &[u8], offset: usize) -> Result<u32> {
    let value = bytes
        .get(offset..offset + 4)
        .ok_or_else(|| error("转储结构被截断"))?;
    Ok(u32::from_le_bytes([value[0], value[1], value[2], value[3]]))
}
fn u64_at(bytes: &[u8], offset: usize) -> Result<u64> {
    let value = bytes
        .get(offset..offset + 8)
        .ok_or_else(|| error("转储结构被截断"))?;
    Ok(u64::from_le_bytes(
        value.try_into().map_err(|_| error("转储参数无效"))?,
    ))
}
fn range<R: Read + Seek>(reader: &mut R, total: u64, offset: u64, count: usize) -> Result<Vec<u8>> {
    if count > 65536
        || offset
            .checked_add(count as u64)
            .is_none_or(|end| end > total)
    {
        return Err(error("转储流越过文件边界"));
    }
    reader
        .seek(SeekFrom::Start(offset))
        .map_err(|_| error("无法定位转储结构"))?;
    let mut bytes = vec![0; count];
    reader
        .read_exact(&mut bytes)
        .map_err(|_| error("转储流读取不完整"))?;
    Ok(bytes)
}
fn architecture(machine: u32) -> String {
    match machine {
        0 | 0x014c => "x86",
        9 | 0x8664 => "AMD64",
        12 | 0xaa64 => "ARM64",
        5 | 0x01c0 => "ARM",
        _ => "未知架构",
    }
    .into()
}
pub fn parse<R: Read + Seek>(reader: &mut R, total: u64) -> Result<Header> {
    let head = range(reader, total, 0, 32)?;
    let mut result = Header::default();
    if head.get(..4) == Some(b"MDMP") {
        result.format = "MDMP".into();
        result.code_kind = "user-exception".into();
        let count = u32_at(&head, 8)? as usize;
        let offset = u32_at(&head, 12)?;
        if count > 4096 {
            return Err(error("转储流数量超过安全上限"));
        }
        let directory = range(reader, total, u64::from(offset), count * 12)?;
        for item in directory.chunks_exact(12) {
            let kind = u32_at(item, 0)?;
            let size = u32_at(item, 4)? as usize;
            let offset = u32_at(item, 8)?;
            if kind == 6 {
                if size < 168 {
                    return Err(error("异常流结构不完整"));
                }
                let data = range(reader, total, u64::from(offset), 168)?;
                result.code = Some(u32_at(&data, 8)?);
                result.exception_address = Some(format!("0x{:016X}", u64_at(&data, 24)?));
                let count = u32_at(&data, 32)? as usize;
                if count > 15 {
                    return Err(error("异常参数数量无效"));
                }
                result.parameters = (0..count)
                    .map(|index| {
                        u64_at(&data, 40 + index * 8).map(|value| format!("0x{value:016X}"))
                    })
                    .collect::<Result<_>>()?;
            } else if kind == 7 {
                if size < 24 {
                    return Err(error("系统信息流结构不完整"));
                }
                let data = range(reader, total, u64::from(offset), 24)?;
                result.architecture = Some(architecture(u32_at(&data, 0)? & 0xffff));
                result.processors = data.get(6).copied().map(u32::from);
                result.os_version = Some(format!(
                    "{}.{}.{}",
                    u32_at(&data, 8)?,
                    u32_at(&data, 12)?,
                    u32_at(&data, 16)?
                ));
            }
        }
        result.note = "用户态 MINIDUMP 异常记录，异常码不等同于内核蓝屏代码。".into();
    } else if head.get(..4) == Some(b"PAGE") {
        let is64 = match head.get(4..8) {
            Some(value) if value == b"DU64" => true,
            Some(value) if value == b"DUMP" => false,
            _ => return Err(error("未知内核转储版本")),
        };
        let data = range(reader, total, 0, if is64 { 96 } else { 64 })?;
        result.format = if is64 { "PAGE/DU64" } else { "PAGE/DUMP" }.into();
        result.code_kind = "kernel-bugcheck".into();
        let code = u32_at(&data, if is64 { 56 } else { 40 })?;
        result.code = if code == 0 { None } else { Some(code) };
        result.architecture = Some(architecture(u32_at(&data, if is64 { 48 } else { 32 })?));
        result.processors = Some(u32_at(&data, if is64 { 52 } else { 36 })?);
        result.os_version = Some(format!("{}.{}", u32_at(&data, 8)?, u32_at(&data, 12)?));
        result.parameters = (0..4)
            .map(|index| {
                let value = if is64 {
                    u64_at(&data, 64 + index * 8)?
                } else {
                    u64::from(u32_at(&data, 44 + index * 4)?)
                };
                Ok(format!("0x{value:016X}"))
            })
            .collect::<Result<_>>()?;
        if code == 0 {
            result.note =
                "转储头中没有 BugCheck；可能为 LiveKernel 诊断，不能直接认定发生蓝屏。".into();
        }
    } else {
        return Err(error(
            "不支持的转储格式，仅解析 MDMP 和 Windows PAGE 转储头",
        ));
    }
    Ok(result)
}
fn code_name(code: u32) -> &'static str {
    match code {
        0x0a => "IRQL_NOT_LESS_OR_EQUAL",
        0x1a => "MEMORY_MANAGEMENT",
        0x3b => "SYSTEM_SERVICE_EXCEPTION",
        0x50 => "PAGE_FAULT_IN_NONPAGED_AREA",
        0x7b => "INACCESSIBLE_BOOT_DEVICE",
        0x9f => "DRIVER_POWER_STATE_FAILURE",
        0xd1 => "DRIVER_IRQL_NOT_LESS_OR_EQUAL",
        0xef => "CRITICAL_PROCESS_DIED",
        0x101 => "CLOCK_WATCHDOG_TIMEOUT",
        0x116 => "VIDEO_TDR_FAILURE",
        0x124 => "WHEA_UNCORRECTABLE_ERROR",
        0x133 => "DPC_WATCHDOG_VIOLATION",
        0x139 => "KERNEL_SECURITY_CHECK_FAILURE",
        _ => "未收录的 BugCheck",
    }
}
fn time(value: &serde_json::Value) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(value.as_str()?)
        .ok()
        .map(|value| value.timestamp_millis())
}
fn event_code(event: &serde_json::Value) -> Option<u32> {
    if event["id"].as_u64() == Some(41) {
        return event["data"]["BugcheckCode"]
            .as_str()?
            .parse::<u32>()
            .ok()
            .filter(|value| *value != 0);
    }
    if event["id"].as_u64() != Some(1001)
        || !event["provider"].as_str().is_some_and(|provider| {
            provider.contains("WER-SystemErrorReporting")
                || provider.eq_ignore_ascii_case("BugCheck")
        })
    {
        return None;
    }
    let message = event["message"].as_str()?;
    let start = message.to_ascii_lowercase().find("0x")? + 2;
    let text: String = message
        .get(start..)?
        .chars()
        .take_while(char::is_ascii_hexdigit)
        .take(8)
        .collect();
    u32::from_str_radix(&text, 16)
        .ok()
        .filter(|value| *value != 0)
}
fn analyze(value: &mut serde_json::Value) {
    let events = value["events"].as_array().cloned().unwrap_or_default();
    let mut crashes = Vec::new();
    for event in &events {
        let code = event_code(event);
        if code.is_none() && event["id"].as_u64() != Some(41) && event["id"].as_u64() != Some(6008)
        {
            continue;
        }
        // 同次蓝屏可能同时写入 Kernel-Power 和 WER；按代码及两分钟窗口合并，保留证据索引。
        if code.is_some() && crashes.iter().any(|other:&serde_json::Value|other["code"].as_u64()==code.map(u64::from)&&matches!((time(&event["time"]),time(&other["time"])),(Some(a),Some(b))if(a-b).unsigned_abs()<=120000)){continue;}
        let related:Vec<_>=events.iter().enumerate().filter(|(_,other)|matches!((time(&event["time"]),time(&other["time"])),(Some(a),Some(b))if(a-b).unsigned_abs()<=600000)).map(|(index,_)|index).collect();
        crashes.push(serde_json::json!({"time":event["time"],"code":code,"name":code.map(code_name),"source":event["provider"],"eventId":event["id"],"kind":if code.is_some(){"bugcheck"}else{"unexpected-shutdown"},"related":related}));
    }
    let mut findings = Vec::new();
    for (ids, providers, title, advice) in [
        (
            vec![18, 19],
            vec!["whea"],
            "发现 WHEA 硬件错误事件",
            "结合事件中的硬件组件信息、最近的 BIOS/超频变更及厂商诊断核实；事件本身不能单独判定故障部件。",
        ),
        (
            vec![7, 51, 55, 129, 153, 157],
            vec!["disk", "ntfs", "stor"],
            "发现存储或文件系统相关事件",
            "检查对应磁盘的可靠性信息、连接和存储驱动；重要数据先备份，避免直接执行破坏性修复。",
        ),
        (
            vec![161, 46],
            vec!["volmgr"],
            "发现转储初始化或写入问题",
            "核对崩溃转储配置、分页文件、空间和权限；缺少转储不代表没有发生异常。",
        ),
    ] {
        let matches: Vec<_> = events
            .iter()
            .enumerate()
            .filter(|(_, event)| {
                event["id"].as_u64().is_some_and(|id| ids.contains(&id))
                    && providers.iter().any(|provider| {
                        event["provider"]
                            .as_str()
                            .unwrap_or_default()
                            .to_ascii_lowercase()
                            .contains(provider)
                    })
            })
            .map(|(index, _)| index)
            .collect();
        if !matches.is_empty() {
            findings.push(serde_json::json!({"title":title,"confidence":"中","evidence":format!("近 30 天匹配 {} 条事件",matches.len()),"suggestion":advice,"events":matches}));
        }
    }
    value["timeline"] = serde_json::Value::Array(crashes);
    value["findings"] = serde_json::Value::Array(findings);
}
pub async fn scan(state: &ToolsState) -> Result<serde_json::Value> {
    let raw = platform::run(&state.root, "crashes", &[], Duration::from_secs(50)).await?;
    let (value, files) = tauri::async_runtime::spawn_blocking(move || -> Result<_> {
        let mut value = raw;
        let mut files = HashMap::new();
        if let Some(dumps) = value["dumps"].as_array_mut() {
            for dump in dumps {
                let path =
                    PathBuf::from(dump["path"].as_str().ok_or_else(|| error("转储路径缺失"))?);
                if !path.is_absolute()
                    || path
                        .components()
                        .any(|part| matches!(part, std::path::Component::ParentDir))
                    || !path
                        .extension()
                        .is_some_and(|ext| ext.eq_ignore_ascii_case("dmp"))
                {
                    return Err(error("系统转储路径无效"));
                }
                let id = format!("{:x}", Sha256::digest(path.to_string_lossy().as_bytes()));
                let header = std::fs::File::open(&path)
                    .map_err(|_| error("转储不可读，请检查文件权限或占用"))
                    .and_then(|mut file| {
                        let total = file
                            .metadata()
                            .map_err(|_| error("无法读取转储大小"))?
                            .len();
                        parse(&mut file, total)
                    })
                    .unwrap_or_else(|cause| Header {
                        format: "unavailable".into(),
                        note: cause.to_string(),
                        ..Header::default()
                    });
                dump["id"] = serde_json::Value::String(id.clone());
                dump["header"] =
                    serde_json::to_value(header).map_err(|_| error("转储头序列化失败"))?;
                files.insert(id, path);
            }
        }
        analyze(&mut value);
        Ok((value, files))
    })
    .await
    .map_err(|_| error("转储解析任务异常"))??;
    *state.crash_files.lock().await = files;
    Ok(value)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn distinguishes_32_and_64_bit_kernel_headers() -> Result<()> {
        for is64 in [false, true] {
            let mut bytes = vec![0; 128];
            bytes[..4].copy_from_slice(b"PAGE");
            bytes[4..8].copy_from_slice(if is64 { b"DU64" } else { b"DUMP" });
            let code = if is64 { 56 } else { 40 };
            bytes[code..code + 4].copy_from_slice(&0x124_u32.to_le_bytes());
            let parameter = if is64 { 64 } else { 44 };
            bytes[parameter..parameter + 4].copy_from_slice(&7_u32.to_le_bytes());
            let header = parse(&mut std::io::Cursor::new(&bytes), bytes.len() as u64)?;
            assert_eq!(header.code, Some(0x124));
            assert_eq!(
                header.parameters.first().map(String::as_str),
                Some("0x0000000000000007")
            );
        }
        Ok(())
    }
    #[test]
    fn rejects_out_of_bounds_stream_directory() {
        let mut bytes = vec![0; 64];
        bytes[..4].copy_from_slice(b"MDMP");
        bytes[8..12].copy_from_slice(&1_u32.to_le_bytes());
        bytes[12..16].copy_from_slice(&u32::MAX.to_le_bytes());
        assert!(parse(&mut std::io::Cursor::new(&bytes), 64).is_err());
    }
    #[test]
    fn kernel_power_without_bugcheck_is_not_a_bluescreen() {
        let value = serde_json::json!({"id":41,"data":{"BugcheckCode":"0"}});
        assert_eq!(event_code(&value), None);
    }
}
