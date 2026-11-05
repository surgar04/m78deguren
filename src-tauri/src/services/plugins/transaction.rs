//! 代码与数据共同切换的崩溃恢复日志。所有目录由插件 ID 派生，日志不能注入绝对路径。
use super::{
    model::{Registry, identifier},
    package, storage,
};
use crate::services::tools::{Result, error, io_error};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Journal {
    pub id: String,
    pub old_digest: String,
    pub new_digest: String,
    pub had_data: bool,
}
fn clear(path: &Path) -> Result<()> {
    storage::ordinary_tree(path)?;
    if path.exists() {
        std::fs::remove_dir_all(path).map_err(io_error)?;
    }
    Ok(())
}
pub fn clone_data(source: &Path, destination: &Path) -> Result<()> {
    storage::ordinary_tree(source)?;
    storage::ordinary_tree(destination)?;
    std::fs::create_dir_all(destination).map_err(io_error)?;
    if !source.exists() {
        return Ok(());
    }
    if storage::usage(source)? > 256 * 1024 * 1024 {
        return Err(error("PLUGIN_MIGRATION_QUOTA"));
    }
    for entry in std::fs::read_dir(source).map_err(io_error)? {
        let entry = entry.map_err(io_error)?;
        let name = entry.file_name();
        let text = name.to_str().ok_or_else(|| error("PLUGIN_DATA_NAME"))?;
        identifier(
            text.strip_suffix(".json")
                .ok_or_else(|| error("PLUGIN_DATA_NAME"))?,
        )?;
        storage::atomic_write(
            &destination.join(name),
            &storage::read_bounded(&entry.path(), 1024 * 1024)?,
        )?;
    }
    Ok(())
}
pub fn prepare(root: &Path, id: &str, source: &Path) -> Result<PathBuf> {
    identifier(id)?;
    let folder = root.join("transactions").join(id);
    storage::ordinary_tree(&folder)?;
    if folder.exists() {
        return Err(error("PLUGIN_TRANSACTION_PENDING：存在未恢复事务"));
    }
    let working = folder.join("working");
    clone_data(source, &working)?;
    Ok(working)
}
pub fn switch(root: &Path, journal: &Journal) -> Result<()> {
    identifier(&journal.id)?;
    package::hex::<32>(&journal.old_digest)?;
    package::hex::<32>(&journal.new_digest)?;
    let folder = root.join("transactions").join(&journal.id);
    let active = root.join("data").join(&journal.id);
    storage::ordinary_tree(&folder)?;
    storage::ordinary_tree(&active)?;
    storage::atomic_write(
        &folder.join("journal.json"),
        &serde_json::to_vec(journal).map_err(|_| error("PLUGIN_ENCODING"))?,
    )?;
    if active.exists() {
        std::fs::rename(&active, folder.join("original")).map_err(io_error)?;
    }
    if let Some(parent) = active.parent() {
        std::fs::create_dir_all(parent).map_err(io_error)?;
    }
    std::fs::rename(folder.join("working"), active).map_err(io_error)?;
    Ok(())
}
/// 索引是最终提交点：仍指向旧代码就还原旧数据，指向新代码则完成备份整理。
pub fn recover(root: &Path, registry: &Registry) -> Result<()> {
    let directory = root.join("transactions");
    storage::ordinary_tree(&directory)?;
    if !directory.exists() {
        return Ok(());
    }
    let mut count = 0;
    for entry in std::fs::read_dir(&directory).map_err(io_error)? {
        count += 1;
        if count > 128 {
            return Err(error("PLUGIN_TRANSACTION_LIMIT"));
        }
        let entry = entry.map_err(io_error)?;
        let folder = entry.path();
        storage::ordinary_tree(&folder)?;
        let id = entry
            .file_name()
            .to_str()
            .ok_or_else(|| error("PLUGIN_TRANSACTION_ID"))?
            .to_owned();
        identifier(&id)?;
        let journal = folder.join("journal.json");
        if !journal.exists() {
            clear(&folder)?;
            continue;
        }
        let journal: Journal = serde_json::from_slice(&storage::read_bounded(&journal, 4096)?)
            .map_err(|_| error("PLUGIN_TRANSACTION_CORRUPT"))?;
        if journal.id != id {
            return Err(error("PLUGIN_TRANSACTION_ID"));
        }
        package::hex::<32>(&journal.old_digest)?;
        package::hex::<32>(&journal.new_digest)?;
        let active = root.join("data").join(&id);
        let original = folder.join("original");
        if registry
            .records
            .get(&id)
            .is_some_and(|r| r.digest == journal.new_digest)
        {
            if !active.is_dir() {
                return Err(error("PLUGIN_TRANSACTION_DATA_MISSING"));
            }
            if original.exists() {
                let backup = root.join("backups").join(&id).join(&journal.old_digest);
                clear(&backup)?;
                std::fs::create_dir_all(
                    backup
                        .parent()
                        .ok_or_else(|| error("PLUGIN_TRANSACTION_PATH"))?,
                )
                .map_err(io_error)?;
                std::fs::rename(original, backup).map_err(io_error)?;
            } else {
                // 空数据也有明确备份标记，回退不能把“备份丢失”误当成“原本没有数据”。
                std::fs::create_dir_all(root.join("backups").join(&id).join(&journal.old_digest))
                    .map_err(io_error)?;
            }
        } else if original.exists() {
            clear(&active)?;
            std::fs::rename(original, &active).map_err(io_error)?;
        } else if !journal.had_data {
            clear(&active)?;
        }
        clear(&folder)?;
    }
    Ok(())
}
pub fn discard(root: &Path, id: &str) -> Result<()> {
    identifier(id)?;
    clear(&root.join("transactions").join(id))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn committed_index_keeps_new_data_and_backup_survives_recovery() -> Result<()> {
        let temp = tempfile::tempdir().map_err(io_error)?;
        let root = temp.path();
        let manifest: super::super::model::Manifest = serde_json::from_str(include_str!(
            "../../../../plugins/examples/rust/manifest.json"
        ))
        .map_err(|_| error("fixture"))?;
        let id = manifest.id.clone();
        let active = root.join("data").join(&id);
        storage::atomic_write(&active.join("counter.json"), b"1")?;
        let working = prepare(root, &id, &active)?;
        storage::atomic_write(&working.join("counter.json"), b"2")?;
        switch(
            root,
            &Journal {
                id: id.clone(),
                old_digest: "a".repeat(64),
                new_digest: "b".repeat(64),
                had_data: true,
            },
        )?;
        let mut registry = Registry::default();
        registry.records.insert(
            id.clone(),
            super::super::model::Record {
                manifest,
                digest: "b".repeat(64),
                publisher_key: None,
                grants: vec![],
                enabled: false,
                quarantined: false,
                failures: 0,
                previous: Some("a".repeat(64)),
            },
        );
        recover(root, &registry)?;
        recover(root, &registry)?;
        assert_eq!(
            storage::read_bounded(&active.join("counter.json"), 10)?,
            b"2"
        );
        assert_eq!(
            storage::read_bounded(
                &root
                    .join("backups")
                    .join(id)
                    .join("a".repeat(64))
                    .join("counter.json"),
                10
            )?,
            b"1"
        );
        Ok(())
    }
    #[test]
    fn restores_data_when_index_did_not_commit() -> Result<()> {
        let temp = tempfile::tempdir().map_err(io_error)?;
        let root = temp.path();
        let id = "test.counter";
        let active = root.join("data").join(id);
        storage::atomic_write(&active.join("counter.json"), b"1")?;
        let work = prepare(root, id, &active)?;
        storage::atomic_write(&work.join("counter.json"), b"2")?;
        switch(
            root,
            &Journal {
                id: id.to_owned(),
                old_digest: "a".repeat(64),
                new_digest: "b".repeat(64),
                had_data: true,
            },
        )?;
        recover(root, &Registry::default())?;
        assert_eq!(
            storage::read_bounded(&active.join("counter.json"), 10)?,
            b"1"
        );
        Ok(())
    }
}
