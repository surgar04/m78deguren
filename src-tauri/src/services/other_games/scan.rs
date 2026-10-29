//! 扫描运行在阻塞工作线程。优先可信位置、随后按需遍历；跳过重解析点与系统数据。
use super::{catalog, types::*};
use crate::services::tools::{Result, error, io_error};
use std::{
    collections::{HashSet, VecDeque},
    io::Read,
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};
use tokio_util::sync::CancellationToken;
pub fn read_small(path: &Path, limit: usize) -> Option<String> {
    crate::storage_policy::validate_local_path(path, false).ok()?;
    let file = std::fs::File::open(path).ok()?;
    if file.metadata().ok()?.len() > limit as u64 {
        return None;
    }
    let mut bytes = Vec::new();
    file.take(limit as u64 + 1).read_to_end(&mut bytes).ok()?;
    if bytes.len() > limit {
        return None;
    }
    let text = if bytes.starts_with(&[255, 254]) {
        String::from_utf16(
            &bytes[2..]
                .chunks_exact(2)
                .map(|v| u16::from_le_bytes([v[0], v[1]]))
                .collect::<Vec<_>>(),
        )
        .ok()?
    } else {
        String::from_utf8(bytes).ok()?
    };
    Some(text.trim_start_matches('\u{feff}').to_owned())
}
fn linked(meta: &std::fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if meta.file_attributes() & 0x400 != 0 {
            return true;
        }
    }
    meta.file_type().is_symlink()
}
pub fn local_file(path: &Path) -> bool {
    crate::storage_policy::validate_local_path(path, false).is_ok()
        && std::fs::symlink_metadata(path).is_ok_and(|m| m.is_file() && !linked(&m))
}
pub fn pe(path: &Path) -> bool {
    if !local_file(path) {
        return false;
    }
    use std::io::Seek;
    let Ok(mut f) = std::fs::File::open(path) else {
        return false;
    };
    let mut h = [0; 64];
    if f.read_exact(&mut h).is_err() || &h[..2] != b"MZ" {
        return false;
    }
    let offset = u32::from_le_bytes([h[60], h[61], h[62], h[63]]);
    if !(64..=16 * 1024 * 1024).contains(&offset)
        || f.seek(std::io::SeekFrom::Start(u64::from(offset))).is_err()
    {
        return false;
    }
    let mut sig = [0; 4];
    f.read_exact(&mut sig).is_ok() && sig == *b"PE\0\0"
}
/// 同名 EXE 不能单独构成安装证明，必须存在对应游戏的数据结构。
fn game_layout(path: &Path) -> bool {
    let Some(parent) = path.parent() else {
        return false;
    };
    let name = path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_lowercase();
    if matches!(
        name.as_str(),
        "yuanshen.exe"
            | "genshinimpact.exe"
            | "bh3.exe"
            | "starrail.exe"
            | "arknights.exe"
            | "endfield.exe"
    ) {
        let stem = path.file_stem().unwrap_or_default().to_string_lossy();
        return parent.join(format!("{stem}_Data")).is_dir()
            && local_file(&parent.join("UnityPlayer.dll"));
    }
    if name == "wuthering waves.exe" {
        return parent.join("Client").is_dir() && parent.join("Engine").is_dir();
    }
    if name == "client-win64-shipping.exe" {
        // 这是很多 Unreal 游戏共用的文件名，不能凭 Content/Paks 误认成鸣潮。
        // 只接受官方 Client/Binaries/Win64 布局及同一安装根的鸣潮包装器。
        return parent.ancestors().nth(3).is_some_and(|root| {
            parent
                .file_name()
                .is_some_and(|name| name.eq_ignore_ascii_case("Win64"))
                && parent
                    .parent()
                    .and_then(Path::file_name)
                    .is_some_and(|name| name.eq_ignore_ascii_case("Binaries"))
                && parent
                    .ancestors()
                    .nth(2)
                    .and_then(Path::file_name)
                    .is_some_and(|name| name.eq_ignore_ascii_case("Client"))
                && pe(&root.join("Wuthering Waves.exe"))
                && root.join("Engine").is_dir()
        });
    }
    parent
        .ancestors()
        .take(4)
        .any(|root| root.join("Content/Paks").is_dir())
}
pub fn normalize(path: &Path) -> Result<PathBuf> {
    crate::storage_policy::validate_local_path(path, false)
        .map_err(|_| error("游戏路径必须为本地绝对路径，不能包含链接"))?;
    for parent in path.ancestors() {
        if std::fs::symlink_metadata(parent).is_ok_and(|meta| linked(&meta)) {
            return Err(error("游戏路径不能包含目录联接或符号链接"));
        }
    }
    let path = std::fs::canonicalize(path).map_err(io_error)?;
    let text = path.to_string_lossy();
    Ok(PathBuf::from(text.strip_prefix("\\\\?\\").unwrap_or(&text)))
}
/// 区服采用单个安装实例的证据；不会因为本机注册过另一个区服就误标当前目录。
pub fn region(path: &Path, family: &str, hint: &Hint) -> (Region, Vec<String>) {
    let name = path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_lowercase();
    if name == "yuanshen.exe" {
        return (Region::Cn, vec!["国服专用 YuanShen.exe".into()]);
    }
    if name == "genshinimpact.exe" {
        return (Region::Global, vec!["国际服专用 GenshinImpact.exe".into()]);
    }
    if hint.region != Region::Unknown && (hint.family.is_empty() || hint.family == family) {
        return (hint.region.clone(), vec![hint.source.clone()]);
    }
    let biz = match family {
        "genshin" => "hk4e",
        "honkai3" => "bh3",
        "starrail" => "hkrpg",
        _ => "",
    };
    let Some(parent) = path.parent() else {
        return (Region::Unknown, Vec::new());
    };
    // 只看当前安装的 game_biz；父启动器可以同时管理多个区服，不能混合其全局 JSON 判断。
    if !biz.is_empty()
        && let Some(text) = read_small(&parent.join("config.ini"), 65536)
    {
        for line in text.lines() {
            if let Some((key, value)) = line.split_once('=')
                && key.trim().eq_ignore_ascii_case("game_biz")
            {
                let value = value.trim().to_lowercase();
                if value == format!("{biz}_cn") {
                    return (Region::Cn, vec!["本安装 config.ini 的 game_biz".into()]);
                }
                if value == format!("{biz}_global") {
                    return (Region::Global, vec!["本安装 config.ini 的 game_biz".into()]);
                }
                // 崩坏3旧启动器保留独立的日/韩/繁中/东南亚客户端标识。
                if biz == "bh3" {
                    let region = match value.as_str() {
                        "bh3_jp" => Some(Region::Jp),
                        "bh3_kr" => Some(Region::Kr),
                        "bh3_asia" | "bh3_tw" => Some(Region::Tw),
                        "bh3_os" | "bh3_overseas" => Some(Region::Global),
                        _ => None,
                    };
                    if let Some(region) = region {
                        return (region, vec!["本安装 config.ini 的 game_biz".into()]);
                    }
                }
            }
        }
    }
    if family == "arknights" {
        if let Some(text) = read_small(&parent.join("Arknights_Data/app.info"), 4096) {
            let lines: Vec<_> = text.lines().map(str::trim).collect();
            if let Some(product) = lines.get(1) {
                let region = match product.to_ascii_lowercase().as_str() {
                    "arknights_en" => Some(Region::Global),
                    "arknights_jp" => Some(Region::Jp),
                    "arknights_kr" => Some(Region::Kr),
                    "arknights_tc" => Some(Region::Tw),
                    "arknights"
                        if lines
                            .first()
                            .is_some_and(|company| company.eq_ignore_ascii_case("HyperGryph")) =>
                    {
                        Some(Region::Cn)
                    }
                    _ => None,
                };
                if let Some(region) = region {
                    return (region, vec!["当前 Unity app.info 的产品标识".into()]);
                }
            }
        }
        if let Some(text) = read_small(&parent.join("game-launcher-config.json"), 65536)
            && let Ok(json) = serde_json::from_str::<serde_json::Value>(&text)
        {
            let region = match json["tag"].as_str() {
                Some("Arknights_EN") => Some(Region::Global),
                Some("Arknights_JP") => Some(Region::Jp),
                Some("Arknights_KR") => Some(Region::Kr),
                _ => None,
            };
            if let Some(region) = region {
                return (region, vec!["本安装 Yostar 渠道 tag".into()]);
            }
        }
    }
    for folder in path.ancestors().skip(1).take(7) {
        if family == "nte" {
            let global = local_file(&folder.join("NTEGlobalLauncher.exe"));
            let cn = local_file(&folder.join("NTELauncher.exe"));
            if global != cn {
                return (
                    if global { Region::Global } else { Region::Cn },
                    vec!["当前安装的官方 NTE 启动器".into()],
                );
            }
        }
        if family == "endfield" && local_file(&folder.join("GRYPHLINK.exe")) {
            return (Region::Global, vec!["GRYPHLINK 启动器".into()]);
        }
        if matches!(family, "wuthering" | "deltaforce") {
            for file in [
                "config.ini",
                "config.json",
                "launcherDownloadConfig.json",
                "Config/Config.ini",
                "TCLS/config/ServerInfo.xml",
                "TCLS/config/Config.xml",
            ] {
                if let Some(text) = read_small(&folder.join(file), 262144) {
                    let text = text.to_ascii_lowercase();
                    let (cn, global) = if family == "deltaforce" {
                        (
                            text.contains("df.qq.com") || text.contains("deltaforce.qq.com"),
                            text.contains("playdeltaforce.com") || text.contains("df.garena.com"),
                        )
                    } else {
                        (
                            text.contains("aki-gm-resources.aki-game.com")
                                || text.contains("prod-alicdn-gamestarter.kurogame.com"),
                            text.contains("aki-gm-resources-oversea"),
                        )
                    };
                    if cn != global {
                        return (
                            if cn { Region::Cn } else { Region::Global },
                            vec![format!("当前启动器配置 {file} 的官方资源域名")],
                        );
                    }
                }
            }
        }
    }
    (Region::Unknown, Vec::new())
}
pub struct Found {
    pub path: PathBuf,
    pub hint: Hint,
}
pub struct Walk {
    pub found: Vec<Found>,
    pub visited: u64,
    pub skipped: u64,
    pub complete: bool,
}
fn skip(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "windows"
            | "$recycle.bin"
            | "system volume information"
            | "node_modules"
            | ".git"
            | ".cache"
            | ".tools"
            | ".local"
            | "winsxs"
            | "driverstore"
            | "windowsapps"
            | "recovery"
            | "system32"
            | "syswow64"
            | "pakchunks"
            | "paks"
            | "bundles"
            | "assetbundles"
    )
}
pub fn walk(
    hints: Vec<Hint>,
    deep: bool,
    cancel: CancellationToken,
    progress: Arc<AtomicU64>,
) -> Walk {
    let started = Instant::now();
    let deadline = Duration::from_secs(if deep { 240 } else { 45 });
    let limit = if deep { 800_000 } else { 80_000 };
    let mut hints = hints;
    hints.sort_by_key(|hint| hint.region == Region::Unknown);
    let mut queue: VecDeque<_> = hints
        .into_iter()
        .map(|hint| {
            let mut path = PathBuf::from(&hint.path);
            if path
                .extension()
                .is_some_and(|v| v.eq_ignore_ascii_case("exe"))
                && catalog::by_exe(&path.file_name().unwrap_or_default().to_string_lossy())
                    .is_none()
                && let Some(parent) = path.parent()
            {
                path = parent.to_owned()
            }
            (path, 0_u8, Arc::new(hint))
        })
        .collect();
    let mut seen = HashSet::new();
    let mut found = Vec::new();
    let (mut visited, mut skipped) = (0, 0);
    let mut complete = true;
    while let Some((path, depth, hint)) = queue.pop_front() {
        if cancel.is_cancelled() || started.elapsed() > deadline || visited >= limit {
            complete = false;
            break;
        }
        if !seen.insert(path.to_string_lossy().to_lowercase()) {
            continue;
        }
        let raw = path.to_string_lossy();
        let bytes = raw.as_bytes();
        let drive_root = bytes.len() == 3
            && bytes[0].is_ascii_alphabetic()
            && bytes[1] == b':'
            && matches!(bytes[2], b'\\' | b'/');
        if !drive_root && crate::storage_policy::validate_local_path(&path, false).is_err() {
            skipped += 1;
            continue;
        }
        let Ok(meta) = std::fs::symlink_metadata(&path) else {
            continue;
        };
        if linked(&meta) {
            skipped += 1;
            continue;
        }
        visited += 1;
        if visited % 64 == 0 {
            progress.store(visited, Ordering::Relaxed)
        }
        if meta.is_file() {
            if catalog::by_exe(&path.file_name().unwrap_or_default().to_string_lossy()).is_some()
                && pe(&path)
                && game_layout(&path)
                && (hint.family.is_empty()
                    || catalog::by_exe(&path.file_name().unwrap_or_default().to_string_lossy())
                        .is_some_and(|profile| profile.id == hint.family))
            {
                found.push(Found {
                    path,
                    hint: (*hint).clone(),
                });
                if found.len() >= 128 {
                    complete = false;
                    break;
                }
            }
            continue;
        }
        if !meta.is_dir() || depth >= if deep { 16 } else { 8 } {
            continue;
        }
        let Ok(entries) = std::fs::read_dir(&path) else {
            skipped += 1;
            continue;
        };
        // 每个目录最多枚举 20,000 项，避免异常数据目录占满队列；总队列同样有上界。
        for entry in entries.take(20001) {
            let Ok(entry) = entry else {
                skipped += 1;
                continue;
            };
            if queue.len() > 200_000 {
                complete = false;
                break;
            }
            let name = entry.file_name();
            let text = name.to_string_lossy();
            if skip(&text) {
                continue;
            }
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if kind.is_dir() || catalog::by_exe(&text).is_some() {
                queue.push_back((entry.path(), depth + 1, hint.clone()))
            }
        }
    }
    progress.store(visited, Ordering::Relaxed);
    Walk {
        found,
        visited,
        skipped,
        complete,
    }
}
pub fn launcher(path: &Path, profile: &catalog::Profile) -> Option<String> {
    for parent in path.ancestors().skip(1).take(8) {
        for name in profile.launchers {
            let candidate = parent.join(name);
            if pe(&candidate) {
                return Some(candidate.to_string_lossy().into_owned());
            }
        }
        if profile.id == "endfield"
            && parent.file_name().is_some_and(|name| {
                let name = name.to_string_lossy().to_lowercase();
                name.contains("gryph")
            })
        {
            let candidate = parent.join("launcher.exe");
            if pe(&candidate) {
                return Some(candidate.to_string_lossy().into_owned());
            }
        }
    }
    None
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn executable_alone_never_guesses_shared_region() {
        let hint = Hint::default();
        assert_eq!(
            region(Path::new("D:/Games/StarRail.exe"), "starrail", &hint).0,
            Region::Unknown
        );
        assert_eq!(
            region(Path::new("D:/Games/GenshinImpact.exe"), "genshin", &hint).0,
            Region::Global
        );
        assert!(catalog::by_exe("Client-Win64-Shipping.exe").is_some());
        assert_eq!(catalog::PROFILES.len(), 8);
    }
    #[test]
    fn scans_all_eight_profiles_deduplicates_and_rejects_name_only_files() -> Result<()> {
        let root = crate::services::tools::test_root("other-games-layout")?;
        let mut header = vec![0_u8; 68];
        header[..2].copy_from_slice(b"MZ");
        header[60..64].copy_from_slice(&64_u32.to_le_bytes());
        header[64..].copy_from_slice(b"PE\0\0");
        for profile in catalog::PROFILES {
            let folder = root.join(profile.id);
            std::fs::create_dir_all(&folder).map_err(io_error)?;
            let leaf = profile.executables[0];
            let path = folder.join(leaf);
            std::fs::write(&path, &header).map_err(io_error)?;
            match profile.id {
                "wuthering" => {
                    std::fs::create_dir_all(folder.join("Client")).map_err(io_error)?;
                    std::fs::create_dir_all(folder.join("Engine")).map_err(io_error)?;
                }
                "nte" | "deltaforce" => {
                    std::fs::create_dir_all(folder.join("Content/Paks")).map_err(io_error)?;
                }
                _ => {
                    let stem = path.file_stem().unwrap_or_default().to_string_lossy();
                    std::fs::create_dir_all(folder.join(format!("{stem}_Data")))
                        .map_err(io_error)?;
                    std::fs::write(folder.join("UnityPlayer.dll"), []).map_err(io_error)?;
                }
            }
        }
        let wrong = root.join("not-installed");
        std::fs::create_dir_all(&wrong).map_err(io_error)?;
        std::fs::write(wrong.join("StarRail.exe"), &header).map_err(io_error)?;
        std::fs::create_dir_all(wrong.join("Content/Paks")).map_err(io_error)?;
        std::fs::write(wrong.join("Client-Win64-Shipping.exe"), &header).map_err(io_error)?;
        let hints = vec![
            Hint {
                path: root.to_string_lossy().into_owned(),
                ..Hint::default()
            };
            2
        ];
        let result = walk(
            hints,
            true,
            CancellationToken::new(),
            Arc::new(AtomicU64::new(0)),
        );
        assert_eq!(result.found.len(), 8);
        assert!(result.complete);
        let cancel = CancellationToken::new();
        cancel.cancel();
        assert!(
            !walk(
                vec![Hint {
                    path: root.to_string_lossy().into_owned(),
                    ..Hint::default()
                }],
                true,
                cancel,
                Arc::new(AtomicU64::new(0))
            )
            .complete
        );
        Ok(())
    }
}
