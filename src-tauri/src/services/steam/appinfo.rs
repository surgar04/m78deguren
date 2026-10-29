//! 只解析所需应用的名称。所有偏移、字符串表、递归层数和节点数均有边界，损坏缓存不越界读取。
use crate::services::tools::{Result, error};
use std::{
    path::{Path, PathBuf},
    time::SystemTime,
};

/// 只缓存公开的应用名；文件身份/修改时间/长度变化时失效，避免每次刷新重读数百 MiB 的 appinfo。
pub struct NameCache {
    path: PathBuf,
    modified: Option<SystemTime>,
    length: u64,
    queried: HashSet<u32>,
    values: HashMap<u32, String>,
    pub kinds: HashMap<u32, String>,
}
pub async fn load(
    root: &Path,
    wanted: &HashSet<u32>,
    cache: &tokio::sync::Mutex<Option<NameCache>>,
) -> Result<HashMap<u32, String>> {
    let path = root.join("appcache/appinfo.vdf");
    let metadata = tokio::fs::metadata(&path)
        .await
        .map_err(crate::services::tools::io_error)?;
    let modified = metadata.modified().ok();
    let length = metadata.len();
    let mut cached = cache.lock().await;
    if let Some(current) = cached.as_ref()
        && current.path == path
        && current.modified == modified
        && current.length == length
        && wanted.is_subset(&current.queried)
    {
        return Ok(current.values.clone());
    }
    let bytes = super::scan::read(&path, 512 * 1024 * 1024).await?;
    let query = wanted.clone();
    let (values, kinds) =
        tauri::async_runtime::spawn_blocking(move || parse_metadata(&bytes, &query))
            .await
            .map_err(|_| error("Steam 应用目录解析任务失败"))??;
    *cached = Some(NameCache {
        path,
        modified,
        length,
        queried: wanted.clone(),
        values: values.clone(),
        kinds,
    });
    Ok(values)
}
use std::collections::{HashMap, HashSet};
struct Reader<'a> {
    bytes: &'a [u8],
    pos: usize,
    strings: Option<&'a [String]>,
    nodes: usize,
}
impl Reader<'_> {
    fn take(&mut self, count: usize) -> Result<&[u8]> {
        let end = self
            .pos
            .checked_add(count)
            .ok_or_else(|| error("appinfo 偏移溢出"))?;
        let value = self
            .bytes
            .get(self.pos..end)
            .ok_or_else(|| error("appinfo 文件被截断"))?;
        self.pos = end;
        Ok(value)
    }
    fn u32(&mut self) -> Result<u32> {
        Ok(u32::from_le_bytes(
            self.take(4)?
                .try_into()
                .map_err(|_| error("appinfo 整数错误"))?,
        ))
    }
    fn cstr(&mut self) -> Result<String> {
        let rest = self
            .bytes
            .get(self.pos..)
            .ok_or_else(|| error("appinfo 字符串偏移错误"))?;
        let length = rest
            .iter()
            .take(65537)
            .position(|byte| *byte == 0)
            .ok_or_else(|| error("appinfo 字符串未结束"))?;
        let text = String::from_utf8_lossy(self.take(length)?).into_owned();
        self.take(1)?;
        Ok(text)
    }
    fn object(
        &mut self,
        depth: usize,
        common: bool,
        name: &mut Option<String>,
        app_type: &mut Option<String>,
    ) -> Result<()> {
        if depth > 64 {
            return Err(error("appinfo 嵌套过深"));
        }
        loop {
            self.nodes += 1;
            if self.nodes > 500_000 {
                return Err(error("appinfo 节点过多"));
            }
            let kind = self.take(1)?[0];
            if matches!(kind, 8 | 11) {
                return Ok(());
            }
            let key = if let Some(strings) = self.strings {
                let index = self.u32()? as usize;
                strings
                    .get(index)
                    .cloned()
                    .ok_or_else(|| error("appinfo 字符串表索引无效"))?
            } else {
                self.cstr()?
            };
            match kind {
                0 => self.object(depth + 1, key == "common", name, app_type)?,
                1 => {
                    let value = self.cstr()?;
                    if common && key == "name" && value.len() <= 1024 {
                        *name = Some(value.clone());
                    }
                    if common && key == "type" && value.len() <= 64 {
                        *app_type = Some(value);
                    }
                }
                2..=4 | 6 => {
                    self.take(4)?;
                }
                5 => {
                    let mut count = 0;
                    while self.take(2)? != [0, 0] {
                        count += 1;
                        if count > 32768 {
                            return Err(error("appinfo 宽字符串过长"));
                        }
                    }
                }
                7 | 10 => {
                    self.take(8)?;
                }
                9 => {
                    self.take(1)?;
                }
                _ => return Err(error("appinfo 包含不支持的类型")),
            }
        }
    }
}
type Metadata = (HashMap<u32, String>, HashMap<u32, String>);
fn parse_metadata(bytes: &[u8], wanted: &HashSet<u32>) -> Result<Metadata> {
    let mut reader = Reader {
        bytes,
        pos: 0,
        strings: None,
        nodes: 0,
    };
    let magic = reader.u32()?;
    reader.u32()?;
    if !matches!(magic, 0x0756_4427..=0x0756_4429) {
        return Err(error("Steam appinfo 版本不受支持，使用 App ID 显示"));
    }
    let mut strings = Vec::new();
    let mut limit = bytes.len();
    if magic == 0x0756_4429 {
        let offset = u64::from_le_bytes(
            reader
                .take(8)?
                .try_into()
                .map_err(|_| error("appinfo 头错误"))?,
        );
        let offset = usize::try_from(offset).map_err(|_| error("appinfo 字符串表过大"))?;
        limit = offset;
        let mut table = Reader {
            bytes: bytes
                .get(offset..)
                .ok_or_else(|| error("appinfo 字符串表越界"))?,
            pos: 0,
            strings: None,
            nodes: 0,
        };
        let count = table.u32()?;
        if count > 1_000_000 {
            return Err(error("appinfo 字符串表过大"));
        }
        for _ in 0..count {
            strings.push(table.cstr()?);
        }
    }
    let mut result = HashMap::new();
    let mut kinds = HashMap::new();
    while reader.pos + 4 <= limit {
        let id = reader.u32()?;
        if id == 0 {
            break;
        }
        let size = reader.u32()? as usize;
        let start = reader.pos;
        let header = if magic == 0x0756_4427 { 40 } else { 60 };
        let end = start
            .checked_add(size)
            .filter(|end| *end <= limit)
            .ok_or_else(|| error("appinfo 条目越界"))?;
        if size < header {
            return Err(error("appinfo 条目头被截断"));
        }
        if wanted.contains(&id) {
            let mut child = Reader {
                bytes: &bytes[start + header..end],
                pos: 0,
                strings: if strings.is_empty() {
                    None
                } else {
                    Some(&strings)
                },
                nodes: 0,
            };
            let mut name = None;
            let mut app_type = None;
            child.object(0, false, &mut name, &mut app_type)?;
            if let Some(kind) = app_type {
                kinds.insert(id, kind);
            }
            if let Some(name) = name {
                result.insert(id, name);
            }
        }
        reader.pos = end;
    }
    Ok((result, kinds))
}
#[cfg(test)]
fn names(bytes: &[u8], wanted: &HashSet<u32>) -> Result<HashMap<u32, String>> {
    parse_metadata(bytes, wanted).map(|(names, _)| names)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_corrupt_offsets_and_decodes_v40() -> Result<()> {
        assert!(names(&[0; 16], &HashSet::new()).is_err());
        let payload = b"\0appinfo\0\0common\0\x01name\0Test game\0\x08\x08\x08";
        let mut bytes = Vec::new();
        bytes.extend(0x0756_4428_u32.to_le_bytes());
        bytes.extend(1_u32.to_le_bytes());
        bytes.extend(10_u32.to_le_bytes());
        bytes.extend(((60 + payload.len()) as u32).to_le_bytes());
        bytes.extend([0; 60]);
        bytes.extend(payload);
        bytes.extend(0_u32.to_le_bytes());
        assert_eq!(
            names(&bytes, &HashSet::from([10]))?
                .get(&10)
                .map(String::as_str),
            Some("Test game")
        );
        bytes.truncate(25);
        assert!(names(&bytes, &HashSet::from([10])).is_err());
        Ok(())
    }
    #[test]
    fn distinguishes_game_from_application_for_automatic_detection() -> Result<()> {
        let mut bytes = Vec::new();
        bytes.extend(0x0756_4428_u32.to_le_bytes());
        bytes.extend(1_u32.to_le_bytes());
        for (id, kind) in [(10_u32, "Game"), (20, "Application")] {
            let mut payload = b"\0appinfo\0\0common\0\x01name\0A\0\x01type\0".to_vec();
            payload.extend(kind.as_bytes());
            payload.extend([0, 8, 8, 8]);
            bytes.extend(id.to_le_bytes());
            bytes.extend(((60 + payload.len()) as u32).to_le_bytes());
            bytes.extend([0; 60]);
            bytes.extend(payload);
        }
        bytes.extend(0_u32.to_le_bytes());
        let (_, kinds) = parse_metadata(&bytes, &HashSet::from([10, 20]))?;
        assert_eq!(kinds.get(&10).map(String::as_str), Some("Game"));
        assert_eq!(kinds.get(&20).map(String::as_str), Some("Application"));
        Ok(())
    }
}
