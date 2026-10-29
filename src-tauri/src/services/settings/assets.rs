//! 用户素材复制到本地目录后按内容摘要寻址；URL 只携带 ID，不暴露或接受任意本地路径。
use crate::services::tools::{Result, ensure_local_path, error, io_error, recordings, save_json};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Asset {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub mime: String,
    pub extension: String,
    pub bytes: u64,
}
#[derive(Clone)]
pub struct AssetStore {
    directory: PathBuf,
    pub entries: Vec<Asset>,
}
fn id_valid(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}
impl AssetStore {
    pub fn load(directory: &Path) -> Result<Self> {
        let directory = directory.join("assets");
        ensure_local_path(&directory)?;
        fs::create_dir_all(&directory).map_err(io_error)?;
        let entries: Vec<Asset> = match fs::read(directory.join("index.json")) {
            Ok(bytes) => {
                serde_json::from_slice(&bytes).map_err(|_| error("素材目录损坏，请从备份恢复"))?
            }
            Err(cause) if cause.kind() == std::io::ErrorKind::NotFound => Vec::new(),
            Err(cause) => return Err(io_error(cause)),
        };
        if entries.len() > 48
            || entries.iter().any(|entry| {
                !id_valid(&entry.id)
                    || !matches!(entry.kind.as_str(), "image" | "logo" | "video" | "font")
                    || !matches!(
                        entry.extension.as_str(),
                        "png" | "jpg" | "webp" | "mp4" | "webm" | "ttf" | "otf"
                    )
                    || entry.bytes == 0
                    || entry.bytes
                        > if entry.kind == "video" {
                            536_870_912
                        } else {
                            20_971_520
                        }
                    || entry.name.encode_utf16().count() > 100
                    || entry.name.chars().any(char::is_control)
                    || !matches!(
                        (entry.extension.as_str(), entry.mime.as_str()),
                        ("png", "image/png")
                            | ("jpg", "image/jpeg")
                            | ("webp", "image/webp")
                            | ("mp4", "video/mp4")
                            | ("webm", "video/webm")
                            | ("ttf", "font/ttf")
                            | ("otf", "font/otf")
                    )
            })
        {
            return Err(error("素材目录包含不受支持的记录"));
        }
        Ok(Self { directory, entries })
    }
    pub fn path(&self, id: &str) -> Result<(PathBuf, Asset)> {
        if !id_valid(id) {
            return Err(error("素材标识无效"));
        }
        let entry = self
            .entries
            .iter()
            .find(|entry| entry.id == id)
            .cloned()
            .ok_or_else(|| error("素材不存在或已经移除"))?;
        let path = self
            .directory
            .join(format!("{}.{}", entry.id, entry.extension));
        ensure_local_path(&path)?;
        Ok((path, entry))
    }
    /// 大视频以 64KiB 块复制和哈希；不把整个文件塞进 IPC、localStorage 或内存。
    pub fn import(
        &self,
        source: &Path,
        kind: &str,
        check_video: impl FnOnce(&Path) -> Result<()>,
    ) -> Result<Asset> {
        if self.entries.len() >= 48 || !matches!(kind, "image" | "logo" | "video" | "font") {
            return Err(error("素材类型无效或已达 48 项上限"));
        }
        let limit = if kind == "video" {
            536_870_912
        } else {
            20_971_520
        };
        let mut input = fs::File::open(source).map_err(io_error)?;
        let metadata = input.metadata().map_err(io_error)?;
        if !metadata.is_file() || metadata.len() == 0 || metadata.len() > limit {
            return Err(error(
                "素材为空或过大：视频最大 512MiB，图片/字体最大 20MiB",
            ));
        }
        // Windows 媒体属性处理器需要真实扩展名；暂存名仍由应用生成，不拼接用户文件名。
        let suffix = if kind == "video" {
            if source
                .extension()
                .is_some_and(|value| value.eq_ignore_ascii_case("webm"))
            {
                "webm"
            } else {
                "mp4"
            }
        } else {
            "tmp"
        };
        let temporary = self
            .directory
            .join(format!("incoming-{}.{suffix}", uuid::Uuid::new_v4()));
        ensure_local_path(&temporary)?;
        let result = (|| {
            let mut output = fs::OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(&temporary)
                .map_err(io_error)?;
            let mut hasher = Sha256::new();
            hasher.update(kind.as_bytes());
            let mut size = 0_u64;
            let mut prefix = Vec::new();
            let mut buffer = [0_u8; 65_536];
            loop {
                let read = input.read(&mut buffer).map_err(io_error)?;
                if read == 0 {
                    break;
                }
                size += read as u64;
                if size > limit {
                    return Err(error("复制期间素材大小超过限制"));
                }
                if prefix.len() < 65_536 {
                    prefix.extend_from_slice(&buffer[..read]);
                }
                hasher.update(&buffer[..read]);
                output.write_all(&buffer[..read]).map_err(io_error)?;
            }
            output.sync_all().map_err(io_error)?;
            drop(output);
            let (extension, mime) = inspect(&temporary, kind, &prefix)?;
            if kind == "video" {
                if extension != suffix {
                    return Err(error("视频扩展名与实际容器不一致，请选择 MP4 / WebM 文件"));
                }
                // 先检查暂存副本的真实时长，再发布素材；失败走统一清理，旧背景不受影响。
                check_video(&temporary)?;
            }
            let id = format!("{:x}", hasher.finalize());
            let target = self.directory.join(format!("{id}.{extension}"));
            ensure_local_path(&target)?;
            // 摘要相同的素材不可另建路径；目录及文件始终位于应用数据目录范围。
            fs::rename(&temporary, &target).map_err(io_error)?;
            let name: String = source
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("本机素材")
                .chars()
                .filter(|character| !character.is_control())
                .scan(0, |units, character| {
                    *units += character.len_utf16();
                    (*units <= 100).then_some(character)
                })
                .collect();
            Ok(Asset {
                id,
                name,
                kind: kind.into(),
                mime: mime.into(),
                extension: extension.into(),
                bytes: size,
            })
        })();
        if temporary.exists() {
            let _ = fs::remove_file(&temporary);
        }
        result
    }
    pub async fn record(&mut self, asset: Asset) -> Result<()> {
        let mut entries = self.entries.clone();
        entries.retain(|entry| entry.id != asset.id);
        entries.push(asset);
        save_json(&self.directory.join("index.json"), &entries).await?;
        self.entries = entries;
        Ok(())
    }
    pub async fn remove(&mut self, id: &str) -> Result<()> {
        let (path, _) = self.path(id)?;
        let entries: Vec<Asset> = self
            .entries
            .iter()
            .filter(|entry| entry.id != id)
            .cloned()
            .collect();
        // 先提交目录，再移除孤立内容；磁盘删除失败不会产生指向不存在文件的记录。
        save_json(&self.directory.join("index.json"), &entries).await?;
        self.entries = entries;
        match tokio::fs::remove_file(path).await {
            Ok(()) => Ok(()),
            Err(cause) if cause.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(cause) => Err(io_error(cause)),
        }
    }
}
fn inspect(path: &Path, kind: &str, prefix: &[u8]) -> Result<(&'static str, &'static str)> {
    if kind == "video" {
        if prefix.get(4..8) == Some(b"ftyp") {
            return Ok(("mp4", "video/mp4"));
        }
        if prefix.starts_with(&[0x1a, 0x45, 0xdf, 0xa3])
            && prefix.windows(4).any(|bytes| bytes == b"webm")
        {
            return Ok(("webm", "video/webm"));
        }
        return Err(error("视频仅支持有效的 MP4 或 WebM 容器"));
    }
    let bytes = fs::read(path).map_err(io_error)?;
    if kind == "font" {
        let face = ttf_parser::Face::parse(&bytes, 0)
            .map_err(|_| error("字体解析失败，仅支持完整的 TTF/OTF 字体"))?;
        if face.number_of_glyphs() == 0 {
            return Err(error("字体没有可用字形"));
        }
        return if bytes.starts_with(b"OTTO") {
            Ok(("otf", "font/otf"))
        } else {
            Ok(("ttf", "font/ttf"))
        };
    }
    let format = image::guess_format(&bytes).map_err(|_| error("图片格式无法识别"))?;
    let pair = match format {
        image::ImageFormat::Png => ("png", "image/png"),
        image::ImageFormat::Jpeg => ("jpg", "image/jpeg"),
        image::ImageFormat::WebP => ("webp", "image/webp"),
        _ => return Err(error("图片仅支持 PNG、JPEG、WebP")),
    };
    let reader = image::ImageReader::with_format(std::io::Cursor::new(&bytes), format);
    let (width, height) = reader.into_dimensions().map_err(|_| error("图片头损坏"))?;
    let minimum = if kind == "logo" { 16 } else { 180 };
    if width < minimum || height < minimum || u64::from(width) * u64::from(height) > 24_000_000 {
        return Err(error("图片过小或超过 2400 万像素"));
    }
    image::load_from_memory_with_format(&bytes, format)
        .map_err(|_| error("图片内容不完整或无法解码"))?;
    Ok(pair)
}
pub fn response(
    path: &Path,
    asset: &Asset,
    range: Option<&str>,
    head: bool,
) -> Result<tauri::http::Response<Vec<u8>>> {
    ensure_local_path(path)?;
    if asset.kind == "video" {
        return recordings::media_response(path, range, head);
    }
    let metadata = fs::metadata(path).map_err(io_error)?;
    if metadata.len() > 20_971_520 || metadata.len() != asset.bytes {
        return Err(error("素材文件大小与记录不符"));
    }
    let bytes = if head {
        Vec::new()
    } else {
        fs::read(path).map_err(io_error)?
    };
    tauri::http::Response::builder()
        .status(200)
        .header("Content-Type", &asset.mime)
        .header("Content-Length", metadata.len())
        .header("X-Content-Type-Options", "nosniff")
        .body(bytes)
        .map_err(|_| error("素材响应无法构造"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn imports_validated_image_and_rejects_forged_assets() -> Result<()> {
        let root = crate::services::tools::test_root("settings-assets")?;
        let store = AssetStore::load(&root)?;
        let source = root.join("preview.png");
        let image = image::RgbImage::new(320, 180);
        image.save(&source).map_err(|_| error("图片测试写入失败"))?;
        let asset = store.import(&source, "image", |_| Ok(()))?;
        assert_eq!(asset.kind, "image");
        assert_eq!(asset.id.len(), 64);
        fs::write(root.join("bad.ttf"), b"not a font").map_err(io_error)?;
        assert!(
            store
                .import(&root.join("bad.ttf"), "font", |_| Ok(()))
                .is_err()
        );
        assert!(store.path("../../secrets").is_err());
        assert!(
            !fs::read_dir(root.join("assets"))
                .map_err(io_error)?
                .filter_map(std::result::Result::ok)
                .any(
                    |entry| entry.path().extension().and_then(|value| value.to_str())
                        == Some("tmp")
                )
        );
        Ok(())
    }

    #[test]
    fn rejected_video_leaves_no_imported_or_temporary_file() -> Result<()> {
        let root = crate::services::tools::test_root("settings-video-rejection")?;
        let store = AssetStore::load(&root)?;
        let source = root.join("too-long.mp4");
        fs::write(&source, b"\0\0\0\x18ftypisom").map_err(io_error)?;
        assert!(
            store
                .import(&source, "video", |temporary| {
                    assert!(temporary.starts_with(root.join("assets")));
                    assert!(temporary.is_file());
                    Err(error("视频超过 15 秒"))
                })
                .is_err()
        );
        assert_eq!(
            fs::read_dir(root.join("assets")).map_err(io_error)?.count(),
            0
        );
        Ok(())
    }

    /// 先运行 scripts/verify-wallpaper.ts 生成真实编码的媒体，再显式执行本只读 Windows 验收。
    #[test]
    #[ignore = "需要 Windows 媒体属性接口及独立 D 盘视频夹具"]
    fn imports_real_short_videos_and_rejects_long_video() -> Result<()> {
        let root = crate::services::tools::test_root("wallpaper-real-video")?;
        let store = AssetStore::load(&root)?;
        let fixtures =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../.cache/verification/wallpaper-media");
        let import = |name: &str| {
            store.import(&fixtures.join(name), "video", |temporary| {
                tauri::async_runtime::block_on(super::super::video::validate(&root, temporary))
            })
        };
        assert_eq!(import("short.mp4")?.mime, "video/mp4");
        assert_eq!(import("short.webm")?.mime, "video/webm");
        let rejection = import("long.webm")
            .err()
            .ok_or_else(|| error("超长视频未被拒绝"))?;
        assert!(rejection.to_string().contains("15"));
        assert_eq!(
            fs::read_dir(root.join("assets")).map_err(io_error)?.count(),
            2
        );
        Ok(())
    }
}
