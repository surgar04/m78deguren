//! ICC 只用于校准曲线交换，不声称完成显示器测量或安装系统色彩配置。
//! 所有偏移和长度均在当前 tag 切片内检查，畸形文件不能越界读取。
use super::{Result, error};
fn u16_at(bytes: &[u8], offset: usize) -> Result<u16> {
    let value = bytes
        .get(offset..offset + 2)
        .ok_or_else(|| error("ICC 数据被截断"))?;
    Ok(u16::from_be_bytes([value[0], value[1]]))
}
fn u32_at(bytes: &[u8], offset: usize) -> Result<u32> {
    let value = bytes
        .get(offset..offset + 4)
        .ok_or_else(|| error("ICC 数据被截断"))?;
    Ok(u32::from_be_bytes([value[0], value[1], value[2], value[3]]))
}
fn fixed(bytes: &[u8], offset: usize) -> Result<f64> {
    Ok(f64::from(u32_at(bytes, offset)? as i32) / 65536.0)
}
pub fn linear() -> Vec<u16> {
    (0_u16..256)
        .map(|value| value * 257)
        .cycle()
        .take(768)
        .collect()
}
fn interpolate(samples: &[u16], x: f64) -> u16 {
    let location = x.clamp(0.0, 1.0) * (samples.len().saturating_sub(1)) as f64;
    let index = location.floor() as usize;
    let left = samples.get(index).copied().unwrap_or(0);
    let right = samples.get(index + 1).copied().unwrap_or(left);
    (f64::from(left) + (f64::from(right) - f64::from(left)) * (location - index as f64))
        .round()
        .clamp(0.0, 65535.0) as u16
}
fn curve(data: &[u8]) -> Result<Vec<u16>> {
    let kind = data.get(..4).ok_or_else(|| error("ICC 曲线缺少类型"))?;
    if kind == b"curv" {
        let count = u32_at(data, 8)? as usize;
        if count > 4096 {
            return Err(error("ICC 曲线采样点过多"));
        }
        if count == 0 {
            return Ok(linear()[..256].to_vec());
        }
        if count == 1 {
            let gamma = f64::from(u16_at(data, 12)?) / 256.0;
            if gamma <= 0.0 || gamma > 16.0 {
                return Err(error("ICC Gamma 参数无效"));
            }
            return Ok((0..256)
                .map(|index| ((f64::from(index) / 255.0).powf(gamma) * 65535.0).round() as u16)
                .collect());
        }
        let samples = (0..count)
            .map(|index| u16_at(data, 12 + index * 2))
            .collect::<Result<Vec<_>>>()?;
        return Ok((0..256)
            .map(|index| interpolate(&samples, f64::from(index) / 255.0))
            .collect());
    }
    if kind != b"para" {
        return Err(error("ICC 曲线类型不受支持"));
    }
    let function = u16_at(data, 8)? as usize;
    let count = *([1, 3, 4, 5, 7]
        .get(function)
        .ok_or_else(|| error("ICC 参数曲线函数不受支持"))?);
    let parameters = (0..count)
        .map(|index| fixed(data, 12 + index * 4))
        .collect::<Result<Vec<_>>>()?;
    let g = parameters[0];
    if g <= 0.0 || g > 16.0 {
        return Err(error("ICC 参数 Gamma 超出范围"));
    }
    let get = |index: usize| parameters.get(index).copied().unwrap_or(0.0);
    let a = get(1);
    let b = get(2);
    let c = get(3);
    let d = get(4);
    let e = get(5);
    let f = get(6);
    if (function == 1 || function == 2) && a.abs() < 1e-12 {
        return Err(error("ICC 参数曲线的除数为零"));
    }
    (0..256)
        .map(|index| {
            let x = f64::from(index) / 255.0;
            let value = match function {
                0 => x.powf(g),
                1 => {
                    if x >= -b / a {
                        (a * x + b).max(0.0).powf(g)
                    } else {
                        0.0
                    }
                }
                2 => {
                    if x >= -b / a {
                        (a * x + b).max(0.0).powf(g) + c
                    } else {
                        c
                    }
                }
                3 => {
                    if x >= d {
                        (a * x + b).max(0.0).powf(g)
                    } else {
                        c * x
                    }
                }
                4 => {
                    if x >= d {
                        (a * x + b).max(0.0).powf(g) + e
                    } else {
                        c * x + f
                    }
                }
                _ => return Err(error("ICC 参数曲线函数无效")),
            };
            if !value.is_finite() {
                return Err(error("ICC 曲线产生非有限值"));
            }
            Ok((value.clamp(0.0, 1.0) * 65535.0).round() as u16)
        })
        .collect()
}
fn vcgt(data: &[u8]) -> Result<Vec<u16>> {
    if data.get(..4) != Some(b"vcgt") || u32_at(data, 8)? != 0 {
        return Err(error("ICC VCGT 不是支持的表格格式"));
    }
    let channels = usize::from(u16_at(data, 12)?);
    let count = usize::from(u16_at(data, 14)?);
    let width = usize::from(u16_at(data, 16)?);
    if ![1, 3].contains(&channels) || !(2..=4096).contains(&count) || ![1, 2].contains(&width) {
        return Err(error("ICC VCGT 维度无效"));
    }
    let mut result = Vec::with_capacity(768);
    for channel in 0..3 {
        let source = if channels == 1 { 0 } else { channel };
        let samples = (0..count)
            .map(|index| {
                let offset = 18 + (source * count + index) * width;
                if width == 1 {
                    data.get(offset)
                        .map(|value| u16::from(*value) * 257)
                        .ok_or_else(|| error("ICC VCGT 被截断"))
                } else {
                    u16_at(data, offset)
                }
            })
            .collect::<Result<Vec<_>>>()?;
        result.extend((0..256).map(|index| interpolate(&samples, f64::from(index) / 255.0)));
    }
    Ok(result)
}
pub fn parse(bytes: &[u8]) -> Result<Vec<u16>> {
    if bytes.len() < 132
        || bytes.len() > 16_777_216
        || bytes.get(36..40) != Some(b"acsp")
        || bytes.get(16..20) != Some(b"RGB ")
    {
        return Err(error("不是受支持的 RGB ICC 文件"));
    }
    let size = u32_at(bytes, 0)? as usize;
    if size != bytes.len() {
        return Err(error("ICC 声明大小与文件大小不一致"));
    }
    let count = u32_at(bytes, 128)? as usize;
    if count > 256 || 132 + count * 12 > bytes.len() {
        return Err(error("ICC tag 目录无效"));
    }
    let mut tags = std::collections::HashMap::new();
    for index in 0..count {
        let start = 132 + index * 12;
        let signature = bytes
            .get(start..start + 4)
            .ok_or_else(|| error("ICC tag 缺少签名"))?;
        let offset = u32_at(bytes, start + 4)? as usize;
        let length = u32_at(bytes, start + 8)? as usize;
        if offset < 132 + count * 12
            || length < 8
            || offset
                .checked_add(length)
                .is_none_or(|end| end > bytes.len())
        {
            return Err(error("ICC tag 越过文件边界"));
        }
        if tags
            .insert(signature, &bytes[offset..offset + length])
            .is_some()
        {
            return Err(error("ICC 包含重复 tag"));
        }
    }
    let result = if let Some(data) = tags.get(b"vcgt".as_slice()) {
        match vcgt(data) {
            Ok(value) => value,
            Err(cause) => {
                log::debug!("ICC VCGT 不可用，尝试完整 TRC：{cause}");
                let mut result = Vec::new();
                for key in [b"rTRC", b"gTRC", b"bTRC"] {
                    result
                        .extend(curve(tags.get(key.as_slice()).ok_or_else(|| {
                            error("ICC 没有可用 VCGT 或完整 RGB TRC 曲线")
                        })?)?);
                }
                result
            }
        }
    } else {
        let mut result = Vec::new();
        for key in [b"rTRC", b"gTRC", b"bTRC"] {
            result.extend(curve(
                tags.get(key.as_slice())
                    .ok_or_else(|| error("ICC 缺少 RGB 校准曲线"))?,
            )?);
        }
        result
    };
    if result.len() != 768
        || result
            .chunks_exact(256)
            .any(|channel| channel.windows(2).any(|pair| pair[0] > pair[1]))
    {
        return Err(error("ICC 曲线不是单调递增校准曲线"));
    }
    Ok(result)
}
/// 导出通用 sRGB 显示配置及 VCGT；通用色度标签是规范常量，不是伪造的显示器实测参数。
pub fn export(ramp: &[u16]) -> Result<Vec<u8>> {
    use chrono::{Datelike, Timelike};
    if ramp.len() != 768 {
        return Err(error("导出曲线维度无效"));
    }
    let mut tags: Vec<([u8; 4], Vec<u8>)> = Vec::new();
    let mut calibration = b"vcgt\0\0\0\0".to_vec();
    calibration.extend_from_slice(&0_u32.to_be_bytes());
    for value in [3_u16, 256, 2] {
        calibration.extend_from_slice(&value.to_be_bytes());
    }
    for value in ramp {
        calibration.extend_from_slice(&value.to_be_bytes());
    }
    tags.push((*b"vcgt", calibration));
    for (key, xyz) in [
        (*b"rXYZ", [0.4360747, 0.2225045, 0.0139322]),
        (*b"gXYZ", [0.3850649, 0.7168786, 0.0971045]),
        (*b"bXYZ", [0.1430804, 0.0606169, 0.7141733]),
        (*b"wtpt", [0.9642, 1.0, 0.8249]),
    ] {
        let mut value = b"XYZ \0\0\0\0".to_vec();
        for number in xyz {
            value.extend_from_slice(&((number * 65536.0_f64).round() as i32).to_be_bytes());
        }
        tags.push((key, value));
    }
    for key in [*b"rTRC", *b"gTRC", *b"bTRC"] {
        let mut value = b"para\0\0\0\0".to_vec();
        value.extend_from_slice(&3_u16.to_be_bytes());
        value.extend_from_slice(&0_u16.to_be_bytes());
        for number in [2.4, 1.0 / 1.055, 0.055 / 1.055, 1.0 / 12.92, 0.04045] {
            value.extend_from_slice(&((number * 65536.0_f64).round() as i32).to_be_bytes());
        }
        tags.push((key, value));
    }
    let description = b"Zhenjing generic sRGB calibration curves\0";
    let mut text = b"desc\0\0\0\0".to_vec();
    text.extend_from_slice(&(description.len() as u32).to_be_bytes());
    text.extend_from_slice(description);
    text.extend_from_slice(&[0; 8]);
    text.extend_from_slice(&0_u16.to_be_bytes());
    text.push(0);
    text.extend_from_slice(&[0; 67]);
    tags.push((*b"desc", text));
    let mut copyright = b"text\0\0\0\0".to_vec();
    copyright.extend_from_slice(b"Generated by Zhenjing\0");
    tags.push((*b"cprt", copyright));
    let date = chrono::Utc::now();
    let table_end = 132 + tags.len() * 12;
    let mut output = vec![0_u8; table_end];
    output[8..12].copy_from_slice(&0x02400000_u32.to_be_bytes());
    output[12..16].copy_from_slice(b"mntr");
    output[16..20].copy_from_slice(b"RGB ");
    output[20..24].copy_from_slice(b"XYZ ");
    output[36..40].copy_from_slice(b"acsp");
    output[40..44].copy_from_slice(b"MSFT");
    for (index, value) in [
        date.year() as u16,
        date.month() as u16,
        date.day() as u16,
        date.hour() as u16,
        date.minute() as u16,
        date.second() as u16,
    ]
    .into_iter()
    .enumerate()
    {
        output[24 + index * 2..26 + index * 2].copy_from_slice(&value.to_be_bytes());
    }
    for (index, number) in [0.9642, 1.0, 0.8249].into_iter().enumerate() {
        output[68 + index * 4..72 + index * 4]
            .copy_from_slice(&((number * 65536.0_f64).round() as i32).to_be_bytes());
    }
    output[128..132].copy_from_slice(&(tags.len() as u32).to_be_bytes());
    for (index, (signature, mut data)) in tags.into_iter().enumerate() {
        let entry = 132 + index * 12;
        let offset = output.len() as u32;
        output[entry..entry + 4].copy_from_slice(&signature);
        output[entry + 4..entry + 8].copy_from_slice(&offset.to_be_bytes());
        output[entry + 8..entry + 12].copy_from_slice(&(data.len() as u32).to_be_bytes());
        output.append(&mut data);
        while !output.len().is_multiple_of(4) {
            output.push(0);
        }
    }
    let length = output.len() as u32;
    output[..4].copy_from_slice(&length.to_be_bytes());
    Ok(output)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn round_trip_and_truncations_are_checked() -> Result<()> {
        let ramp = linear();
        let bytes = export(&ramp)?;
        assert_eq!(parse(&bytes)?, ramp);
        for size in [0, 10, 131, bytes.len() - 1] {
            assert!(parse(&bytes[..size]).is_err());
        }
        Ok(())
    }
    #[test]
    fn rejects_directory_overflow() -> Result<()> {
        let mut bytes = export(&linear())?;
        bytes[136..140].copy_from_slice(&u32::MAX.to_be_bytes());
        assert!(parse(&bytes).is_err());
        Ok(())
    }
}
