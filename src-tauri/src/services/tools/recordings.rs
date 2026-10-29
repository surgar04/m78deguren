//! 已有录屏管理：原生选择器授权目录；移除在原磁盘暂存，避免数据目录与视频跨盘时失败。
use super::{Result, downloads::valid_filename, ensure_local_path, error, io_error};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::{Read, Seek, SeekFrom};
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingRoot {
    pub id: String,
    pub path: PathBuf,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Recording {
    pub id: String,
    pub root_id: String,
    pub name: String,
    pub bytes: u64,
    pub modified_ms: u64,
    pub relative_path: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemovedRecording {
    pub id: String,
    pub name: String,
    pub original: PathBuf,
    pub stored: PathBuf,
}
fn quarantine_folder(original: &Path, id: &str) -> Result<PathBuf> {
    uuid::Uuid::parse_str(id).map_err(|_| error("暂存标识无效"))?;
    let parent = original.parent().ok_or_else(|| error("原文件目录无效"))?;
    Ok(parent.join(".zhenjing-trash").join(id))
}
/// 同时接受旧版应用数据目录中的暂存区；新记录必须精确匹配原目录、UUID 和文件名。
fn validate_removed(root: &Path, record: &RemovedRecording) -> Result<()> {
    if !valid_filename(&record.name) || record.original.file_name() != Some(record.name.as_ref()) {
        return Err(error("录屏恢复文件名无效"));
    }
    let adjacent = quarantine_folder(&record.original, &record.id)?.join(&record.name);
    let legacy = root.join("trash").join(&record.id).join(&record.name);
    if record.stored != adjacent && record.stored != legacy {
        return Err(error("录屏恢复记录越过暂存范围"));
    }
    ensure_local_path(&record.original)?;
    ensure_local_path(&record.stored)
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingSnapshot {
    pub roots: Vec<RecordingRoot>,
    pub files: Vec<Recording>,
    pub removed: Vec<RemovedRecording>,
    pub truncated: bool,
}
pub struct RecordingStore {
    root: PathBuf,
    pub roots: Vec<RecordingRoot>,
    pub entries: HashMap<String, (Recording, PathBuf)>,
    removed: Vec<RemovedRecording>,
}
fn read_json<T: serde::de::DeserializeOwned + Default>(path: &Path) -> Result<T> {
    ensure_local_path(path)?;
    if !path.exists() {
        return Ok(T::default());
    }
    let bytes = std::fs::read(path).map_err(io_error)?;
    if bytes.len() > 2_097_152 {
        return Err(error("录屏配置超过限制"));
    }
    serde_json::from_slice(&bytes).map_err(|_| error("录屏配置损坏，请备份后检查"))
}
fn persist_sync<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    ensure_local_path(path)?;
    let temporary = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    std::fs::write(
        &temporary,
        serde_json::to_vec_pretty(value).map_err(|_| error("配置无法序列化"))?,
    )
    .map_err(io_error)?;
    std::fs::rename(temporary, path).map_err(io_error)
}
impl RecordingStore {
    pub fn purge(&mut self, id: &str, consent: bool) -> Result<()> {
        if !consent {
            return Err(error("永久删除必须逐项确认"));
        }
        let record = self
            .removed
            .iter()
            .find(|record| record.id == id)
            .cloned()
            .ok_or_else(|| error("暂存记录不存在"))?;
        validate_removed(&self.root, &record)?;
        if record.stored.exists() {
            std::fs::remove_file(&record.stored).map_err(io_error)?;
        }
        self.removed.retain(|record| record.id != id);
        persist_sync(&self.root.join("trash.json"), &self.removed)
    }
    pub fn load(root: &Path) -> Result<Self> {
        let directory = root.join("recordings");
        ensure_local_path(&directory.join("trash"))?;
        std::fs::create_dir_all(directory.join("trash")).map_err(io_error)?;
        let roots: Vec<RecordingRoot> = read_json(&directory.join("roots.json"))?;
        let removed: Vec<RemovedRecording> = read_json(&directory.join("trash.json"))?;
        if roots.len() > 32 || removed.len() > 1000 {
            return Err(error("录屏配置项超过上限"));
        }
        for item in &roots {
            ensure_local_path(&item.path)?;
            if uuid::Uuid::parse_str(&item.id).is_err() {
                return Err(error("录屏目录ID无效"));
            }
        }
        for item in &removed {
            validate_removed(&directory, item)?;
        }
        Ok(Self {
            root: directory,
            roots,
            entries: HashMap::new(),
            removed,
        })
    }
    pub fn add(&mut self, path: PathBuf) -> Result<()> {
        ensure_local_path(&path)?;
        if !path.is_dir() {
            return Err(error("请选择已存在的本地目录"));
        }
        if self.roots.iter().any(|root| root.path == path) {
            return Ok(());
        }
        if self.roots.len() >= 32 {
            return Err(error("最多添加32个录屏目录"));
        }
        self.roots.push(RecordingRoot {
            id: uuid::Uuid::new_v4().to_string(),
            path,
        });
        persist_sync(&self.root.join("roots.json"), &self.roots)
    }
    pub fn remove_root(&mut self, id: &str) -> Result<()> {
        self.roots.retain(|root| root.id != id);
        self.entries.retain(|_, (file, _)| file.root_id != id);
        persist_sync(&self.root.join("roots.json"), &self.roots)
    }
    pub fn scan(&mut self) -> Result<RecordingSnapshot> {
        let mut entries = HashMap::new();
        let mut visited = HashSet::new();
        let mut examined = 0;
        let mut truncated = false;
        for root in &self.roots {
            if !root.path.exists() {
                continue;
            }
            ensure_local_path(&root.path)?;
            let mut queue = vec![(root.path.clone(), 0_u8)];
            while let Some((directory, depth)) = queue.pop() {
                if !visited.insert(directory.clone()) {
                    continue;
                }
                for entry in std::fs::read_dir(&directory).map_err(io_error)? {
                    let entry = entry.map_err(io_error)?;
                    examined += 1;
                    if examined > 50_000 {
                        truncated = true;
                        break;
                    }
                    let path = entry.path();
                    if ensure_local_path(&path).is_err() {
                        continue;
                    }
                    if path.starts_with(&self.root) || entry.file_name() == ".zhenjing-trash" {
                        continue;
                    }
                    let metadata = entry.metadata().map_err(io_error)?;
                    if metadata.is_dir() {
                        if depth < 12 {
                            queue.push((path, depth + 1));
                        } else {
                            truncated = true;
                        }
                        continue;
                    }
                    if !metadata.is_file() || !video(&path) {
                        continue;
                    }
                    let name = entry.file_name().to_string_lossy().to_string();
                    let modified_ms = metadata
                        .modified()
                        .ok()
                        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                        .map(|t| t.as_millis().min(u128::from(u64::MAX)) as u64)
                        .unwrap_or(0);
                    let id = format!(
                        "{:x}",
                        Sha256::digest(format!("{}:{}", root.id, path.display()).as_bytes())
                    );
                    let item = Recording {
                        id: id.clone(),
                        root_id: root.id.clone(),
                        name,
                        bytes: metadata.len(),
                        modified_ms,
                        relative_path: path
                            .strip_prefix(&root.path)
                            .map(|p| p.to_string_lossy().into_owned())
                            .unwrap_or_default(),
                    };
                    entries.insert(id, (item, path));
                }
                if truncated {
                    break;
                }
            }
            if truncated {
                break;
            }
        }
        self.entries = entries;
        let mut files: Vec<Recording> = self
            .entries
            .values()
            .map(|(value, _)| value.clone())
            .collect();
        files.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms).then(a.name.cmp(&b.name)));
        Ok(RecordingSnapshot {
            roots: self.roots.clone(),
            files,
            removed: self.removed.clone(),
            truncated,
        })
    }
    pub fn path(&self, id: &str) -> Result<PathBuf> {
        let path = self
            .entries
            .get(id)
            .map(|(_, path)| path)
            .ok_or_else(|| error("录屏已变化，请刷新目录"))?;
        ensure_local_path(path)?;
        if !path.is_file() {
            return Err(error("录屏文件已不存在"));
        }
        Ok(path.clone())
    }
    pub fn rename(&mut self, id: &str, name: &str) -> Result<()> {
        if !valid_filename(name) {
            return Err(error("文件名无效，请避开系统保留名称和特殊字符"));
        }
        let original = self.path(id)?;
        let target = original.with_file_name(name);
        ensure_local_path(&target)?;
        if !video(&target)
            || original.extension().map(|v| v.to_ascii_lowercase())
                != target.extension().map(|v| v.to_ascii_lowercase())
        {
            return Err(error("重命名不能改变视频扩展名"));
        }
        if target == original {
            return Ok(());
        }
        if target.exists() {
            return Err(error("目标文件已存在，不会覆盖"));
        }
        std::fs::rename(original, target).map_err(io_error)?;
        Ok(())
    }
    pub fn remove(&mut self, id: &str) -> Result<String> {
        if self.removed.len() >= 1000 {
            return Err(error("可恢复记录已达上限，请先恢复或手动管理暂存区"));
        }
        let original = self.path(id)?;
        let name = original
            .file_name()
            .ok_or_else(|| error("文件名无效"))?
            .to_string_lossy()
            .into_owned();
        let trash_id = uuid::Uuid::new_v4().to_string();
        // 应用可能装在 C 盘，视频可能位于 E 盘；原地暂存保持移动在同一卷上，无需复制大文件。
        let folder = quarantine_folder(&original, &trash_id)?;
        ensure_local_path(&folder)?;
        let parent = folder.parent().ok_or_else(|| error("暂存目录无效"))?;
        std::fs::create_dir_all(parent).map_err(io_error)?;
        std::fs::create_dir(&folder).map_err(io_error)?;
        let stored = folder.join(&name);
        let record = RemovedRecording {
            id: trash_id.clone(),
            name,
            original: original.clone(),
            stored: stored.clone(),
        };
        // 先写恢复清单再移动；移动失败回滚清单，避免文件已移动却没有恢复凭据。
        self.removed.push(record);
        if let Err(cause) = persist_sync(&self.root.join("trash.json"), &self.removed) {
            self.removed.retain(|v| v.id != trash_id);
            return Err(cause);
        }
        if let Err(cause) = std::fs::rename(&original, &stored) {
            self.removed.retain(|v| v.id != trash_id);
            let _ = persist_sync(&self.root.join("trash.json"), &self.removed);
            return Err(io_error(cause));
        }
        self.entries.remove(id);
        Ok(trash_id)
    }
    pub fn restore(&mut self, id: &str) -> Result<()> {
        let record = self
            .removed
            .iter()
            .find(|value| value.id == id)
            .cloned()
            .ok_or_else(|| error("恢复记录不存在"))?;
        validate_removed(&self.root, &record)?;
        if record.original.exists() {
            return Err(error("原位置已有同名文件，恢复不会覆盖"));
        }
        if !record.stored.is_file() {
            return Err(error("暂存文件已不存在，请检查应用暂存目录"));
        }
        std::fs::rename(&record.stored, &record.original).map_err(io_error)?;
        self.removed.retain(|value| value.id != id);
        persist_sync(&self.root.join("trash.json"), &self.removed)
    }
    pub fn copy(&self, id: &str, folder: &Path) -> Result<PathBuf> {
        ensure_local_path(folder)?;
        if !folder.is_dir() {
            return Err(error("复制目标目录不存在"));
        }
        let source = self.path(id)?;
        let target = folder.join(source.file_name().ok_or_else(|| error("文件名无效"))?);
        ensure_local_path(&target)?;
        // create_new提供排他语义，不能先exists再copy而允许竞态覆盖。
        let mut input = std::fs::File::open(&source).map_err(io_error)?;
        let mut output = std::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&target)
            .map_err(io_error)?;
        if let Err(cause) = std::io::copy(&mut input, &mut output).and_then(|_| output.sync_all()) {
            drop(output);
            let _ = std::fs::remove_file(&target);
            return Err(io_error(cause));
        }
        Ok(target)
    }
}
fn video(path: &Path) -> bool {
    path.extension().and_then(|v| v.to_str()).is_some_and(|e| {
        matches!(
            e.to_ascii_lowercase().as_str(),
            "mp4" | "mkv" | "webm" | "mov" | "avi" | "m4v"
        )
    })
}

/// 自定义媒体协议只接受扫描产生的ID；Range上限16MiB，任何路径都不能由URL直接指定。
pub fn media_response(
    path: &Path,
    range: Option<&str>,
    head: bool,
) -> Result<tauri::http::Response<Vec<u8>>> {
    ensure_local_path(path)?;
    let mut file = std::fs::File::open(path).map_err(io_error)?;
    let total = file.metadata().map_err(io_error)?.len();
    let (start, end) = parse_range(range, total)?;
    let length = if total == 0 { 0 } else { end - start + 1 };
    let mut bytes = Vec::new();
    if !head {
        file.seek(SeekFrom::Start(start)).map_err(io_error)?;
        file.take(length)
            .read_to_end(&mut bytes)
            .map_err(io_error)?;
    }
    let mime = match path
        .extension()
        .and_then(|s| s.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("webm") => "video/webm",
        Some("mkv") => "video/x-matroska",
        Some("avi") => "video/x-msvideo",
        Some("mov") => "video/quicktime",
        _ => "video/mp4",
    };
    let partial = range.is_some() || length < total;
    let mut builder = tauri::http::Response::builder()
        .status(if partial { 206 } else { 200 })
        .header("Content-Type", mime)
        .header("Accept-Ranges", "bytes")
        .header("Content-Length", length)
        .header("Cache-Control", "no-store")
        .header("Access-Control-Allow-Origin", "http://tauri.localhost");
    if partial && total > 0 {
        builder = builder.header("Content-Range", format!("bytes {start}-{end}/{total}"));
    }
    builder.body(bytes).map_err(|_| error("无法构建视频响应"))
}
pub fn parse_range(value: Option<&str>, total: u64) -> Result<(u64, u64)> {
    if total == 0 {
        return Ok((0, 0));
    }
    let maximum = 16_777_216;
    let Some(value) = value else {
        return Ok((0, (total - 1).min(maximum - 1)));
    };
    let value = value
        .strip_prefix("bytes=")
        .ok_or_else(|| error("不支持的媒体范围"))?;
    if value.contains(',') {
        return Err(error("不支持多个媒体范围"));
    }
    let (start, end) = value.split_once('-').ok_or_else(|| error("媒体范围无效"))?;
    let start = if start.is_empty() {
        total.saturating_sub(end.parse::<u64>().map_err(|_| error("媒体范围无效"))?)
    } else {
        start.parse::<u64>().map_err(|_| error("媒体范围无效"))?
    };
    let end = if end.is_empty() || value.starts_with('-') {
        total - 1
    } else {
        end.parse::<u64>()
            .map_err(|_| error("媒体范围无效"))?
            .min(total - 1)
    };
    if start >= total || start > end {
        return Err(error("媒体范围超出文件"));
    }
    Ok((start, end.min(start.saturating_add(maximum - 1))))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ranges_are_bounded_and_validate() {
        assert_eq!(parse_range(Some("bytes=10-19"), 100).ok(), Some((10, 19)));
        assert_eq!(parse_range(Some("bytes=-10"), 100).ok(), Some((90, 99)));
        assert!(parse_range(Some("bytes=100-"), 100).is_err());
        assert!(parse_range(Some("bytes=0-1,5-8"), 100).is_err());
        assert_eq!(parse_range(None, 30_000_000).ok(), Some((0, 16_777_215)));
    }
    #[test]
    fn recording_file_lifecycle_never_overwrites() -> Result<()> {
        let root = super::super::test_root("recordings")?;
        let library = root.join("videos");
        let copies = root.join("copies");
        std::fs::create_dir_all(&library).map_err(io_error)?;
        std::fs::create_dir_all(&copies).map_err(io_error)?;
        std::fs::write(library.join("真实文件.mp4"), b"actual-file-content").map_err(io_error)?;
        std::fs::write(library.join("不是视频.txt"), b"ignored").map_err(io_error)?;
        let mut store = RecordingStore::load(&root)?;
        assert!(store.add(PathBuf::from(r"\\server\share\videos")).is_err());
        store.add(library.clone())?;
        let snapshot = store.scan()?;
        assert_eq!(snapshot.files.len(), 1);
        let id = &snapshot.files[0].id;
        assert!(store.path("../outside").is_err());
        let response = media_response(&store.path(id)?, Some("bytes=0-5"), false)?;
        assert_eq!(response.status(), 206);
        assert_eq!(response.body(), b"actual");
        assert!(store.rename(id, "不能改后缀.exe").is_err());
        let copy = store.copy(id, &copies)?;
        assert!(store.copy(id, &copies).is_err());
        assert_eq!(
            std::fs::read(copy).map_err(io_error)?,
            b"actual-file-content"
        );
        store.rename(id, "改名.mp4")?;
        let snapshot = store.scan()?;
        let removed = store.remove(&snapshot.files[0].id)?;
        assert!(!library.join("改名.mp4").exists());
        assert!(
            store.scan()?.files.is_empty(),
            "暂存区不能重新被扫描为有效录屏"
        );
        let item = store
            .removed
            .iter()
            .find(|item| item.id == removed)
            .ok_or_else(|| error("测试暂存记录缺失"))?;
        assert_eq!(
            item.stored.parent(),
            Some(quarantine_folder(&item.original, &item.id)?.as_path())
        );
        let mut restored = RecordingStore::load(&root)?;
        std::fs::write(library.join("改名.mp4"), b"preserve").map_err(io_error)?;
        assert!(restored.restore(&removed).is_err());
        std::fs::remove_file(library.join("改名.mp4")).map_err(io_error)?;
        restored.restore(&removed)?;
        assert_eq!(restored.scan()?.files.len(), 1);
        assert_eq!(
            std::fs::read(library.join("改名.mp4")).map_err(io_error)?,
            b"actual-file-content"
        );
        Ok(())
    }
}
