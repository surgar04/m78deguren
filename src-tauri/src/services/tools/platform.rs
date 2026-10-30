//! 固定PowerShell脚本桥接Windows管理API。用户值只作为参数传入，不拼接脚本文本。
use super::{Result, error, io_error};
use sha2::{Digest, Sha256};
use std::{path::Path, process::Stdio, time::Duration};
use tokio::{io::AsyncReadExt, process::Command};

/// 脚本进程存活期间持有只读文件句柄，禁止确认/UAC等待期间替换实际执行的脚本。
pub struct ScriptChild {
    child: tokio::process::Child,
    _source_guard: std::fs::File,
}
impl std::ops::Deref for ScriptChild {
    type Target = tokio::process::Child;
    fn deref(&self) -> &Self::Target {
        &self.child
    }
}
impl std::ops::DerefMut for ScriptChild {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.child
    }
}

const SCRIPT: &str = include_str!("windows.ps1");
const SYSTEM_SCRIPT: &str = include_str!("windows/system.ps1");

/// 使用系统的 Windows PowerShell，不依赖开发机 PATH 或用户安装的 PowerShell 7。
pub fn powershell_executable() -> Result<std::path::PathBuf> {
    let system = std::env::var_os("SystemRoot").ok_or_else(|| error("Windows 系统目录不可用"))?;
    let executable =
        std::path::PathBuf::from(system).join("System32/WindowsPowerShell/v1.0/powershell.exe");
    crate::storage_policy::validate_local_path(&executable, false)
        .map_err(|_| error("Windows PowerShell 路径无效"))?;
    Ok(executable)
}

/// 子进程固定使用Windows自带模块，避免继承PowerShell 7的同名模块而在5.1中加载失败。
pub fn configure_modules(command: &mut Command) -> Result<()> {
    let system = std::env::var_os("SystemRoot").ok_or_else(|| error("Windows系统目录不可用"))?;
    command.env(
        "PSModulePath",
        std::path::PathBuf::from(system).join("System32/WindowsPowerShell/v1.0/Modules"),
    );
    Ok(())
}

/// 内容寻址确保升级后不会继续运行旧脚本；UTF-8 BOM兼容Windows PowerShell 5.1。
pub fn script_path(root: &Path) -> std::path::PathBuf {
    root.join("scripts").join(format!(
        "windows-tools-{:x}.ps1",
        Sha256::digest(SCRIPT.as_bytes())
    ))
}

pub async fn run(
    root: &Path,
    operation: &str,
    arguments: &[String],
    limit: Duration,
) -> Result<serde_json::Value> {
    run_embedded(root, operation, arguments, limit, SCRIPT).await
}

/// 扩展工具使用独立的固定脚本，源码由编译产物携带，IPC 不接受脚本路径或脚本文本。
pub async fn run_system(
    root: &Path,
    operation: &str,
    arguments: &[String],
    limit: Duration,
) -> Result<serde_json::Value> {
    let source = system_source();
    run_embedded(root, operation, arguments, limit, &source).await
}

fn system_source() -> String {
    // 只组合固定脚本；C# 适配器已经编译为安装目录中的受校验 DLL。
    let source = SYSTEM_SCRIPT.replace("# __NATIVE_HELPERS__", include_str!("windows/native.ps1"));
    let source = source.replace("# __FILTER_HELPERS__", include_str!("windows/filter.ps1"));
    let source = source.replace(
        "# __OPTIMIZATION_HELPERS__",
        include_str!("windows/optimizer.ps1"),
    );
    use base64::Engine;
    let source = source.replace(
        "__OPTIMIZER_CATALOG_BASE64__",
        &base64::engine::general_purpose::STANDARD.encode(super::optimizer::CATALOG),
    );

    source.replace(
        "__NVIDIA_SETTINGS__",
        include_str!("windows/nvidia-settings.json"),
    )
}

pub async fn spawn_display_watch(root: &Path, arguments: &[String]) -> Result<ScriptChild> {
    spawn_embedded(root, "display-watch", arguments, &system_source()).await
}
pub async fn spawn_filter(root: &Path, arguments: &[String]) -> Result<ScriptChild> {
    spawn_embedded(root, "filter-run", arguments, &system_source()).await
}

pub(crate) async fn run_embedded(
    root: &Path,
    operation: &str,
    arguments: &[String],
    limit: Duration,
    source: &str,
) -> Result<serde_json::Value> {
    let mut child = spawn_embedded(root, operation, arguments, source).await?;
    collect_output(&mut child, operation, limit).await
}

/// 长期输入服务也只能启动编译期绑定的脚本；调用方负责取消与读取有界状态消息。
pub async fn spawn_input(root: &Path, arguments: &[String]) -> Result<ScriptChild> {
    spawn_embedded(
        root,
        "autoclicker",
        arguments,
        include_str!("windows/input.ps1"),
    )
    .await
}

pub(crate) async fn spawn_embedded(
    root: &Path,
    operation: &str,
    arguments: &[String],
    source: &str,
) -> Result<ScriptChild> {
    if !cfg!(windows) {
        return Err(error("此工具需要 Windows 桌面环境"));
    }
    // 同一份路径策略进入内容哈希和源码锁；脚本进程无需访问开发工作区。
    let source = source.replace(
        "# __STORAGE_POLICY__",
        include_str!("windows/storage-policy.ps1"),
    );
    let source = super::super::components::expand_managed_loader(source).await?;
    let scripts = root.join("scripts");
    super::check_local_path(&scripts).await?;
    tokio::fs::create_dir_all(&scripts)
        .await
        .map_err(io_error)?;
    let script = scripts.join(format!(
        "windows-tools-{:x}.ps1",
        Sha256::digest(source.as_bytes())
    ));
    super::check_local_path(&script).await?;
    // 所有调用写入同一不可变脚本内容；并发写采用独立临时名再替换，避免读取半个脚本。
    let expected = format!("\u{feff}{source}");
    if tokio::fs::read(&script).await.ok().as_deref() != Some(expected.as_bytes()) {
        let temporary = scripts.join(format!("{}.tmp", uuid::Uuid::new_v4()));
        tokio::fs::write(&temporary, expected.as_bytes())
            .await
            .map_err(io_error)?;
        if let Err(cause) = tokio::fs::rename(&temporary, &script).await {
            // 另一个查询可能已发布并锁定相同内容；此时复用成品，不能将正常并发误判为失败。
            let identical =
                tokio::fs::read(&script).await.ok().as_deref() == Some(expected.as_bytes());
            let _ = tokio::fs::remove_file(&temporary).await;
            if !identical {
                return Err(io_error(cause));
            }
        }
    }
    let protected = script.clone();
    let source_guard = tauri::async_runtime::spawn_blocking(move || -> Result<std::fs::File> {
        use std::io::Read;
        let mut options = std::fs::OpenOptions::new();
        options.read(true);
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            options.share_mode(1);
        }
        let mut file = options.open(&protected).map_err(io_error)?;
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes).map_err(io_error)?;
        if bytes != expected.as_bytes() {
            return Err(error("工具脚本完整性校验失败"));
        }
        Ok(file)
    })
    .await
    .map_err(|_| error("工具脚本保护任务失败"))??;
    let mut command = Command::new(powershell_executable()?);
    super::super::components::configure_child(&mut command);
    configure_modules(&mut command)?;
    command
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
        ])
        .arg(&script)
        .arg("-Operation")
        .arg(operation)
        .arg("-ArgumentJson")
        .arg(serde_json::to_string(arguments).map_err(|_| error("操作参数无效"))?)
        .stdin(
            if matches!(operation, "autoclicker" | "settings-media" | "home-runtime") {
                Stdio::piped()
            } else {
                Stdio::null()
            },
        )
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        // 显示模式看门狗必须独立存活到恢复完成；主应用崩溃时不能先杀掉恢复进程。
        .kill_on_drop(
            ![
                "display-watch",
                "filter-run",
                "settings-maintenance",
                "migrate",
                "home-runtime",
            ]
            .contains(&operation),
        );
    for key in ["TEMP", "TMP", "APPDATA", "LOCALAPPDATA", "USERPROFILE"] {
        let folder = root.join("process").join(key);
        super::check_local_path(&folder).await?;
        tokio::fs::create_dir_all(&folder).await.map_err(io_error)?;
        command.env(key, folder);
    }
    let powershell_cache = root.join("process/LOCALAPPDATA/ModuleAnalysisCache");
    super::check_local_path(&powershell_cache).await?;
    command.env("PSModuleAnalysisCachePath", powershell_cache);
    #[cfg(windows)]
    {
        command.creation_flags(0x0800_0000);
    }
    let child = command
        .spawn()
        .map_err(|_| error("Windows 管理服务无法启动"))?;
    Ok(ScriptChild {
        child,
        _source_guard: source_guard,
    })
}

async fn collect_output(
    child: &mut tokio::process::Child,
    operation: &str,
    limit: Duration,
) -> Result<serde_json::Value> {
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| error("无法读取Windows操作结果"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| error("无法读取Windows错误结果"))?;
    let work = async {
        let out = async {
            let mut data = Vec::new();
            stdout
                .take(2_097_153)
                .read_to_end(&mut data)
                .await
                .map(|_| data)
        };
        let err = async {
            let mut data = Vec::new();
            stderr
                .take(65_536)
                .read_to_end(&mut data)
                .await
                .map(|_| data)
        };
        let (out, err, exit) = tokio::join!(out, err, child.wait());
        let out = out.map_err(io_error)?;
        let err = err.map_err(io_error)?;
        if !exit.map_err(io_error)?.success() {
            log::warn!(
                "Windows工具 {operation} 失败: {}",
                String::from_utf8_lossy(&err)
            );
            if let Ok(value) = serde_json::from_slice::<serde_json::Value>(&out)
                && let Some(message) = value["failure"].as_str().filter(|value| {
                    value.len() <= 8000
                        && !value.chars().any(|character| {
                            character.is_control() && !matches!(character, '\n' | '\r' | '\t')
                        })
                })
            {
                return Err(error(message));
            }
            return Err(error(
                "Windows操作失败，请检查管理员权限、文件占用或系统组件状态",
            ));
        }
        if out.len() > 2_097_152 {
            return Err(error("系统返回数据过大，请缩小查询范围"));
        }
        serde_json::from_slice(&out).map_err(|_| error("Windows 返回的数据格式不正确"))
    };
    tokio::time::timeout(limit, work)
        .await
        .map_err(|_| error("Windows操作超时，请重试；尚未报告操作成功"))?
}
