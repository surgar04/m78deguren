//! 有界持久化时序日志。清除只针对本模块拥有的日志文件，导出报告单独保留。
use super::types::{Recording, Sample, Snapshot};
use crate::services::tools::{Result, check_local_path, error, io_error};
use std::path::{Path, PathBuf};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};

const MAX_FILE: u64 = 16 * 1024 * 1024;
const MAX_FILES: usize = 16;
const MAX_POINTS: usize = 60_000;
pub struct History {
    root: PathBuf,
    pending: Vec<Sample>,
    pub status: Recording,
}
fn owned(name: &str) -> bool {
    name.strip_prefix("samples-")
        .and_then(|name| name.strip_suffix(".jsonl"))
        .and_then(|name| name.split_once('-'))
        .is_some_and(|(time, id)| {
            time.len() == 17
                && time.bytes().all(|byte| byte.is_ascii_digit())
                && uuid::Uuid::parse_str(id).is_ok()
        })
}
async fn files(root: &Path) -> Result<Vec<PathBuf>> {
    let mut reader = tokio::fs::read_dir(root).await.map_err(io_error)?;
    let mut entries = Vec::new();
    while let Some(entry) = reader.next_entry().await.map_err(io_error)? {
        let kind = entry.file_type().await.map_err(io_error)?;
        if kind.is_file() && owned(&entry.file_name().to_string_lossy()) {
            entries.push(entry.path());
        }
    }
    entries.sort();
    Ok(entries)
}
impl History {
    /// 损坏历史也必须能在用户确认后清除；不依赖先成功解析该历史。
    pub async fn discard(root: &Path) -> Result<Self> {
        let root = root.join("history");
        check_local_path(&root).await?;
        tokio::fs::create_dir_all(&root).await.map_err(io_error)?;
        for path in files(&root).await? {
            check_local_path(&path).await?;
            tokio::fs::remove_file(path).await.map_err(io_error)?;
        }
        Ok(Self {
            root,
            pending: Vec::new(),
            status: Recording::default(),
        })
    }
    pub async fn open(root: &Path) -> Result<Self> {
        let root = root.join("history");
        check_local_path(&root).await?;
        tokio::fs::create_dir_all(&root).await.map_err(io_error)?;
        let mut store = Self {
            root,
            pending: Vec::new(),
            status: Recording::default(),
        };
        store.prune().await?;
        // 从磁盘实际记录重建状态，不把上次退出时的缓存计数当作真实记录。
        for file in files(&store.root).await? {
            let metadata = tokio::fs::metadata(&file).await.map_err(io_error)?;
            store.status.bytes += metadata.len();
            let mut reader = BufReader::new(tokio::fs::File::open(&file).await.map_err(io_error)?);
            loop {
                let mut line = String::new();
                let read = (&mut reader)
                    .take(65_537)
                    .read_line(&mut line)
                    .await
                    .map_err(io_error)?;
                if read == 0 {
                    break;
                }
                if read > 65_536 {
                    return Err(error("历史单行超过限制，请清除损坏的记录数据"));
                }
                if let Ok(sample) = serde_json::from_str::<Sample>(&line) {
                    store.status.count += 1;
                    store.status.start = Some(
                        store
                            .status
                            .start
                            .map_or(sample.timestamp, |start| start.min(sample.timestamp)),
                    );
                    store.status.end = Some(
                        store
                            .status
                            .end
                            .map_or(sample.timestamp, |end| end.max(sample.timestamp)),
                    );
                }
            }
        }
        Ok(store)
    }
    async fn prune(&mut self) -> Result<()> {
        let entries = files(&self.root).await?;
        let old = chrono::Utc::now().timestamp_millis() - 31 * 86_400_000;
        let mut removed = false;
        for (index, path) in entries.iter().enumerate() {
            check_local_path(path).await?;
            let stale = tokio::fs::metadata(path)
                .await
                .map_err(io_error)?
                .modified()
                .ok()
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .is_some_and(|time| time.as_millis() < old as u128);
            if index + MAX_FILES < entries.len() || stale {
                if self.status.count > 0 {
                    let bytes = tokio::fs::metadata(path).await.map_err(io_error)?.len();
                    if bytes <= MAX_FILE + 1_048_576 {
                        let mut reader =
                            BufReader::new(tokio::fs::File::open(path).await.map_err(io_error)?);
                        loop {
                            let mut line = String::new();
                            let read = (&mut reader)
                                .take(65_537)
                                .read_line(&mut line)
                                .await
                                .map_err(io_error)?;
                            if read == 0 || read > 65_536 {
                                break;
                            }
                            if serde_json::from_str::<Sample>(&line).is_ok() {
                                self.status.count = self.status.count.saturating_sub(1);
                            }
                        }
                    }
                    self.status.bytes = self.status.bytes.saturating_sub(bytes);
                }
                tokio::fs::remove_file(path).await.map_err(io_error)?;
                removed = true;
            }
        }
        if removed && self.status.count > 0 {
            self.status.start = None;
            for path in files(&self.root).await? {
                let mut reader =
                    BufReader::new(tokio::fs::File::open(path).await.map_err(io_error)?);
                let mut line = String::new();
                if (&mut reader)
                    .take(65_537)
                    .read_line(&mut line)
                    .await
                    .map_err(io_error)?
                    <= 65_536
                    && let Ok(sample) = serde_json::from_str::<Sample>(&line)
                {
                    self.status.start = Some(sample.timestamp);
                    break;
                }
            }
        } else if removed && self.status.count == 0 {
            self.status.start = None;
            self.status.end = None;
        }
        Ok(())
    }
    pub async fn append(&mut self, sample: Sample) -> Result<()> {
        // 磁盘满时最多保留 60 条待写样本，避免长期失败把整个进程内存耗尽。
        if self.pending.len() >= 60 {
            self.flush().await?;
        }
        self.pending.push(sample);
        if self.pending.len() >= 10 {
            self.flush().await?;
        }
        Ok(())
    }
    pub fn status(&self) -> Recording {
        let mut status = self.status.clone();
        // 内存待刷盘样本属于已记录数据；导出/清除会先取得同一把锁，因此不会遗漏。
        status.count += self.pending.len() as u64;
        if status.start.is_none() {
            status.start = self.pending.first().map(|sample| sample.timestamp);
        }
        if let Some(sample) = self.pending.last() {
            status.end = Some(sample.timestamp);
        }
        status
    }
    pub async fn flush(&mut self) -> Result<()> {
        if self.pending.is_empty() {
            return Ok(());
        }
        let mut entries = files(&self.root).await?;
        let current = match entries.pop() {
            Some(path) if tokio::fs::metadata(&path).await.map_err(io_error)?.len() < MAX_FILE => {
                path
            }
            _ => self.root.join(format!(
                "samples-{}-{}.jsonl",
                chrono::Utc::now().format("%Y%m%d%H%M%S%3f"),
                uuid::Uuid::new_v4()
            )),
        };
        check_local_path(&current).await?;
        let mut data = Vec::new();
        for sample in &self.pending {
            serde_json::to_writer(&mut data, sample).map_err(|_| error("历史采样序列化失败"))?;
            data.push(b'\n');
        }
        let mut file = tokio::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&current)
            .await
            .map_err(io_error)?;
        let previous = file.metadata().await.map_err(io_error)?.len();
        if let Err(cause) = file.write_all(&data).await {
            file.set_len(previous)
                .await
                .map_err(|_| error("历史写入失败且未能回滚尾部，请检查磁盘空间"))?;
            return Err(io_error(cause));
        }
        if let Err(cause) = file.sync_data().await {
            file.set_len(previous)
                .await
                .map_err(|_| error("历史同步失败且未能回滚尾部，请检查磁盘空间"))?;
            return Err(io_error(cause));
        }
        self.status.bytes += data.len() as u64;
        self.status.count += self.pending.len() as u64;
        if self.status.start.is_none() {
            self.status.start = self.pending.first().map(|sample| sample.timestamp);
        }
        self.status.end = self.pending.last().map(|sample| sample.timestamp);
        self.pending.clear();
        self.prune().await?;
        Ok(())
    }
    pub async fn clear(&mut self) -> Result<()> {
        // 不先清内存再尝试删除磁盘；若删除失败，调用方必须看到错误，不能宣称清除成功。
        for path in files(&self.root).await? {
            check_local_path(&path).await?;
            tokio::fs::remove_file(path).await.map_err(io_error)?;
        }
        self.pending.clear();
        self.status = Recording::default();
        Ok(())
    }
    pub async fn points(
        &mut self,
        from: Option<i64>,
        to: Option<i64>,
    ) -> Result<(Vec<Sample>, u64)> {
        self.flush().await?;
        let mut points = Vec::new();
        let mut count = 0_u64;
        let mut stride = 1_u64;
        for path in files(&self.root).await? {
            check_local_path(&path).await?;
            if tokio::fs::metadata(&path).await.map_err(io_error)?.len() > MAX_FILE + 1_048_576 {
                return Err(error("历史文件超过容量限制"));
            }
            let mut reader = BufReader::new(tokio::fs::File::open(path).await.map_err(io_error)?);
            loop {
                let mut line = String::new();
                let read = (&mut reader)
                    .take(65_537)
                    .read_line(&mut line)
                    .await
                    .map_err(io_error)?;
                if read == 0 {
                    break;
                }
                if read > 65_536 {
                    return Err(error("历史记录单行过大"));
                }
                let Ok(point) = serde_json::from_str::<Sample>(&line) else {
                    continue;
                };
                if from.is_some_and(|start| point.timestamp < start)
                    || to.is_some_and(|end| point.timestamp > end)
                {
                    continue;
                }
                if count.is_multiple_of(stride) {
                    points.push(point);
                }
                count += 1;
                if points.len() > MAX_POINTS {
                    points = points.into_iter().step_by(2).collect();
                    stride *= 2;
                }
            }
        }
        points.sort_by_key(|point| point.timestamp);
        Ok((points, count))
    }
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Receipt {
    pub path: String,
    pub bytes: usize,
    pub points: usize,
    pub total_samples: u64,
}
pub async fn report(
    root: &Path,
    snapshot: &Snapshot,
    points: Vec<Sample>,
    count: u64,
) -> Result<Receipt> {
    use base64::Engine;
    use sha2::{Digest, Sha256};
    let payload = serde_json::json!({"version":1,"devices":snapshot.devices,"warnings":snapshot.warnings,"samples":points,"totalSamples":count});
    let json = serde_json::to_string(&payload)
        .map_err(|_| error("报告内容编码失败"))?
        .replace('<', "\\u003c")
        .replace('>', "\\u003e")
        .replace('&', "\\u0026")
        .replace('\u{2028}', "\\u2028")
        .replace('\u{2029}', "\\u2029");
    let script = include_str!("../../../resources/hardware-web/report.js");
    let hash = base64::engine::general_purpose::STANDARD.encode(Sha256::digest(script.as_bytes()));
    let html = include_str!("report.html")
        .replace("__SCRIPT__", script)
        .replace("__SCRIPT_HASH__", &hash)
        .replace("__PAYLOAD__", &json);
    let directory = root.join("reports");
    check_local_path(&directory).await?;
    tokio::fs::create_dir_all(&directory)
        .await
        .map_err(io_error)?;
    let path = directory.join(format!("hardware-{}.html", uuid::Uuid::new_v4()));
    let mut file = tokio::fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&path)
        .await
        .map_err(io_error)?;
    file.write_all(html.as_bytes()).await.map_err(io_error)?;
    file.sync_all().await.map_err(io_error)?;
    Ok(Receipt {
        path: path.to_string_lossy().into_owned(),
        bytes: html.len(),
        points: points.len(),
        total_samples: count,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn persists_filters_and_clears_only_owned_history() -> Result<()> {
        tauri::async_runtime::block_on(async {
            let root = crate::services::tools::test_root("hardware-history")?;
            let mut history = History::open(&root).await?;
            let now = chrono::Utc::now().timestamp_millis();
            for index in 0..15 {
                history
                    .append(Sample {
                        timestamp: now + index * 1000,
                        metrics: super::super::types::Metrics::from([(
                            "cpu".into(),
                            Some(index as f64),
                        )]),
                        gpus: Vec::new(),
                        fps: super::super::types::Fps::default(),
                    })
                    .await?;
            }
            assert_eq!(history.status().count, 15);
            let (points, count) = history.points(Some(now + 5000), Some(now + 10000)).await?;
            assert_eq!(count, 6);
            assert_eq!(points.len(), 6);
            let again = History::open(&root).await?;
            assert_eq!(again.status().count, 15);
            let mut snapshot = Snapshot::default();
            snapshot.devices.push(super::super::types::Device {
                id: "cpu".into(),
                kind: "cpu".into(),
                name: "</script><script>bad()</script>__SCRIPT__".into(),
                fields: Vec::new(),
            });
            let receipt = report(&root, &snapshot, points, count).await?;
            let html = tokio::fs::read_to_string(&receipt.path)
                .await
                .map_err(io_error)?;
            assert!(!html.contains("<script>bad()</script>"));
            assert!(html.contains("__SCRIPT__"));
            assert!(html.contains("datetime-local"));
            tokio::fs::write(history.root.join("notes.txt"), "keep")
                .await
                .map_err(io_error)?;
            history.clear().await?;
            assert_eq!(history.status().count, 0);
            assert!(Path::new(&receipt.path).exists());
            assert!(history.root.join("notes.txt").exists());
            assert!(!owned("samples-not-a-log.jsonl"));
            assert!(!owned("../samples-x.jsonl"));
            Ok(())
        })
    }
}
