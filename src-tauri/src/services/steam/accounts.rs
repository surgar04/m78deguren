//! 账号操作为可审计事务：同一把串行锁、配置指纹、优雅退出、应用备份、原子替换及注册表 CAS。
use super::{SteamState, scan, spawn_steam, types::*, vdf};
use crate::services::tools::{Result, check_local_path, error, io_error, save_json};
use std::{
    path::Path,
    time::{Duration, Instant},
};
impl SteamState {
    pub async fn backups(&self) -> Result<Vec<Backup>> {
        let root = self.root.join("backups");
        check_local_path(&root).await?;
        let Ok(mut files) = tokio::fs::read_dir(&root).await else {
            return Ok(Vec::new());
        };
        let mut output = Vec::new();
        while let Some(entry) = files.next_entry().await.map_err(io_error)? {
            if output.len() >= 200 {
                break;
            }
            if uuid::Uuid::parse_str(&entry.file_name().to_string_lossy()).is_err() {
                continue;
            }
            check_local_path(&entry.path()).await?;
            if let Ok(bytes) = scan::read(&entry.path().join("receipt.json"), 65536).await
                && let Ok(backup) = serde_json::from_slice::<Backup>(&bytes)
            {
                output.push(backup);
            }
        }
        output.sort_by_key(|backup| std::cmp::Reverse(backup.created_at));
        Ok(output)
    }
    pub async fn account_action(
        &self,
        kind: &str,
        id: &str,
        revision: &str,
        consent: bool,
    ) -> Result<Backup> {
        if !consent || !scan::valid_id(id) || !matches!(kind, "switch" | "remove") {
            return Err(error("必须逐项确认有效的 Steam 本地账号操作"));
        }
        let _guard = self.serial.lock().await;
        let snapshot = self.current().await?;
        let account = snapshot
            .accounts
            .iter()
            .find(|account| account.id == id)
            .ok_or_else(|| error("本地账号已不存在，请刷新"))?;
        if snapshot.revision != revision {
            return Err(error("账号列表版本已变化，请刷新后重新确认"));
        }
        let path = snapshot
            .path
            .as_deref()
            .ok_or_else(|| error("Steam 未安装"))?;
        // 写入仅限探测到的 Steam 配置文件；发布版支持所有本地磁盘，开发写入限制由统一策略执行。
        let root = Path::new(path);
        check_local_path(root).await?;
        let file = root.join("config/loginusers.vdf");
        check_local_path(&file).await?;
        let before = scan::read(&file, 2 * 1024 * 1024).await?;
        if scan::digest(&before) != revision {
            return Err(error("Steam 已改写账号列表，请刷新"));
        }
        let source =
            String::from_utf8(before.clone()).map_err(|_| error("Steam 账号文件编码无效"))?;
        let desired = vdf::edit_user(&source, id, kind == "remove")?;
        let platform = scan::platform(&self.root).await?;
        if platform.path.as_deref() != Some(path) {
            return Err(error("Steam 安装位置已变化，请刷新后重新确认"));
        }
        let registry = if kind == "switch" {
            LoginRegistry {
                auto_login: Some(account.account_name.clone()),
                remember: platform.registry.remember,
            }
        // Steam 登录名不区分 ASCII 大小写，不能因客户端保存大小写不同而漏掉自动登录记录。
        } else if platform
            .registry
            .auto_login
            .as_deref()
            .is_some_and(|name| name.eq_ignore_ascii_case(&account.account_name))
        {
            LoginRegistry {
                auto_login: None,
                remember: Some(0),
            }
        } else {
            platform.registry.clone()
        };
        let mut backup = Backup {
            id: uuid::Uuid::new_v4().to_string(),
            kind: kind.into(),
            account: id.into(),
            created_at: chrono::Utc::now().timestamp_millis(),
            steam_path: path.into(),
            before_hash: revision.into(),
            after_hash: scan::digest(desired.as_bytes()),
            before_registry: platform.registry.clone(),
            after_registry: registry.clone(),
            state: "prepared".into(),
            message: "配置备份完成，尚未修改 Steam".into(),
        };
        let directory = self.root.join("backups").join(&backup.id);
        check_local_path(&directory).await?;
        tokio::fs::create_dir_all(&directory)
            .await
            .map_err(io_error)?;
        tokio::fs::write(directory.join("loginusers.vdf"), &before)
            .await
            .map_err(io_error)?;
        save_json(&directory.join("receipt.json"), &backup).await?;
        let result = async {
            self.stop_steam(root).await?;
            // Steam 正常退出会改写 Timestamp/MostRecent。必须重新读取并用原结构执行目标操作，而非覆盖退出前的旧文件。
            let fresh = scan::read(&file, 2 * 1024 * 1024).await?;
            let fresh_source = String::from_utf8(fresh.clone())
                .map_err(|_| error("退出后的 Steam 配置编码无效"))?;
            let edited = vdf::edit_user(&fresh_source, id, kind == "remove")?;
            let stopped = scan::platform(&self.root).await?;
            if stopped.running || stopped.registry != platform.registry {
                return Err(error("Steam 状态在退出期间变化，未修改账号"));
            }
            // 保存最终写前版本；恢复必须回到这个确切版本。
            tokio::fs::write(directory.join("loginusers.vdf"), &fresh)
                .await
                .map_err(io_error)?;
            backup.before_hash = scan::digest(&fresh);
            backup.after_hash = scan::digest(edited.as_bytes());
            save_json(&directory.join("receipt.json"), &backup).await?;
            replace(&file, &fresh, edited.as_bytes()).await?;
            if let Err(cause) = self.set_registry(&platform.registry, &registry).await {
                let rollback = replace(&file, edited.as_bytes(), &fresh).await;
                return Err(error(format!(
                    "注册表操作失败：{cause}；配置回滚{}",
                    if rollback.is_ok() {
                        "完成"
                    } else {
                        "失败，请使用 应用备份"
                    }
                )));
            }
            Ok(())
        }
        .await;
        if let Err(cause) = result {
            backup.state = "failed".into();
            backup.message = cause.to_string();
            save_json(&directory.join("receipt.json"), &backup).await?;
            return Err(cause);
        }
        backup.state = "completed".into();
        backup.message = if kind == "remove" {
            "已删除本机保存的账号选择记录；没有删除云端账号、游戏、存档或共享登录令牌。Steam 保持关闭，避免立即重新写回记录。".into()
        } else {
            match spawn_steam(&self.root, root, &[]).await {
                Ok(()) => {
                    "已提交账号切换并启动 Steam；密码、Steam Guard 与授权校验仍由 Steam 处理。"
                        .into()
                }
                Err(cause) => format!(
                    "切换配置已提交，但 Steam 启动失败：{cause}；可手动启动或使用恢复入口。"
                ),
            }
        };
        save_json(&directory.join("receipt.json"), &backup).await?;
        *self.loaded.lock().await = None;
        *self.snapshot.write().await = None;
        Ok(backup)
    }
    async fn stop_steam(&self, root: &Path) -> Result<()> {
        if !scan::platform(&self.root).await?.running {
            return Ok(());
        }
        spawn_steam(&self.root, root, &["-shutdown".into()]).await?;
        let start = Instant::now();
        loop {
            tokio::time::sleep(Duration::from_secs(1)).await;
            if !scan::platform(&self.root).await?.running {
                return Ok(());
            }
            if start.elapsed() > Duration::from_secs(35) {
                return Err(error(
                    "Steam 未能正常退出，已取消账号操作；请手动退出客户端后重试，不会强制结束游戏或下载",
                ));
            }
        }
    }
    async fn set_registry(&self, expected: &LoginRegistry, desired: &LoginRegistry) -> Result<()> {
        let value = serde_json::json!({"expected":expected,"desired":desired}).to_string();
        crate::services::tools::platform::run_embedded(
            &self.root,
            "steam-registry",
            &[value],
            Duration::from_secs(15),
            include_str!("windows.ps1"),
        )
        .await?;
        Ok(())
    }
    pub async fn restore(&self, id: &str, consent: bool) -> Result<Backup> {
        if !consent || uuid::Uuid::parse_str(id).is_err() {
            return Err(error("请确认恢复选定的本地账号备份"));
        }
        let _guard = self.serial.lock().await;
        let directory = self.root.join("backups").join(id);
        check_local_path(&directory).await?;
        let mut backup: Backup =
            serde_json::from_slice(&scan::read(&directory.join("receipt.json"), 65536).await?)
                .map_err(|_| error("账号备份回执损坏"))?;
        if backup.id != id || backup.state != "completed" {
            return Err(error("只能恢复已完成操作的备份"));
        }
        let platform = scan::platform(&self.root).await?;
        if platform.path.as_deref() != Some(backup.steam_path.as_str()) {
            return Err(error("Steam 安装位置已变化，拒绝跨目录恢复"));
        }
        let root = Path::new(&backup.steam_path);
        check_local_path(root).await?;
        self.stop_steam(root).await?;
        let path = root.join("config/loginusers.vdf");
        check_local_path(&path).await?;
        let current = scan::read(&path, 2 * 1024 * 1024).await?;
        let original = scan::read(&directory.join("loginusers.vdf"), 2 * 1024 * 1024).await?;
        if scan::digest(&current) != backup.after_hash
            || scan::digest(&original) != backup.before_hash
        {
            return Err(error(
                "账号文件已有新变化或备份不完整，拒绝覆盖；可在账号列表中重新切换，原始备份保留在应用数据目录",
            ));
        }
        replace(&path, &current, &original).await?;
        if let Err(cause) = self
            .set_registry(&backup.after_registry, &backup.before_registry)
            .await
        {
            let _ = replace(&path, &original, &current).await;
            return Err(cause);
        }
        backup.state = "restored".into();
        backup.message = "本地账号配置已恢复，Steam 保持关闭，可自行启动。".into();
        save_json(&directory.join("receipt.json"), &backup).await?;
        *self.loaded.lock().await = None;
        *self.snapshot.write().await = None;
        Ok(backup)
    }
}
async fn replace(path: &Path, expected: &[u8], next: &[u8]) -> Result<()> {
    check_local_path(path).await?;
    let path = path.to_owned();
    let expected = expected.to_vec();
    let next = next.to_vec();
    // Windows 句柄禁止其他进程写入，允许当前事务原子替换；阻止最后校验与提交之间被其他进程覆盖。
    tauri::async_runtime::spawn_blocking(move || {
        use std::io::{Read, Write};
        let mut options = std::fs::OpenOptions::new();
        options.read(true);
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            options.share_mode(4);
        }
        let mut guard = options.open(&path).map_err(io_error)?;
        let mut current = Vec::new();
        Read::by_ref(&mut guard)
            .take(2 * 1024 * 1024 + 1)
            .read_to_end(&mut current)
            .map_err(io_error)?;
        if current != expected {
            return Err(error("Steam 配置已被其他进程修改，未覆盖"));
        }
        let temporary = path.with_file_name(format!(".zhenjing-{}.tmp", uuid::Uuid::new_v4()));
        let result = (|| {
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temporary)
                .map_err(io_error)?;
            file.write_all(&next).map_err(io_error)?;
            file.sync_all().map_err(io_error)?;
            drop(file);
            std::fs::rename(&temporary, &path).map_err(io_error)
        })();
        drop(guard);
        if result.is_err() {
            let _ = std::fs::remove_file(&temporary);
        }
        result
    })
    .await
    .map_err(|_| error("Steam 配置提交任务失败"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn configuration_commit_is_atomic_and_checks_original() -> Result<()> {
        tauri::async_runtime::block_on(async {
            let root = crate::services::tools::test_root("steam-transaction")?;
            let file = root.join("loginusers.vdf");
            tokio::fs::write(&file, b"original")
                .await
                .map_err(io_error)?;
            replace(&file, b"original", b"changed").await?;
            assert_eq!(scan::read(&file, 100).await?, b"changed");
            assert!(replace(&file, b"original", b"overwrite").await.is_err());
            assert_eq!(scan::read(&file, 100).await?, b"changed");
            Ok(())
        })
    }
}
