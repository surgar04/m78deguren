//! 受限工具网关：serde枚举拒绝未知操作，前端不能传入脚本、进程命令或任意磁盘路径。
use crate::{
    error::AppError,
    services::tools::{self, Result, ToolsState, crosshair, downloads, error, network, platform},
};
use serde::Deserialize;
use std::{
    path::PathBuf,
    time::{Duration, Instant},
};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

#[derive(Deserialize)]
#[serde(
    tag = "operation",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Request {
    Catalog {},
    Displays {},
    CrosshairStatus {},
    CrosshairReady {},
    CrosshairUpdate {
        config: crosshair::CrosshairConfig,
        enabled: bool,
    },
    CrosshairPreset {
        action: String,
        id: Option<String>,
        name: Option<String>,
    },
    ScreenOpen {
        config: crosshair::ScreenConfig,
    },
    ScreenStatus {},
    ScreenUpdate {
        config: crosshair::ScreenConfig,
    },
    ScreenClose {},
    DownloadsList {},
    DownloadsSettings {},
    DownloadLimit {
        limit_kib: u32,
    },
    DownloadCreate {
        input: downloads::DownloadInput,
    },
    DownloadAction {
        id: String,
        action: String,
    },
    DownloadFile {
        id: String,
        action: String,
    },
    RecordingScan {},
    RecordingDiscover {},
    RecordingBatch {
        ids: Vec<String>,
        action: String,
        consent: bool,
    },
    RecordingPurge {
        id: String,
        consent: bool,
    },
    RecordingAdd {},
    RecordingRootRemove {
        id: String,
    },
    RecordingRename {
        id: String,
        name: String,
    },
    RecordingRemove {
        id: String,
    },
    RecordingRestore {
        id: String,
    },
    RecordingFile {
        id: String,
        action: String,
    },
    SpeedStatus {},
    SpeedStart {
        node: Option<String>,
        connections: Option<u32>,
    },
    SpeedStop {},
    NtpServers {},
    NtpQuery {
        server: String,
    },
    NtpApply {
        token: String,
        consent: bool,
    },
    RuntimeDetect {},
    RuntimeStatus {},
    RuntimePrepare {
        id: String,
    },
    RuntimeInstall {
        token: String,
        consent: bool,
    },
    CrashScan {},
    CrashReveal {
        id: String,
    },
    CrashExport {},
    ExternalCatalog {},
    ExternalOpen {
        id: String,
    },
}
fn json(value: impl serde::Serialize) -> Result<serde_json::Value> {
    serde_json::to_value(value).map_err(|_| error("工具返回数据无法序列化"))
}
async fn blocking<T: Send + 'static>(
    task: impl FnOnce() -> Result<T> + Send + 'static,
) -> Result<T> {
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|_| error("本地工具任务异常结束"))?
}
async fn pick_folder(app: tauri::AppHandle) -> Result<Option<PathBuf>> {
    blocking(move || {
        app.dialog()
            .file()
            .set_title("选择本地目录")
            .blocking_pick_folder()
            .map(|path| path.into_path().map_err(|_| error("仅支持本地目录")))
            .transpose()
    })
    .await
}
fn open_path(app: &tauri::AppHandle, path: &std::path::Path, reveal: bool) -> Result<()> {
    if reveal {
        app.opener().reveal_item_in_dir(path)
    } else {
        app.opener()
            .open_path(path.to_string_lossy().into_owned(), None::<&str>)
    }
    .map_err(|_| error("无法打开文件或目录，请检查系统关联程序"))
}
fn allowed_window(label: &str, request: &Request) -> bool {
    match label {
        "main" => true,
        "crosshair-overlay" => {
            matches!(
                request,
                Request::CrosshairStatus {} | Request::CrosshairReady {}
            )
        }
        "screen-test" => matches!(
            request,
            Request::ScreenStatus {} | Request::ScreenUpdate { .. } | Request::ScreenClose {}
        ),
        _ => false,
    }
}
#[tauri::command]
pub async fn tools_execute(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ToolsState>,
    request: Request,
) -> std::result::Result<serde_json::Value, AppError> {
    if !allowed_window(window.label(), &request) {
        return Err(error("此窗口没有调用该工具的权限"));
    }
    match request {
        Request::Catalog {} => json(tools::catalog::catalog()),
        Request::Displays {} => json(crosshair::displays(&app)?),
        Request::CrosshairStatus {} => {
            let mut snapshot = state.crosshair.lock().await.snapshot.clone();
            if let Some(binding) = app
                .state::<crate::services::settings::SettingsState>()
                .config
                .lock()
                .await
                .bindings
                .iter()
                .find(|row| row.action == "crosshair")
            {
                snapshot.config.shortcut = binding.shortcut.clone();
            }
            json(snapshot)
        }
        Request::CrosshairReady {} => {
            let current = state.crosshair.lock().await;
            if current.snapshot.enabled && !current.snapshot.config.hold {
                crosshair::apply_window(&app, &state.root, &current.snapshot.config, true)?;
            }
            json(())
        }
        Request::CrosshairUpdate {
            mut config,
            enabled,
        } => {
            if let Some(binding) = app
                .state::<crate::services::settings::SettingsState>()
                .config
                .lock()
                .await
                .bindings
                .iter()
                .find(|row| row.action == "crosshair")
            {
                config.shortcut = binding.shortcut.clone();
            }
            json(
                crosshair::update(
                    app,
                    state.root.clone(),
                    state.crosshair.clone(),
                    config,
                    enabled,
                )
                .await?,
            )
        }
        Request::CrosshairPreset { action, id, name } => {
            let mut current = state.crosshair.lock().await;
            match action.as_str() {
                "save" => {
                    let name = name
                        .ok_or_else(|| error("预设名称不能为空"))?
                        .trim()
                        .to_owned();
                    if name.is_empty()
                        || name.chars().count() > 40
                        || name.chars().any(char::is_control)
                    {
                        return Err(error("预设名称应为1至40个有效字符"));
                    }
                    let config = current.snapshot.config.clone();
                    if let Some(preset) =
                        current.snapshot.presets.iter_mut().find(|p| p.name == name)
                    {
                        preset.config = config;
                    } else {
                        if current.snapshot.presets.len() >= 30 {
                            return Err(error("最多保存30个准心预设"));
                        }
                        current.snapshot.presets.push(crosshair::Preset {
                            id: uuid::Uuid::new_v4().to_string(),
                            name,
                            config,
                        });
                    }
                }
                "remove" => {
                    let id = id.ok_or_else(|| error("缺少预设ID"))?;
                    current.snapshot.presets.retain(|p| p.id != id);
                }
                _ => return Err(error("不支持的预设操作")),
            }
            tools::save_json(&current.path, &current.snapshot).await?;
            json(current.snapshot.clone())
        }
        Request::ScreenOpen { config } => {
            config.validate()?;
            crosshair::open_screen(&app, &state.root, &config)?;
            *state.screen.lock().await = config;
            json(())
        }
        Request::ScreenStatus {} => json(state.screen.lock().await.clone()),
        Request::ScreenUpdate { config } => {
            config.validate()?;
            *state.screen.lock().await = config;
            json(())
        }
        Request::ScreenClose {} => {
            if let Some(window) = app.get_webview_window("screen-test") {
                window.close().map_err(|_| error("无法关闭测试窗口"))?;
            }
            json(())
        }
        Request::DownloadsList {} => json(state.downloads.list().await),
        Request::DownloadsSettings {} => json(state.downloads.settings().await),
        Request::DownloadLimit { limit_kib } => {
            state.downloads.set_limit(limit_kib).await?;
            json(())
        }
        Request::DownloadCreate { input } => {
            json(state.downloads.create(input, state.http.clone()).await?)
        }
        Request::DownloadAction { id, action } => {
            if action == "remove" {
                state.downloads.remove(&id).await?;
            } else {
                state
                    .downloads
                    .control(&id, &action, state.http.clone())
                    .await?;
            }
            json(())
        }
        Request::DownloadFile { id, action } => {
            let task = state.downloads.task(&id).await?;
            if task.status != "complete" {
                return Err(error("文件尚未完成下载"));
            }
            let path = state.downloads.final_path(&task);
            let check = path.clone();
            blocking(move || {
                tools::ensure_local_path(&check)?;
                if !check.is_file() {
                    return Err(error("下载文件已移动或不存在"));
                }
                Ok(())
            })
            .await?;
            if action == "copy" {
                let Some(folder) = pick_folder(app.clone()).await? else {
                    return json(false);
                };
                blocking(move || {
                    tools::ensure_local_path(&folder)?;
                    let target = folder.join(&task.file_name);
                    tools::ensure_local_path(&target)?;
                    let mut input = std::fs::File::open(path).map_err(tools::io_error)?;
                    let mut output = std::fs::OpenOptions::new()
                        .create_new(true)
                        .write(true)
                        .open(&target)
                        .map_err(tools::io_error)?;
                    if let Err(cause) =
                        std::io::copy(&mut input, &mut output).and_then(|_| output.sync_all())
                    {
                        drop(output);
                        let _ = std::fs::remove_file(&target);
                        return Err(tools::io_error(cause));
                    }
                    Ok(())
                })
                .await?;
                return json(true);
            }
            if !matches!(action.as_str(), "open" | "reveal") {
                return Err(error("不支持的文件动作"));
            }
            let executable = path.extension().and_then(|v| v.to_str()).is_some_and(|e| {
                matches!(
                    e.to_ascii_lowercase().as_str(),
                    "exe"
                        | "msi"
                        | "msix"
                        | "bat"
                        | "cmd"
                        | "ps1"
                        | "vbs"
                        | "js"
                        | "lnk"
                        | "scr"
                        | "com"
                        | "hta"
                        | "reg"
                        | "url"
                        | "website"
                        | "jse"
                        | "vbe"
                        | "wsf"
                        | "wsh"
                        | "cpl"
                        | "psm1"
                        | "psd1"
                        | "msixbundle"
                        | "appx"
                        | "appxbundle"
                        | "appinstaller"
                        | "msp"
                        | "mst"
                        | "jar"
                        | "py"
                        | "pyw"
                        | "rb"
                        | "pl"
                        | "sh"
                )
            });
            if action == "open" && executable {
                return Err(error(
                    "可执行文件请先定位核对来源；本入口不会运行脚本或安装器",
                ));
            }
            blocking(move || open_path(&app, &path, action == "reveal")).await?;
            json(())
        }
        Request::RecordingAdd {} => {
            let Some(path) = pick_folder(app).await? else {
                return json(false);
            };
            let store = state.recordings.clone();
            blocking(move || store.blocking_lock().add(path)).await?;
            json(true)
        }
        Request::RecordingScan {} => {
            let store = state.recordings.clone();
            json(blocking(move || store.blocking_lock().scan()).await?)
        }
        Request::RecordingDiscover {} => {
            let value = platform::run(
                &state.root,
                "recording-locations",
                &[],
                Duration::from_secs(15),
            )
            .await?;
            let paths: Vec<PathBuf> =
                serde_json::from_value(value).map_err(|_| error("默认录屏目录返回格式无效"))?;
            let store = state.recordings.clone();
            json(
                blocking(move || {
                    let mut store = store.blocking_lock();
                    let mut count = 0;
                    for path in paths.into_iter().take(3) {
                        tools::ensure_local_path(&path)?;
                        if !store.roots.iter().any(|root| root.path == path) {
                            store.add(path)?;
                            count += 1;
                        }
                    }
                    Ok(count)
                })
                .await?,
            )
        }
        Request::RecordingPurge { id, consent } => {
            let store = state.recordings.clone();
            blocking(move || store.blocking_lock().purge(&id, consent)).await?;
            json(())
        }
        Request::RecordingBatch {
            ids,
            action,
            consent,
        } => {
            if ids.is_empty()
                || ids.len() > 100
                || ids.iter().collect::<std::collections::HashSet<_>>().len() != ids.len()
                || !matches!(action.as_str(), "copy" | "remove")
                || !consent
            {
                return Err(error("批量操作需要确认且每次选择 1–100 个不同视频"));
            }
            let folder = if action == "copy" {
                let Some(folder) = pick_folder(app).await? else {
                    return json(Vec::<serde_json::Value>::new());
                };
                Some(folder)
            } else {
                None
            };
            let store = state.recordings.clone();
            json(blocking(move||{let mut store=store.blocking_lock();let mut results=Vec::new();for id in ids{let result=if let Some(folder)=&folder{store.copy(&id,folder).map(|_|())}else{store.remove(&id).map(|_|())};results.push(serde_json::json!({"id":id,"error":result.err().map(|cause|cause.to_string())}));}Ok(results)}).await?)
        }
        Request::RecordingRootRemove { id } => {
            let store = state.recordings.clone();
            blocking(move || store.blocking_lock().remove_root(&id)).await?;
            json(())
        }
        Request::RecordingRename { id, name } => {
            let store = state.recordings.clone();
            blocking(move || store.blocking_lock().rename(&id, &name)).await?;
            json(())
        }
        Request::RecordingRemove { id } => {
            let store = state.recordings.clone();
            json(blocking(move || store.blocking_lock().remove(&id)).await?)
        }
        Request::RecordingRestore { id } => {
            let store = state.recordings.clone();
            blocking(move || store.blocking_lock().restore(&id)).await?;
            json(())
        }
        Request::RecordingFile { id, action } => {
            let store = state.recordings.clone();
            let identifier = id.clone();
            let path = blocking(move || store.blocking_lock().path(&identifier)).await?;
            if action == "copy" {
                let Some(folder) = pick_folder(app).await? else {
                    return json(false);
                };
                let store = state.recordings.clone();
                blocking(move || store.blocking_lock().copy(&id, &folder)).await?;
                return json(true);
            }
            if !matches!(action.as_str(), "open" | "reveal") {
                return Err(error("不支持的录屏操作"));
            }
            blocking(move || open_path(&app, &path, action == "reveal")).await?;
            json(())
        }
        Request::SpeedStatus {} => json(state.speed.snapshot().await),
        Request::SpeedStart { node, connections } => {
            state
                .speed
                .start(state.http.clone(), node, connections)
                .await?;
            json(())
        }
        Request::SpeedStop {} => {
            state.speed.stop().await;
            json(())
        }
        Request::NtpServers {} => json(
            network::NTP_SERVERS
                .iter()
                .map(|(id, name, host)| serde_json::json!({"id":id,"name":name,"host":host}))
                .collect::<Vec<_>>(),
        ),
        Request::NtpQuery { server } => {
            let result = network::query_ntp(&server).await?;
            let mut probes = state.probes.lock().await;
            probes.retain(|_, probe| probe.measured.elapsed() < Duration::from_secs(60));
            if probes.len() >= 32 {
                probes.clear();
            }
            probes.insert(
                result.token.clone(),
                network::Probe {
                    server,
                    offset_ms: result.offset_ms,
                    measured: Instant::now(),
                },
            );
            json(result)
        }
        Request::NtpApply { token, consent } => {
            if !consent {
                return Err(error("请确认修改系统时间"));
            }
            let probe = state
                .probes
                .lock()
                .await
                .remove(&token)
                .ok_or_else(|| error("时间查询已过期，请重新检测"))?;
            network::apply_time(&state.root, probe).await
        }
        Request::RuntimeDetect {} => {
            platform::run(&state.root, "runtimes", &[], Duration::from_secs(30)).await
        }
        Request::RuntimeStatus {} => json(state.runtimes.snapshot().await),
        Request::RuntimePrepare { id } => {
            state
                .runtimes
                .prepare(
                    id,
                    state.root.clone(),
                    state.downloads.clone(),
                    state.http.clone(),
                )
                .await?;
            json(())
        }
        Request::RuntimeInstall { token, consent } => {
            state
                .runtimes
                .install(&token, consent, state.root.clone())
                .await?;
            json(())
        }
        Request::CrashScan {} => tools::crashes::scan(&state).await,
        Request::CrashExport {} => {
            let evidence = tools::crashes::scan(&state).await?;
            let folder = state.root.join("crash-reports");
            tools::check_local_path(&folder).await?;
            tokio::fs::create_dir_all(&folder)
                .await
                .map_err(tools::io_error)?;
            let path = folder.join(format!("{}.json", uuid::Uuid::new_v4()));
            tools::save_json(&path, &evidence).await?;
            json(path.to_string_lossy().into_owned())
        }
        Request::CrashReveal { id } => {
            let path = state
                .crash_files
                .lock()
                .await
                .get(&id)
                .cloned()
                .ok_or_else(|| error("转储记录已过期，请重新扫描"))?;
            blocking(move || {
                if !path.is_file() {
                    return Err(error("转储文件不存在"));
                }
                open_path(&app, &path, true)
            })
            .await?;
            json(())
        }
        Request::ExternalCatalog {} => json(tools::catalog::external_catalog()),
        Request::ExternalOpen { id } => {
            let tool = tools::catalog::external_catalog()
                .into_iter()
                .find(|tool| tool.id == id)
                .ok_or_else(|| error("未知外部工具"))?;
            app.opener()
                .open_url(tool.website, None::<&str>)
                .map_err(|_| error("无法打开官方来源"))?;
            json(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ipc_rejects_unknown_fields_and_restricts_auxiliary_windows() {
        for value in [
            r#"{"operation":"catalog","script":"evil"}"#,
            r#"{"operation":"run-shell"}"#,
            r#"{"operation":"runtime-install","token":"a","consent":"true"}"#,
        ] {
            assert!(serde_json::from_str::<Request>(value).is_err());
        }
        assert!(allowed_window("main", &Request::Catalog {}));
        assert!(allowed_window(
            "crosshair-overlay",
            &Request::CrosshairStatus {}
        ));
        assert!(!allowed_window(
            "crosshair-overlay",
            &Request::RuntimeInstall {
                token: "x".into(),
                consent: true
            }
        ));
        assert!(!allowed_window("screen-test", &Request::CrashExport {}));
        assert!(!allowed_window("unknown", &Request::Catalog {}));
    }
}
