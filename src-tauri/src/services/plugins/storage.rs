//! 插件文件仅由宿主读写。限制键名、单值与总量，原子替换保留旧文件直到新内容成功落盘。
use crate::services::tools::{Result, error, io_error};
use std::{io::Write, path::Path};

pub fn ordinary_tree(path: &Path) -> Result<()> {
    // 从根向下检查每一级，不能只检查末端后让父级 junction 绕过数据根。
    for parent in path.ancestors() {
        match std::fs::symlink_metadata(parent) {
            Ok(meta) => {
                #[cfg(windows)]
                {
                    use std::os::windows::fs::MetadataExt;
                    if meta.file_attributes() & 0x400 != 0 {
                        return Err(error("PLUGIN_PATH：目录包含重解析点"));
                    }
                }
                if meta.file_type().is_symlink() {
                    return Err(error("PLUGIN_PATH：目录包含符号链接"));
                }
            }
            Err(cause) if cause.kind() == std::io::ErrorKind::NotFound => {}
            Err(cause) => return Err(io_error(cause)),
        }
    }
    Ok(())
}
pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    ordinary_tree(path)?;
    let parent = path
        .parent()
        .ok_or_else(|| error("PLUGIN_PATH：数据目录无效"))?;
    std::fs::create_dir_all(parent).map_err(io_error)?;
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(io_error)?;
    file.write_all(bytes).map_err(io_error)?;
    file.as_file().sync_all().map_err(io_error)?;
    file.persist(path).map_err(|cause| io_error(cause.error))?;
    Ok(())
}
pub fn read_bounded(path: &Path, limit: usize) -> Result<Vec<u8>> {
    use std::io::Read;
    ordinary_tree(path)?;
    let file = std::fs::File::open(path).map_err(io_error)?;
    if !file.metadata().map_err(io_error)?.is_file() {
        return Err(error("PLUGIN_PATH：目标不是普通文件"));
    }
    let mut bytes = Vec::new();
    file.take((limit + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(io_error)?;
    if bytes.len() > limit {
        return Err(error("PLUGIN_LIMIT：文件超过大小上限"));
    }
    Ok(bytes)
}
pub fn usage(path: &Path) -> Result<u64> {
    ordinary_tree(path)?;
    if !path.exists() {
        return Ok(0);
    }
    let mut total = 0u64;
    let mut count = 0;
    for entry in std::fs::read_dir(path).map_err(io_error)? {
        let entry = entry.map_err(io_error)?;
        ordinary_tree(&entry.path())?;
        let meta = entry.metadata().map_err(io_error)?;
        if !meta.is_file() {
            return Err(error("PLUGIN_PATH：数据目录含有非文件条目"));
        }
        total = total
            .checked_add(meta.len())
            .ok_or_else(|| error("PLUGIN_LIMIT：存储长度溢出"))?;
        count += 1;
        if count > 4096 {
            return Err(error("PLUGIN_LIMIT：存储条目过多"));
        }
    }
    Ok(total)
}
