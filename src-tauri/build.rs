fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("cargo:rerun-if-env-changed=ZHENJING_DEVELOPER_BUILD");
    if std::env::var_os("CARGO_FEATURE_DEVELOPER_EDITION").is_some() {
        let number: u64 = std::env::var("ZHENJING_DEVELOPER_BUILD")?.parse()?;
        if number == 0 || number > 999999 {
            return Err("开发者构建编号必须为 1..999999".into());
        }
        println!("cargo:rustc-env=ZHENJING_DEVELOPER_BUILD={number}");
    }
    use sha2::{Digest, Sha256};
    let base = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let directory = base.join("resources/hardware-monitor");
    let manifest: serde_json::Value =
        serde_json::from_slice(&std::fs::read(directory.join("manifest.json"))?)?;
    println!("cargo:rerun-if-changed=resources/hardware-monitor");
    // 包括迁入的 HUD 核心、语言资源和帧采集器；新增源码也不能漏过发布件一致性校验。
    fn collect(root: &std::path::Path, files: &mut Vec<std::path::PathBuf>) -> std::io::Result<()> {
        for entry in std::fs::read_dir(root)? {
            let entry = entry?;
            let kind = entry.file_type()?;
            let path = entry.path();
            if kind.is_symlink() {
                return Err(std::io::Error::other("硬件助手来源不能包含链接"));
            }
            if kind.is_dir() {
                if !["obj", "bin"].contains(&entry.file_name().to_string_lossy().as_ref()) {
                    collect(&path, files)?;
                }
            } else if path
                .extension()
                .and_then(|v| v.to_str())
                .is_some_and(|v| ["cs", "csproj", "props", "json", "exe", "dll"].contains(&v))
                || entry.file_name() == "NuGet.Config"
            {
                files.push(path);
            }
        }
        Ok(())
    }
    let sources = base.join("../native/hardware-monitor");
    let mut files = vec![];
    collect(&sources, &mut files)?;
    println!("cargo:rerun-if-changed={}", sources.display());
    files.sort();
    for path in files {
        let name = path
            .strip_prefix(&sources)?
            .to_string_lossy()
            .replace('\\', "/");
        println!("cargo:rerun-if-changed={}", path.display());
        let digest = format!("{:x}", Sha256::digest(std::fs::read(path)?));
        if manifest["sources"][&name].as_str() != Some(digest.as_str()) {
            return Err(format!("硬件助手源码与发布件不一致：{name}。请运行 powershell -NoProfile -File scripts/build-hardware-monitor.ps1").into());
        }
    }
    let entries = manifest["files"]
        .as_object()
        .ok_or("硬件 DLL 布局清单缺失")?;
    for (name, expected) in entries {
        let digest = format!(
            "{:x}",
            Sha256::digest(std::fs::read(directory.join("runtime").join(name))?)
        );
        if expected.as_str() != Some(digest.as_str()) {
            return Err(format!("硬件组件摘要不匹配：{name}").into());
        }
    }
    let bridge = base.join("resources/windows-bridge");
    let manifest: serde_json::Value =
        serde_json::from_slice(&std::fs::read(bridge.join("manifest.json"))?)?;
    if manifest["version"].as_str() != Some(env!("CARGO_PKG_VERSION")) {
        return Err("Windows DLL 与应用版本不一致".into());
    }
    for (name, expected) in manifest["sources"]
        .as_object()
        .ok_or("Windows DLL 来源清单缺失")?
    {
        let path = base.join("..").join(name);
        println!("cargo:rerun-if-changed={}", path.display());
        let digest = format!("{:x}", Sha256::digest(std::fs::read(path)?));
        if expected.as_str() != Some(digest.as_str()) {
            return Err(format!(
                "Windows DLL 来源与发布件不一致：{name}，请运行 scripts/build-windows-bridge.ps1"
            )
            .into());
        }
    }
    for (name, expected) in manifest["files"]
        .as_object()
        .ok_or("Windows DLL 文件清单缺失")?
    {
        let path = bridge.join(name);
        println!("cargo:rerun-if-changed={}", path.display());
        let digest = format!("{:x}", Sha256::digest(std::fs::read(path)?));
        if expected.as_str() != Some(digest.as_str()) {
            return Err("Windows DLL 摘要不匹配".into());
        }
    }
    println!(
        "cargo:rerun-if-changed={}",
        bridge.join("manifest.json").display()
    );
    // 音乐 sidecar 和主程序必须来自同一份工作树，禁止“前端更新、旧后端仍被打包”。
    let music = base.join("resources/music-host");
    let manifest: serde_json::Value =
        serde_json::from_slice(&std::fs::read(music.join("manifest.json"))?)?;
    for (name, expected) in manifest["sources"]
        .as_object()
        .ok_or("音乐组件缺少来源清单，请运行 music:host:build")?
    {
        let path = base.join("..").join(name);
        println!("cargo:rerun-if-changed={}", path.display());
        let actual = format!("{:x}", Sha256::digest(std::fs::read(path)?));
        if expected.as_str() != Some(actual.as_str()) {
            return Err(
                format!("音乐组件来源与发布件不一致：{name}，请运行 music:host:build").into(),
            );
        }
    }
    println!(
        "cargo:rerun-if-changed={}",
        music.join("manifest.json").display()
    );
    tauri_build::build();
    Ok(())
}
