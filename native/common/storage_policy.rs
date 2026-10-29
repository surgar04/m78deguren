//! 发布运行路径与开发机写入约束分离。只依赖标准库，供主程序和安装引导共同使用。
use std::{
    io,
    path::{Component, Path, PathBuf, Prefix},
};

/// 只由开发入口设置，不编译进安装包；在本机验收时仍禁止向其他盘写入。
pub fn restricted_to_d() -> bool {
    std::env::var_os("ZHENJING_RESTRICT_WRITES_TO_D").is_some_and(|value| value == "1")
}

/// 纯语法校验，无文件创建。拒绝 UNC、设备路径、ADS、相对路径及 Win32 名称别名。
pub fn validate_local_path(path: &Path, restrict_d: bool) -> io::Result<()> {
    let invalid = || {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "请选择本地磁盘的独立普通目录或文件",
        )
    };
    let mut parts = path.components();
    let Some(Component::Prefix(prefix)) = parts.next() else {
        return Err(invalid());
    };
    let Prefix::Disk(drive) = prefix.kind() else {
        return Err(invalid());
    };
    if restrict_d && !drive.eq_ignore_ascii_case(&b'D') {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "开发环境仅允许写入 D 盘",
        ));
    }
    if parts.next() != Some(Component::RootDir) {
        return Err(invalid());
    }
    let mut count = 0;
    for part in parts {
        let Component::Normal(name) = part else {
            return Err(invalid());
        };
        let name = name.to_str().ok_or_else(invalid)?;
        if name.is_empty()
            || name.ends_with(['.', ' '])
            || name
                .chars()
                .any(|c| c.is_control() || ":<>\"|?*".contains(c))
        {
            return Err(invalid());
        }
        let stem = name
            .split('.')
            .next()
            .unwrap_or_default()
            .to_ascii_uppercase();
        if matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
            || ["COM", "LPT"].iter().any(|prefix| {
                stem.strip_prefix(prefix).is_some_and(|suffix| {
                    matches!(suffix, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9")
                })
            })
        {
            return Err(invalid());
        }
        count += 1;
    }
    if count == 0 {
        return Err(invalid());
    }
    Ok(())
}

/// 在写入前逐级核实已有祖先；仍保留原有的防符号链接及目录联接保护。
pub fn ensure_local_path(path: &Path) -> io::Result<()> {
    validate_local_path(path, restricted_to_d())?;
    for ancestor in path.ancestors() {
        match std::fs::symlink_metadata(ancestor) {
            Ok(metadata) => {
                use std::os::windows::fs::MetadataExt;
                if metadata.file_type().is_symlink() || metadata.file_attributes() & 0x400 != 0 {
                    return Err(io::Error::new(
                        io::ErrorKind::PermissionDenied,
                        "路径不能包含符号链接或目录联接",
                    ));
                }
            }
            Err(cause) if cause.kind() == io::ErrorKind::NotFound => {}
            Err(cause) => return Err(cause),
        }
    }
    Ok(())
}

/// 使用每个 Windows 用户自己的目录，不探测开发工作区，也不共享其他用户的账号/备份。
pub fn default_data_root() -> io::Result<PathBuf> {
    let base = std::env::var_os("LOCALAPPDATA")
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::NotFound,
                "当前用户的 LOCALAPPDATA 不可用，请使用 --data-dir 指定数据目录",
            )
        })?;
    let root = data_root_for_user(Path::new(&base))?;
    validate_local_path(&root, restricted_to_d())?;
    Ok(root)
}

/// 可在不访问其他用户目录的前提下验证默认目录派生规则。
pub fn data_root_for_user(local_app_data: &Path) -> io::Result<PathBuf> {
    let root = local_app_data.join("Zhenjing");
    validate_local_path(&root, false)?;
    Ok(root)
}

/// 路径可写不等于可作为“整份可重置档案”。这些边界只用于数据根，不限制系统只读探测或暂存文件。
pub fn validate_profile_location(
    root: &Path,
    system_trees: &[PathBuf],
    user_roots: &[PathBuf],
) -> io::Result<()> {
    fn key(path: &Path) -> String {
        let normalized: PathBuf = path.components().collect();
        let text = normalized.to_string_lossy().replace('/', "\\");
        text.strip_prefix(r"\\?\")
            .unwrap_or(&text)
            .trim_end_matches('\\')
            .to_lowercase()
    }
    let target = key(root);
    let system = system_trees.iter().any(|base| {
        let base = key(base);
        !base.is_empty() && (target == base || target.starts_with(&format!("{base}\\")))
    });
    if system || user_roots.iter().any(|base| target == key(base)) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "数据目录必须是独立的应用档案目录，不能使用系统目录、安装目录或整个用户目录",
        ));
    }
    Ok(())
}

pub fn validate_data_root(root: &Path) -> io::Result<()> {
    validate_local_path(root, restricted_to_d())?;
    let system_trees = [
        "SystemRoot",
        "ProgramFiles",
        "ProgramFiles(x86)",
        "ProgramData",
    ]
    .into_iter()
    .filter_map(std::env::var_os)
    .map(PathBuf::from)
    .collect::<Vec<_>>();
    let mut user_roots = ["USERPROFILE", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP"]
        .into_iter()
        .filter_map(std::env::var_os)
        .map(PathBuf::from)
        .collect::<Vec<_>>();
    if let Ok(exe) = std::env::current_exe()
        && let Some(parent) = exe.parent()
    {
        user_roots.push(parent.to_owned());
    }
    validate_profile_location(root, &system_trees, &user_roots)
}

/// 标准临时目录由操作系统/开发入口提供，不假定用户有 D 盘。
pub fn installer_temp_base() -> io::Result<PathBuf> {
    let root = std::env::temp_dir().join("ZhenjingInstaller");
    ensure_local_path(&root)?;
    Ok(root)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn profile_reset_never_targets_system_install_or_user_roots() {
        let system = [
            PathBuf::from("C:/Windows"),
            PathBuf::from("C:/Program Files"),
        ];
        let users = [
            PathBuf::from("C:/Users/Alice"),
            PathBuf::from("C:/Users/Alice/AppData/Local"),
            PathBuf::from("E:/Apps/Zhenjing"),
        ];
        for path in [
            "c:/WINDOWS",
            "C://Windows/Logs",
            "C:/Windows/Logs",
            "C:/Program Files/Other",
            "C:/Users/Alice",
            "C:/Users/Alice/AppData/Local",
            "E:/Apps/Zhenjing",
        ] {
            assert!(
                validate_profile_location(Path::new(path), &system, &users).is_err(),
                "{path}"
            );
        }
        for path in [
            "C:/Users/Alice/AppData/Local/Zhenjing",
            "E:/用户 数据/臻境",
            "C:/WindowsOld/Zhenjing",
        ] {
            assert!(
                validate_profile_location(Path::new(path), &system, &users).is_ok(),
                "{path}"
            );
        }
    }
    #[test]
    fn release_accepts_local_drives_without_io() {
        for path in [
            "C:/Users/测试/AppData/Local/Zhenjing",
            "E:/Games/臻境",
            "D:/Applications/Zhenjing",
        ] {
            assert!(
                validate_local_path(Path::new(path), false).is_ok(),
                "{path}"
            );
        }
    }
    #[test]
    fn different_windows_users_never_share_the_default_profile() -> io::Result<()> {
        let alice = data_root_for_user(Path::new("C:/Users/Alice/AppData/Local"))?;
        let bob = data_root_for_user(Path::new("E:/用户/小明/AppData/Local"))?;
        assert_ne!(alice, bob);
        assert_eq!(
            alice,
            PathBuf::from("C:/Users/Alice/AppData/Local/Zhenjing")
        );
        assert_eq!(bob, PathBuf::from("E:/用户/小明/AppData/Local/Zhenjing"));
        assert!(data_root_for_user(Path::new("relative")).is_err());
        Ok(())
    }
    #[test]
    fn development_restriction_is_explicit() {
        assert!(validate_local_path(Path::new("D:/data/app"), true).is_ok());
        assert!(validate_local_path(Path::new("C:/data/app"), true).is_err());
    }
    #[test]
    fn rejects_unsafe_names_and_roots_on_every_drive() {
        for path in [
            "C:/",
            "E:relative",
            "relative/data",
            "E:/data/../Windows",
            "E:/data:stream",
            "E:/data/NUL.txt",
            "E:/data/name.",
            r"\\server\share\data",
            r"\\?\C:\data",
        ] {
            assert!(
                validate_local_path(Path::new(path), false).is_err(),
                "{path}"
            );
        }
    }
}
