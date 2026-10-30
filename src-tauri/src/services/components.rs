//! 安装组件唯一入口：程序文件来自 MSI 安装目录，运行数据来自用户档案，禁止混用。
use crate::services::tools::{Result, error, io_error};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};

#[derive(Deserialize)]
struct Manifest {
    files: BTreeMap<String, String>,
}
pub struct Bundle {
    pub executable: PathBuf,
    // 文件锁伴随子进程持有，防止校验与实际 CLR 加载之间替换 DLL/配置文件。
    pub _guards: Vec<std::fs::File>,
}
/// 固定管理进程不继承额外程序集或分析器注入，避免环境变量绕过组件摘要验证。
pub fn configure_child(command: &mut tokio::process::Command) {
    for key in [
        "DOTNET_STARTUP_HOOKS",
        "DOTNET_ADDITIONAL_DEPS",
        "DOTNET_SHARED_STORE",
        "CORECLR_ENABLE_PROFILING",
        "CORECLR_PROFILER",
        "CORECLR_PROFILER_PATH",
        "COR_ENABLE_PROFILING",
        "COR_PROFILER",
        "COR_PROFILER_PATH",
    ] {
        command.env_remove(key);
    }
    command.env("DOTNET_MULTILEVEL_LOOKUP", "0");
}
fn root(component: &str) -> Result<PathBuf> {
    let executable = std::env::current_exe().map_err(io_error)?;
    let installed = executable
        .parent()
        .ok_or_else(|| error("应用安装位置不可用"))?
        .join("components")
        .join(component);
    if installed.is_dir() {
        return Ok(installed);
    }
    #[cfg(debug_assertions)]
    {
        // 仅调试构建可读源码资源；发布版没有工作区或开发机盘符回退。
        let resources = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources");
        let development = match component {
            "monitor" => resources.join("hardware-monitor/runtime"),
            "windows-bridge" => resources.join("windows-bridge"),
            _ => return Err(error("未知组件")),
        };
        Ok(development)
    }
    #[cfg(not(debug_assertions))]
    Err(error("安装组件目录缺失，请使用 MSI 修复或重新安装臻境"))
}
fn validate_name(name: &str) -> Result<()> {
    if name.is_empty()
        || name.len() > 240
        || name.contains(['\\', ':'])
        || name.starts_with('/')
        || name.split('/').any(|part| {
            part.is_empty()
                || part == "."
                || part == ".."
                || !part
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_'))
        })
    {
        return Err(error("组件清单包含无效文件名"));
    }
    Ok(())
}
fn protect(path: &Path, expected: &str) -> Result<std::fs::File> {
    crate::storage_policy::validate_local_path(path, false).map_err(|_| error("组件路径不安全"))?;
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.share_mode(1);
    }
    let mut file = options
        .open(path)
        .map_err(|_| error("组件缺失或无法读取，请修复安装"))?;
    let metadata = file.metadata().map_err(io_error)?;
    if !metadata.is_file() || metadata.len() > 134217728 {
        return Err(error("组件不是普通文件"));
    }
    use std::io::Read;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 65536];
    loop {
        let size = file.read(&mut buffer).map_err(io_error)?;
        if size == 0 {
            break;
        }
        digest.update(&buffer[..size]);
    }
    if format!("{:x}", digest.finalize()) != expected {
        return Err(error("组件摘要不匹配，请修复安装"));
    }
    Ok(file)
}
pub async fn monitor() -> Result<Bundle> {
    tauri::async_runtime::spawn_blocking(|| {
        let directory = root("monitor")?;
        let manifest: Manifest = serde_json::from_str(include_str!(
            "../../resources/hardware-monitor/manifest.json"
        ))
        .map_err(|_| error("硬件组件清单无效"))?;
        if manifest.files.is_empty() || manifest.files.len() > 2048 {
            return Err(error("硬件组件清单范围无效"));
        }
        let mut guards = Vec::with_capacity(manifest.files.len());
        for (name, hash) in manifest.files {
            validate_name(&name)?;
            guards.push(protect(&directory.join(name), &hash)?);
        }
        Ok(Bundle {
            executable: directory.join("ZhenjingMonitor.exe"),
            _guards: guards,
        })
    })
    .await
    .map_err(|_| error("硬件组件校验任务失败"))?
}
pub async fn expand_managed_loader(source: String) -> Result<String> {
    if !source.contains("# __MANAGED_BRIDGE__") {
        return Ok(source);
    }
    let (path, hash) = tauri::async_runtime::spawn_blocking(|| -> Result<_> {
        let manifest: Manifest =
            serde_json::from_str(include_str!("../../resources/windows-bridge/manifest.json"))
                .map_err(|_| error("Windows DLL 清单无效"))?;
        let hash = manifest
            .files
            .get("Zhenjing.Windows.dll")
            .ok_or_else(|| error("Windows DLL 摘要缺失"))?
            .clone();
        let path = root("windows-bridge")?.join("Zhenjing.Windows.dll");
        let _guard = protect(&path, &hash)?;
        Ok((path, hash))
    })
    .await
    .map_err(|_| error("Windows DLL 校验任务失败"))??;
    use base64::Engine;
    let loader = include_str!("managed-loader.ps1")
        .replace(
            "__MANAGED_PATH_BASE64__",
            &base64::engine::general_purpose::STANDARD.encode(path.to_string_lossy().as_bytes()),
        )
        .replace("__MANAGED_SHA256__", &hash);
    Ok(source.replace("# __MANAGED_BRIDGE__", &loader))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn component_integrity_rejects_tampering_and_locks_verified_file() -> Result<()> {
        let root = crate::services::tools::test_root("component-integrity")?;
        let path = root.join("fixture.dll");
        std::fs::write(&path, b"integrity-fixture").map_err(io_error)?;
        let digest = format!("{:x}", Sha256::digest(b"integrity-fixture"));
        assert!(protect(&path, &"0".repeat(64)).is_err());
        let guard = protect(&path, &digest)?;
        #[cfg(windows)]
        assert!(std::fs::write(&path, b"tampered").is_err());
        drop(guard);
        std::fs::write(&path, b"tampered").map_err(io_error)?;
        assert!(protect(&path, &digest).is_err());
        Ok(())
    }
    #[test]
    fn manifest_names_cannot_escape_install_directory() {
        for name in [
            "../evil.dll",
            "C:/evil.dll",
            "\\\\host\\evil.dll",
            "a/../../evil.dll",
            "a:stream",
            "/evil.dll",
        ] {
            assert!(validate_name(name).is_err());
        }
        for name in [
            "System.Private.CoreLib.dll",
            "runtimes/win-x64/native/helper.dll",
        ] {
            assert!(validate_name(name).is_ok());
        }
    }
}
