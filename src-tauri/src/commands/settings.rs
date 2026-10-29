//! 设置命令只负责边界、窗口能力和编排；重启、驱动、启动项均要求独立运行时确认。
use crate::{
    error::AppError,
    services::{
        settings::{self, SettingsState},
        tools::{self, Result, ToolsState, error},
    },
};
use serde::{Deserialize, Serialize};
use std::{path::PathBuf, sync::atomic::Ordering};
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

#[derive(Deserialize)]
#[serde(tag = "operation", rename_all = "kebab-case", deny_unknown_fields)]
pub enum Request {
    Snapshot {},
    Runtime {},
    Patch {
        patch: settings::config::Patch,
    },
    AssetImport {
        kind: String,
    },
    AssetRemove {
        id: String,
    },
    Footprint {},
    CacheClear {
        consent: bool,
    },
    NetworkSites {},
    NetworkTest {
        ids: Vec<String>,
    },
    AutostartSet {
        enabled: bool,
        consent: bool,
    },
    AutostartHistory {},
    AutostartRestore {
        id: String,
        consent: bool,
    },
    PawnStatus {},
    PawnPrepare {},
    PawnApply {
        token: String,
        install: bool,
        consent: bool,
    },
    HotkeyCaptureStart {},
    HotkeyCaptureEnd {
        token: String,
    },
    FilterRules {
        rules: Vec<tools::filters::Rule>,
        #[serde(rename = "autoGame")]
        auto_game: bool,
    },
    ResetPrepare {},
    ResetBackups {},
    ResetApply {
        token: String,
        confirmation: String,
        consent: bool,
    },
    ResetRestorePrepare {
        id: String,
    },
    ResetRestoreApply {
        token: String,
        consent: bool,
    },
    UpdateStatus {},
    UpdateCheck {},
    UpdateDownload {},
    UpdateOpenRelease {},
    UpdateApply {
        token: String,
        consent: bool,
    },
    RestoreMain {},
    MediaControl {
        action: String,
    },
    BootReady {},
}
fn allowed(label: &str, _request: &Request) -> bool {
    label == "main"
}
fn json<T: Serialize>(value: T) -> Result<serde_json::Value> {
    serde_json::to_value(value).map_err(|_| error("设置返回结构无效"))
}
async fn control_directory(root: &std::path::Path) -> Result<PathBuf> {
    let root = root.to_owned();
    tauri::async_runtime::spawn_blocking(move || settings::storage::control_directory(&root))
        .await
        .map_err(|_| error("维护目录检查任务失败"))?
}

#[tauri::command]
pub async fn settings_execute(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, SettingsState>,
    tools: tauri::State<'_, ToolsState>,
    request: Request,
) -> std::result::Result<serde_json::Value, AppError> {
    if !allowed(window.label(), &request) {
        return Err(error("此辅助窗口没有设置、文件或系统操作权限"));
    }
    let app = window.app_handle().clone();
    match request {
        Request::Snapshot {} => {
            let config = state.config.lock().await.clone();
            let assets = state.assets.lock().await.entries.clone();
            let channel = settings::update::channel()?;
            json(
                serde_json::json!({"config":config,"assets":assets,"version":env!("CARGO_PKG_VERSION"),"author":channel.author,"repository":"https://github.com/surgar04/m78deguren","changelog":include_str!("../../../CHANGELOG.md"),"dataRoot":state.root,"startedAt":state.started_at,"warnings":state.warnings}),
            )
        }
        Request::Runtime {} => {
            let autostart = settings::pawnio::autostart_status(&tools.root, &state.root).await?;
            json(
                serde_json::json!({"autostart":autostart,"hotkeys":state.hotkeys.snapshot()?,"hudVisible":app.get_webview_window("hud").is_some(),"captureActive":state.capture.lock().await.is_some(),"critical":state.critical.load(Ordering::SeqCst)}),
            )
        }
        Request::Patch { patch } => json(settings::runtime::patch(&app, patch).await?),
        Request::AssetImport { kind } => {
            let extensions: Vec<&str> = match kind.as_str() {
                "image" | "logo" => vec!["png", "jpg", "jpeg", "webp"],
                "video" => vec!["mp4", "webm"],
                "font" => vec!["ttf", "otf"],
                _ => return Err(error("不支持该素材类型")),
            };
            let _guard = state.serial.lock().await;
            let dialog = app.clone();
            let path = tauri::async_runtime::spawn_blocking(move || {
                dialog
                    .dialog()
                    .file()
                    .add_filter("臻境支持的本地素材", &extensions)
                    .blocking_pick_file()
                    .map(|path| path.into_path())
            })
            .await
            .map_err(|_| error("素材选择器启动失败"))?;
            let Some(path) = path else {
                return json(None::<settings::assets::Asset>);
            };
            let path = path.map_err(|_| error("素材选择路径无效"))?;
            let store = state.assets.lock().await.clone();
            let probe_root = tools.root.clone();
            let asset = tauri::async_runtime::spawn_blocking(move || {
                // 大文件复制在阻塞线程进行；检查子进程由异步运行时管理，并有独立超时。
                store.import(&path, &kind, |temporary| {
                    tauri::async_runtime::block_on(settings::video::validate(
                        &probe_root,
                        temporary,
                    ))
                })
            })
            .await
            .map_err(|_| error("素材导入任务异常"))??;
            state.assets.lock().await.record(asset.clone()).await?;
            let _ = app.emit("settings-assets-changed", ());
            json(Some(asset))
        }
        Request::AssetRemove { id } => {
            let _guard = state.serial.lock().await;
            state.assets.lock().await.remove(&id).await?;
            let _ = app.emit("settings-assets-changed", ());
            json(())
        }
        Request::Footprint {} => {
            let root = state.root.clone();
            json(
                tauri::async_runtime::spawn_blocking(move || settings::storage::footprint(&root))
                    .await
                    .map_err(|_| error("占用扫描任务失败"))??,
            )
        }
        Request::CacheClear { consent } => {
            if !consent {
                return Err(error("必须确认清理应用缓存"));
            }
            let _guard = state.serial.lock().await;
            let root = state.root.clone();
            json(
                tauri::async_runtime::spawn_blocking(move || settings::storage::clear_cache(&root))
                    .await
                    .map_err(|_| error("缓存清理任务失败"))??,
            )
        }
        Request::NetworkSites {} => json(settings::network::servers(
            &state.config.lock().await.servers,
        )),
        Request::NetworkTest { ids } => {
            let all = settings::network::servers(&state.config.lock().await.servers);
            json(settings::network::test(&state.http, all, ids).await?)
        }
        Request::AutostartSet { enabled, consent } => {
            let _guard = settings::runtime::Critical::acquire(&state)?;
            settings::pawnio::autostart_set(&tools, &state.root, enabled, consent).await
        }
        Request::AutostartHistory {} => {
            let root = state.root.join("settings/autostart-backups");
            let rows =
                tauri::async_runtime::spawn_blocking(move || -> Result<Vec<serde_json::Value>> {
                    tools::ensure_local_path(&root)?;
                    let mut rows = Vec::new();
                    if root.is_dir() {
                        for entry in std::fs::read_dir(root).map_err(tools::io_error)? {
                            let path = entry.map_err(tools::io_error)?.path();
                            tools::ensure_local_path(&path)?;
                            if path.extension().and_then(|value| value.to_str()) != Some("json") {
                                continue;
                            }
                            let record: serde_json::Value = serde_json::from_slice(
                                &std::fs::read(path).map_err(tools::io_error)?,
                            )
                            .map_err(|_| error("启动项备份损坏，未用于恢复"))?;
                            rows.push(record);
                        }
                    }
                    rows.sort_by(|a, b| {
                        b["createdAt"]
                            .as_f64()
                            .unwrap_or_default()
                            .total_cmp(&a["createdAt"].as_f64().unwrap_or_default())
                    });
                    rows.truncate(30);
                    Ok(rows)
                })
                .await
                .map_err(|_| error("启动项历史读取失败"))??;
            json(rows)
        }
        Request::AutostartRestore { id, consent } => {
            if !consent {
                return Err(error("必须确认恢复启动项"));
            }
            uuid::Uuid::parse_str(&id).map_err(|_| error("启动项备份标识无效"))?;
            let _guard = settings::runtime::Critical::acquire(&state)?;
            settings::pawnio::run(&tools.root,"autostart-restore",serde_json::json!({"id":id,"backups":state.root.join("settings/autostart-backups")}),std::time::Duration::from_secs(30)).await
        }
        Request::PawnStatus {} => settings::pawnio::status(&tools.root).await,
        Request::PawnPrepare {} => json(
            state
                .pawnio
                .prepare(
                    &tools.root,
                    tools.downloads.clone(),
                    state.releases_http.clone(),
                )
                .await?,
        ),
        Request::PawnApply {
            token,
            install,
            consent,
        } => {
            let _guard = settings::runtime::Critical::acquire(&state)?;
            state
                .pawnio
                .apply(&tools.root, &token, install, consent)
                .await
        }
        Request::HotkeyCaptureStart {} => json(
            serde_json::json!({"token":settings::hotkeys::capture_start(&app).await?,"expiresInSeconds":30}),
        ),
        Request::HotkeyCaptureEnd { token } => {
            settings::hotkeys::capture_end(&app, &token).await?;
            json(())
        }
        Request::FilterRules { rules, auto_game } => {
            tools
                .filters
                .update_rules(&tools.root, rules, auto_game)
                .await?;
            json(())
        }
        Request::ResetPrepare {} => json(state.maintenance.prepare(&state.root, None).await?),
        Request::ResetBackups {} => json(settings::maintenance::backups(&state.root).await?),
        Request::ResetRestorePrepare { id } => {
            json(state.maintenance.prepare(&state.root, Some(id)).await?)
        }
        Request::ResetApply {
            token,
            confirmation,
            consent,
        } => {
            if confirmation != "RESET" {
                return Err(error("请输入 RESET 以确认数据重置"));
            }
            let _guard = settings::runtime::Critical::acquire(&state)?;
            settings::runtime::ensure_quiet(&app).await?;
            let plan = state
                .maintenance
                .consume(&state.root, &token, false, consent)
                .await?;
            settings::maintenance::launch(&app, plan).await?;
            json(())
        }
        Request::ResetRestoreApply { token, consent } => {
            let _guard = settings::runtime::Critical::acquire(&state)?;
            settings::runtime::ensure_quiet(&app).await?;
            let plan = state
                .maintenance
                .consume(&state.root, &token, true, consent)
                .await?;
            settings::maintenance::launch(&app, plan).await?;
            json(())
        }
        Request::UpdateStatus {} => json(state.update.status(&tools.downloads).await?),
        Request::UpdateCheck {} => json(state.update.check(&state.releases_http).await?),
        Request::UpdateDownload {} => {
            json(state.update.download(&tools, &state.releases_http).await?)
        }
        Request::UpdateOpenRelease {} => {
            use tauri_plugin_opener::OpenerExt;
            app.opener()
                .open_url(
                    "https://github.com/surgar04/m78deguren/releases",
                    None::<&str>,
                )
                .map_err(|_| error("无法打开发布页面"))?;
            json(())
        }
        Request::UpdateApply { token, consent } => {
            let _guard = settings::runtime::Critical::acquire(&state)?;
            settings::runtime::ensure_quiet(&app).await?;
            let (source, release) = state.update.consume(&token, consent).await?;
            let plan = settings::maintenance::Plan {
                ticket: uuid::Uuid::new_v4().to_string(),
                kind: "update".into(),
                owner: std::process::id(),
                exe: std::env::current_exe().map_err(tools::io_error)?,
                data_root: state.root.clone(),
                control: control_directory(&state.root).await?,
                restore_id: None,
                source: Some(source),
                sha256: Some(release.sha256),
                bytes: Some(release.bytes),
                version: Some(release.version),
                lock_file: settings::storage::ownership_path(&state.root)?,
                launch_environment: settings::maintenance::launch_environment(),
            };
            settings::maintenance::launch(&app, plan).await?;
            json(())
        }
        Request::RestoreMain {} => {
            settings::runtime::show_main(&app)?;
            json(())
        }
        Request::MediaControl { action } => json(
            state
                .media
                .control(&state.root.join("settings"), &action)
                .await?,
        ),
        Request::BootReady {} => {
            settings::maintenance::mark_boot_ready(&state.root).await?;
            json(())
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn auxiliary_window_cannot_read_config_or_mutate_system() {
        for request in [
            Request::Snapshot {},
            Request::PawnPrepare {},
            Request::UpdateDownload {},
            Request::CacheClear { consent: true },
        ] {
            assert!(allowed("main", &request));
            assert!(!allowed("desktop-island", &request));
            assert!(!allowed("crosshair-overlay", &request));
        }
        assert!(!allowed("hud", &Request::Snapshot {}));
    }
}
