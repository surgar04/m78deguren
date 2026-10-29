//! 用户 EQ 预设集中保存在应用数据目录；JSON 完整保存本程序配置，FAC 用于与 FxSound 预设交换。
use super::{
    Result,
    audio_dsp::{Band, Effects, EqConfig},
    error, io_error, save_json,
};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
// 保存数量检查与文件发布必须是同一事务，避免并发导入突破上限。
static PRESET_WRITES: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Preset {
    pub id: String,
    pub name: String,
    pub config: EqConfig,
}
fn valid_name(name: &str) -> bool {
    !name.trim().is_empty() && name.chars().count() <= 80 && !name.chars().any(char::is_control)
}
fn target(root: &Path, id: &str) -> Result<PathBuf> {
    uuid::Uuid::parse_str(id).map_err(|_| error("音频预设标识无效"))?;
    Ok(root.join("audio-presets").join(format!("{id}.json")))
}
pub async fn list(root: &Path) -> Result<Vec<Preset>> {
    let directory = root.join("audio-presets");
    super::check_local_path(&directory).await?;
    let mut rows = Vec::new();
    let mut entries = match tokio::fs::read_dir(directory).await {
        Ok(value) => value,
        Err(cause) if cause.kind() == std::io::ErrorKind::NotFound => return Ok(rows),
        Err(cause) => return Err(io_error(cause)),
    };
    while let Some(entry) = entries.next_entry().await.map_err(io_error)? {
        if rows.len() >= 100 {
            break;
        }
        let path = entry.path();
        super::check_local_path(&path).await?;
        let meta = entry.metadata().await.map_err(io_error)?;
        if !meta.is_file() || meta.len() > 262144 {
            continue;
        }
        if let Ok(data) = tokio::fs::read(&path).await
            && let Ok(preset) = serde_json::from_slice::<Preset>(&data)
            && target(root, &preset.id)? == path
            && valid_name(&preset.name)
            && preset.config.validate().is_ok()
        {
            rows.push(preset);
        }
    }
    rows.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(rows)
}
pub async fn save(root: &Path, name: String, config: EqConfig) -> Result<Preset> {
    let _guard = PRESET_WRITES.lock().await;
    config.validate()?;
    if !valid_name(&name) {
        return Err(error("预设名称需为 1–80 个普通字符"));
    }
    if list(root).await?.len() >= 100 {
        return Err(error("最多保存 100 个用户预设，请先删除不再需要的预设"));
    }
    let directory = root.join("audio-presets");
    super::check_local_path(&directory).await?;
    tokio::fs::create_dir_all(directory)
        .await
        .map_err(io_error)?;
    let preset = Preset {
        id: uuid::Uuid::new_v4().to_string(),
        name: name.trim().into(),
        config,
    };
    save_json(&target(root, &preset.id)?, &preset).await?;
    Ok(preset)
}
pub async fn remove(root: &Path, id: &str) -> Result<()> {
    let path = target(root, id)?;
    super::check_local_path(&path).await?;
    tokio::fs::remove_file(path).await.map_err(io_error)
}
pub fn import(content: &str) -> Result<(String, EqConfig)> {
    if content.len() > 262144 {
        return Err(error("音频预设不能超过 256 KB"));
    }
    if let Ok(preset) = serde_json::from_str::<Preset>(content) {
        preset.config.validate()?;
        if !valid_name(&preset.name) {
            return Err(error("预设名称无效"));
        }
        return Ok((preset.name, preset.config));
    }
    // FAC 按字段标签解析，不依赖固定行号；重复频率、缺失增益、无效范围全部拒绝。
    let mut frequencies = Vec::new();
    let mut pending = None;
    let mut main = [0.0; 6];
    let mut switches = [true; 5];
    let mut enabled = true;
    let lines: Vec<&str> = content.lines().collect();
    let name = lines
        .get(2)
        .map(|v| v.trim())
        .filter(|v| valid_name(v))
        .unwrap_or("导入的音频预设")
        .to_owned();
    for line in lines {
        let Some((number, label)) = line.trim().split_once(':') else {
            continue;
        };
        let label = label.trim();
        if label == "CF" {
            if pending.is_some() {
                return Err(error("FAC 频段缺失增益"));
            }
            pending = Some(
                number
                    .trim()
                    .parse::<f64>()
                    .map_err(|_| error("FAC 频率无效"))?,
            );
        } else if label == "Boost/Cut" {
            frequencies.push(Band {
                frequency: pending.take().ok_or_else(|| error("FAC 增益缺少频率"))?,
                gain: number.trim().parse().map_err(|_| error("FAC 增益无效"))?,
            });
        } else if label == "On/Off Flag" {
            enabled = number.trim() == "1";
        } else if let Some(index) = label
            .strip_prefix("Main ")
            .and_then(|v| v.parse::<usize>().ok())
        {
            if let Some(value) = main.get_mut(index) {
                *value = number
                    .trim()
                    .parse::<f64>()
                    .map_err(|_| error("FAC 音效值无效"))?
                    / 127.0;
            }
        } else if let Some(index) = label
            .strip_prefix("Integer[")
            .and_then(|v| v.strip_suffix(']'))
            .and_then(|v| v.parse::<usize>().ok())
            && let Some(value) = switches.get_mut(index)
        {
            *value = number.trim() != "0";
        }
    }
    if pending.is_some() {
        return Err(error("FAC 最后一个频段缺少增益"));
    }
    frequencies.sort_by(|a, b| a.frequency.total_cmp(&b.frequency));
    let effect = |index: usize, flag: usize| if switches[flag] { main[index] } else { 0.0 };
    let config = EqConfig {
        enabled,
        preamp: 0.0,
        bands: frequencies,
        effects: Effects {
            clarity: effect(0, 0),
            width: effect(1, 1),
            ambience: effect(3, 2),
            dynamics: effect(4, 3),
            bass: effect(5, 4),
        },
        headroom: true,
    };
    config.validate()?;
    Ok((name, config))
}
pub async fn export(root: &Path, name: String, config: EqConfig, fac: bool) -> Result<PathBuf> {
    config.validate()?;
    if !valid_name(&name) {
        return Err(error("预设名称无效"));
    }
    let directory = root.join("exports");
    super::check_local_path(&directory).await?;
    tokio::fs::create_dir_all(&directory)
        .await
        .map_err(io_error)?;
    let id = uuid::Uuid::new_v4().to_string();
    let path = directory.join(format!("audio-{id}.{}", if fac { "fac" } else { "json" }));
    if fac {
        let fx = &config.effects;
        let effects = [fx.clarity, fx.width, 0.0, fx.ambience, fx.dynamics, fx.bass];
        let mut lines = vec![
            "CLASS1 : Effect Type".to_owned(),
            "9: Version".into(),
            name,
            "0: Double Params Flag".into(),
            "1: Total number of elements".into(),
        ];
        for (index, value) in effects.into_iter().enumerate() {
            lines.push(format!("{}: Main {index}", (value * 127.0).round()));
        }
        lines.push("0: Element Number".into());
        for index in 0..7 {
            lines.push(format!("0: Param {index}"));
        }
        lines.extend([
            "7: Number of Application Dependent Integers".into(),
            "0: Number of Application Dependent Reals".into(),
            "0: Number of Application Dependent Strings".into(),
        ]);
        for (index, value) in [fx.clarity, fx.width, fx.ambience, fx.dynamics, fx.bass]
            .into_iter()
            .enumerate()
        {
            lines.push(format!("{}: Integer[{index}]", u8::from(value > 0.0)));
        }
        lines.extend([
            "0: Integer[5]".into(),
            "2: Integer[6]".into(),
            format!("{}: Number of EQ Bands", config.bands.len()),
            format!("{}: On/Off Flag", u8::from(config.enabled)),
        ]);
        for (index, band) in config.bands.iter().enumerate() {
            lines.push(format!(
                "Band {}\n{}: CF\n{}: Boost/Cut",
                index + 1,
                band.frequency,
                band.gain
            ));
        }
        tokio::fs::write(&path, lines.join("\n"))
            .await
            .map_err(io_error)?;
    } else {
        save_json(&path, &Preset { id, name, config }).await?;
    }
    Ok(path)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_executable_or_invalid_presets() {
        assert!(import("powershell.exe -command evil").is_err());
        assert!(!valid_name("name\ncommand"));
    }
    #[test]
    fn accepts_strict_native_presets() -> Result<()> {
        let preset = Preset {
            id: uuid::Uuid::new_v4().to_string(),
            name: "平直".into(),
            config: EqConfig::default(),
        };
        let text = serde_json::to_string(&preset).map_err(|_| error("test"))?;
        let (name, config) = import(&text)?;
        assert_eq!(name, "平直");
        assert_eq!(config.bands.len(), 10);
        Ok(())
    }
}
