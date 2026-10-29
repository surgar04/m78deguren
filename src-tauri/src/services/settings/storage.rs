//! 维护只面向应用自己的固定子目录；扫描、清理都不跟随重解析点或目录联接。
use crate::services::tools::{Result, ensure_local_path, error, io_error};
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
};

const CACHES: [&str; 14] = [
    "home/cache",
    "home/process/TEMP",
    "tmp",
    "tools/process/TEMP",
    "settings/process/TEMP",
    "settings/cache",
    "tools/cache",
    "tools/scripts",
    "webview/EBWebView/Default/Cache",
    "webview/EBWebView/Default/Code Cache",
    "webview/EBWebView/Default/GPUCache",
    "webview/Default/Cache",
    "webview/Default/Code Cache",
    "webview/Default/GPUCache",
];
pub const OWNED: [&str; 11] = [
    "settings",
    "tools",
    "webview",
    "logs",
    "reports",
    "profile",
    "tmp",
    "hardware",
    "steam",
    "home",
    "onboarding",
];
#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Footprint {
    pub data_root: String,
    pub data_bytes: u64,
    pub cache_bytes: u64,
    pub files: u64,
    pub skipped: u64,
    pub checked_at: f64,
}
#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClearReceipt {
    pub removed_bytes: u64,
    pub removed_files: u64,
    pub skipped: u64,
}
fn linked(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return true;
        }
    }
    metadata.file_type().is_symlink()
}
fn files(root: &Path, skipped: &mut u64) -> Result<Vec<(PathBuf, u64)>> {
    ensure_local_path(root)?;
    let mut stack = vec![root.to_owned()];
    let mut result = Vec::new();
    let mut visited = 0_u64;
    while let Some(path) = stack.pop() {
        visited += 1;
        if visited > 250_000 {
            return Err(error("文件数量过多，扫描已中止，未删除任何数据"));
        }
        let metadata = match fs::symlink_metadata(&path) {
            Ok(value) => value,
            Err(cause) if cause.kind() == std::io::ErrorKind::NotFound => continue,
            Err(_) => {
                *skipped += 1;
                continue;
            }
        };
        if linked(&metadata) {
            *skipped += 1;
            continue;
        }
        if metadata.is_file() {
            result.push((path, metadata.len()));
        } else if metadata.is_dir() {
            match fs::read_dir(&path) {
                Ok(entries) => {
                    for entry in entries {
                        match entry {
                            Ok(entry) => stack.push(entry.path()),
                            Err(_) => *skipped += 1,
                        }
                    }
                }
                Err(_) => *skipped += 1,
            }
        }
    }
    Ok(result)
}
pub fn footprint(root: &Path) -> Result<Footprint> {
    ensure_local_path(root)?;
    let mut result = Footprint {
        data_root: root.to_string_lossy().into_owned(),
        checked_at: crate::services::tools::network::now_ms(),
        ..Footprint::default()
    };
    for suffix in OWNED {
        for (_, bytes) in files(&root.join(suffix), &mut result.skipped)? {
            result.data_bytes = result.data_bytes.saturating_add(bytes);
            result.files += 1;
        }
    }
    for suffix in CACHES {
        for (_, bytes) in files(&root.join(suffix), &mut result.skipped)? {
            result.cache_bytes = result.cache_bytes.saturating_add(bytes);
        }
    }
    Ok(result)
}
pub fn clear_cache(root: &Path) -> Result<ClearReceipt> {
    ensure_local_path(root)?;
    let mut result = ClearReceipt::default();
    for suffix in CACHES {
        let directory = root.join(suffix);
        // 删除前再次验证绝对路径；任何占用文件、重解析点均跳过并返回真实数量。
        ensure_local_path(&directory)?;
        for (path, bytes) in files(&directory, &mut result.skipped)? {
            ensure_local_path(&path)?;
            match fs::remove_file(&path) {
                Ok(()) => {
                    result.removed_bytes = result.removed_bytes.saturating_add(bytes);
                    result.removed_files += 1;
                }
                Err(cause) if cause.kind() == std::io::ErrorKind::NotFound => {}
                Err(_) => result.skipped += 1,
            }
        }
    }
    Ok(result)
}

pub fn control_directory(root: &Path) -> Result<PathBuf> {
    ensure_local_path(root)?;
    if root.components().count() < 3 {
        return Err(error("不能把整个磁盘作为可重置的数据目录"));
    }
    let parent = root.parent().ok_or_else(|| error("数据目录没有父目录"))?;
    // 物理锁目录保留兼容，避免旧版与改名后的进程同时打开同一份用户数据。
    let control = parent.join(".xinjing-maintenance");
    ensure_local_path(&control)?;
    fs::create_dir_all(&control).map_err(io_error)?;
    Ok(control)
}

pub fn verify_file(path: &Path, expected: &str, bytes: u64) -> Result<()> {
    use sha2::{Digest, Sha256};
    use std::io::Read;
    ensure_local_path(path)?;
    let mut input = fs::File::open(path).map_err(io_error)?;
    if input.metadata().map_err(io_error)?.len() != bytes {
        return Err(error("更新文件大小发生变化"));
    }
    let mut hash = Sha256::new();
    let mut buffer = [0_u8; 65_536];
    let mut read_total = 0_u64;
    loop {
        let count = input.read(&mut buffer).map_err(io_error)?;
        if count == 0 {
            break;
        }
        read_total += count as u64;
        if read_total > bytes {
            return Err(error("核验期间文件大小发生变化"));
        }
        hash.update(&buffer[..count]);
    }
    if read_total != bytes || !format!("{:x}", hash.finalize()).eq_ignore_ascii_case(expected) {
        return Err(error("更新文件哈希不匹配，禁止执行"));
    }
    Ok(())
}

pub fn ownership(root: &Path) -> Result<fs::File> {
    let path = ownership_path(root)?;
    let mut options = fs::OpenOptions::new();
    options.create(true).truncate(false).read(true).write(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.share_mode(1);
    }
    options
        .open(path)
        .map_err(|_| error("另一个臻境实例正在使用这个数据目录，请切换到已有窗口"))
}
pub fn ownership_path(root: &Path) -> Result<PathBuf> {
    use sha2::{Digest, Sha256};
    let directory = control_directory(root)?;
    let name = format!(
        "data-{:x}.lock",
        Sha256::digest(root.to_string_lossy().to_lowercase().as_bytes())
    );
    let path = directory.join(name);
    ensure_local_path(&path)?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cleaning_only_removes_owned_cache() -> Result<()> {
        let root = crate::services::tools::test_root("settings-storage")?;
        fs::create_dir_all(root.join("settings/cache")).map_err(io_error)?;
        fs::create_dir_all(root.join("tools/changes")).map_err(io_error)?;
        fs::write(root.join("settings/cache/test.bin"), b"cache").map_err(io_error)?;
        fs::write(root.join("tools/changes/backup.json"), b"recover").map_err(io_error)?;
        let before = footprint(&root)?;
        assert_eq!(before.cache_bytes, 5);
        let receipt = clear_cache(&root)?;
        assert_eq!(receipt.removed_bytes, 5);
        assert!(root.join("tools/changes/backup.json").is_file());
        assert!(control_directory(Path::new("D:/")).is_err());
        Ok(())
    }
}
