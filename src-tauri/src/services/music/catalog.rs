//! 本地歌曲登记：只读用户原件，封面/匹配覆盖层与索引放在当前用户档案。
use super::MusicState;
use crate::services::tools::{Result, error, io_error, save_json};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Entry {
    pub path: PathBuf,
    pub track: Value,
    pub matched: Option<Value>,
}
#[derive(Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Catalog {
    pub entries: BTreeMap<String, Entry>,
    #[serde(skip)]
    pub importing: bool,
    #[serde(skip)]
    pub processed: usize,
    #[serde(skip)]
    pub skipped: usize,
    #[serde(skip)]
    pub warning: String,
}
impl Catalog {
    pub fn load(root: &Path) -> Result<Self> {
        let path = root.join("library.json");
        if !path.exists() {
            return Ok(Self::default());
        }
        let metadata = std::fs::metadata(&path).map_err(io_error)?;
        if metadata.len() > 32 * 1024 * 1024 {
            return Err(error("本地音乐索引超过上限"));
        }
        let value: Self = serde_json::from_slice(&std::fs::read(&path).map_err(io_error)?)
            .map_err(|_| error("本地音乐索引损坏，请从备份恢复"))?;
        if value.entries.len() > 20000 {
            return Err(error("本地曲目数量超过上限"));
        }
        for (id, entry) in &value.entries {
            uuid::Uuid::parse_str(id).map_err(|_| error("本地音乐身份损坏"))?;
            // 文件可以被用户移动或位于暂时离线的磁盘；不能因此阻止整个应用启动。
            crate::storage_policy::validate_local_path(&entry.path, false)
                .map_err(|_| error("音乐索引路径无效"))?;
        }
        Ok(value)
    }
    pub fn snapshot(&self) -> Value {
        json!({"tracks":self.entries.values().map(|entry| {
            let mut track = entry.track.clone();
            if let Some(matched) = &entry.matched {
                for key in ["title", "artists", "album"] { track[key] = matched[key].clone(); }
                if !matched["cover"].is_null(){track["cover"]=matched["cover"].clone();}
                track["matched"] = json!(true);
                track["matchSource"] = json!({"provider":matched["provider"],"id":matched["id"]});
            }
            track
        }).collect::<Vec<_>>(),"importing":self.importing,"processed":self.processed,"skipped":self.skipped,"message":self.warning})
    }
}
pub fn read_path(path: &Path) -> Result<()> {
    crate::storage_policy::validate_local_path(path, false)
        .map_err(|_| error("音乐路径不是本地普通文件"))?;
    for ancestor in path.ancestors() {
        let metadata = std::fs::symlink_metadata(ancestor).map_err(io_error)?;
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if metadata.file_attributes() & 0x400 != 0 {
                return Err(error("音乐路径不能经过链接或联接"));
            }
        }
        if metadata.file_type().is_symlink() {
            return Err(error("音乐路径不能经过链接"));
        }
    }
    Ok(())
}
pub fn audio_file(path: &Path) -> bool {
    path.extension().and_then(|v| v.to_str()).is_some_and(|v| {
        matches!(
            v.to_ascii_lowercase().as_str(),
            "mp3"
                | "flac"
                | "wav"
                | "ogg"
                | "opus"
                | "m4a"
                | "aac"
                | "aiff"
                | "aif"
                | "wma"
                | "alac"
        )
    })
}
fn collect(selected: Vec<PathBuf>) -> (Vec<PathBuf>, usize) {
    let mut pending = selected;
    let mut files = Vec::new();
    let mut skipped = 0;
    let mut visited = 0;
    while let Some(path) = pending.pop() {
        visited += 1;
        if visited > 100000 || files.len() >= 20000 {
            skipped += pending.len() + 1;
            break;
        }
        if read_path(&path).is_err() {
            skipped += 1;
            continue;
        }
        if path.is_dir() {
            if let Ok(entries) = std::fs::read_dir(path) {
                pending.extend(entries.filter_map(|row| row.ok().map(|item| item.path())));
            }
        } else if audio_file(&path) {
            files.push(path);
        }
    }
    (files, skipped)
}
pub async fn import(app: tauri::AppHandle, state: &MusicState, folder: bool) -> Result<Value> {
    let selection = if folder {
        rfd::AsyncFileDialog::new()
            .set_title("选择本地音乐文件夹（只读导入）")
            .pick_folder()
            .await
            .map(|file| vec![file.path().to_owned()])
    } else {
        rfd::AsyncFileDialog::new()
            .set_title("添加本地音乐")
            .add_filter(
                "音频",
                &[
                    "mp3", "flac", "wav", "ogg", "opus", "m4a", "aac", "aiff", "wma",
                ],
            )
            .pick_files()
            .await
            .map(|files| files.iter().map(|file| file.path().to_owned()).collect())
    };
    let Some(selection) = selection else {
        return Ok(state.catalog.lock().await.snapshot());
    };
    {
        let mut catalog = state.catalog.lock().await;
        if catalog.importing {
            return Err(error("已有本地音乐导入任务"));
        }
        catalog.importing = true;
        catalog.processed = 0;
        catalog.skipped = 0;
    }
    // 扫目录与音频读取不占用 Tokio 的异步执行线程；一次只解析一首，限制峰值内存。
    let result = async {
        let (paths, skipped) = tauri::async_runtime::spawn_blocking(move || collect(selection)).await.map_err(|_| error("音乐文件扫描失败"))?;
        state.catalog.lock().await.skipped = skipped;
        for path in paths {
            let duplicate=state.catalog.lock().await.entries.values().any(|entry| entry.path == path);
            if duplicate { state.catalog.lock().await.skipped+=1;continue; }
            let metadata = state.rpc(&app, json!({"operation":"inspect","path":path})).await;
            let mut catalog = state.catalog.lock().await;
            let Ok(metadata) = metadata else { catalog.skipped += 1; continue; };
            let id = uuid::Uuid::new_v4().to_string();
            let cover = if let Some(encoded) = metadata["cover"]["data"].as_str() {
                use base64::Engine;
                if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(encoded) {
                    if bytes.len() <= 4 * 1024 * 1024 {
                        tokio::fs::write(state.root.join("covers").join(&id), bytes).await.map_err(io_error)?;
                        Some(format!("http://zhenjing-music.localhost/cover/{id}"))
                    } else { None }
                } else { None }
            } else { None };
            let track = json!({"id":id,"key":format!("local:{id}"),"provider":"local","title":metadata["title"],"artists":metadata["artists"],"album":metadata["album"],"durationMs":metadata["durationMs"],"cover":cover,"matched":false});
            if let Some(lyrics) = metadata["lyrics"].as_str().filter(|value| !value.is_empty()) { tokio::fs::write(state.root.join("lyrics").join(format!("{id}.lrc")), lyrics).await.map_err(io_error)?; }
            catalog.entries.insert(id, Entry { path, track, matched: None }); catalog.processed += 1;
            if catalog.processed % 25 == 0 { save_json(&state.root.join("library.json"), &*catalog).await?; }
        }
        Ok::<(), crate::error::AppError>(())
    }.await;
    let mut catalog = state.catalog.lock().await;
    catalog.importing = false;
    catalog.warning = format!(
        "已添加 {} 首，跳过 {} 项（重复、不可读取或不支持的文件）。",
        catalog.processed, catalog.skipped
    );
    save_json(&state.root.join("library.json"), &*catalog).await?;
    result?;
    Ok(catalog.snapshot())
}
pub async fn lyrics(state: &MusicState, id: &str, choose: bool) -> Result<Value> {
    uuid::Uuid::parse_str(id).map_err(|_| error("歌曲身份无效"))?;
    let entry = state
        .catalog
        .lock()
        .await
        .entries
        .get(id)
        .cloned()
        .ok_or_else(|| error("歌曲不在本地库中"))?;
    let mut source = None;
    if choose {
        source = rfd::AsyncFileDialog::new()
            .set_title("选择同步歌词")
            .add_filter("歌词", &["lrc", "ttml", "qrc", "yrc", "lys", "srt"])
            .pick_file()
            .await
            .map(|file| file.path().to_owned());
    }
    if choose && source.is_none() {
        return Err(error("已取消歌词导入"));
    }
    if source.is_none() {
        for ext in ["ttml", "yrc", "qrc", "lrc", "lys", "srt"] {
            let path = entry.path.with_extension(ext);
            if path.is_file() {
                source = Some(path);
                break;
            }
        }
    }
    if source.is_none() {
        for ext in ["ttml", "yrc", "qrc", "lrc", "lys", "srt"] {
            let path = state.root.join("lyrics").join(format!("{id}.{ext}"));
            if path.is_file() {
                source = Some(path);
                break;
            }
        }
    }
    let Some(path) = source else {
        return Ok(json!({"text":"","format":"lrc"}));
    };
    let path_check = path.clone();
    tauri::async_runtime::spawn_blocking(move || read_path(&path_check))
        .await
        .map_err(|_| error("歌词路径检查失败"))??;
    if tokio::fs::metadata(&path).await.map_err(io_error)?.len() > 8_000_000 {
        return Err(error("歌词文件超过 8 MB"));
    }
    let text = tokio::fs::read_to_string(&path)
        .await
        .map_err(|_| error("歌词须为 UTF-8 编码"))?;
    let format = path.extension().and_then(|v| v.to_str()).unwrap_or("lrc");
    if choose {
        tokio::fs::write(
            state.root.join("lyrics").join(format!("{id}.{format}")),
            text.as_bytes(),
        )
        .await
        .map_err(io_error)?;
    }
    Ok(json!({"text":text,"format":format}))
}
