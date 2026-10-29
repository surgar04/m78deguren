//! 壁纸视频只读校验。导入时由 Windows 读取真实媒体属性，Rust 再执行时长边界检查。
use crate::services::tools::{Result, ensure_local_path, error, platform};
use serde::Deserialize;
use std::{path::Path, time::Duration};

/// Windows TimeSpan 使用 100ns 刻度；整数比较确保恰好 15 秒可用，超过一刻度即拒绝。
const MAX_DURATION_TICKS: u64 = 150_000_000;
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Properties {
    width: u32,
    height: u32,
    ticks: u64,
}
fn check(properties: &Properties) -> Result<()> {
    if properties.width == 0 || properties.height == 0 || properties.ticks == 0 {
        return Err(error(
            "视频没有有效画面或可读取的时长，请重新导出 MP4 / WebM",
        ));
    }
    if properties.ticks > MAX_DURATION_TICKS {
        return Err(error(
            "视频背景最长为 15 秒，请裁剪后重新上传；当前背景未更改",
        ));
    }
    Ok(())
}
pub async fn validate(root: &Path, path: &Path) -> Result<()> {
    ensure_local_path(path)?;
    let path = path.to_str().ok_or_else(|| error("视频暂存路径无效"))?;
    let value = platform::run_embedded(
        root,
        "settings-video-probe",
        &[path.to_owned()],
        Duration::from_secs(25),
        include_str!("video.ps1"),
    )
    .await?;
    let properties: Properties = serde_json::from_value(value)
        .map_err(|_| error("无法读取可靠的视频时长，请选择完整的 MP4 / WebM"))?;
    check(&properties)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn duration_is_positive_and_at_most_fifteen_seconds() {
        let properties = |ticks| Properties {
            width: 320,
            height: 180,
            ticks,
        };
        assert!(check(&properties(1)).is_ok());
        assert!(check(&properties(MAX_DURATION_TICKS)).is_ok());
        assert!(check(&properties(0)).is_err());
        assert!(check(&properties(MAX_DURATION_TICKS + 1)).is_err());
        assert!(
            check(&Properties {
                width: 0,
                ..properties(1)
            })
            .is_err()
        );
    }
}
