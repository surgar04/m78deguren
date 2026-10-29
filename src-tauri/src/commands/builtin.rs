//! 新增工具与旧工具共享安全边界，但分开枚举，避免单个请求类型无限膨胀。
use crate::{
    error::AppError,
    services::tools::{self, ToolsState, builtin},
};
use serde::Deserialize;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

#[derive(Deserialize)]
#[serde(tag = "operation", rename_all = "kebab-case", deny_unknown_fields)]
pub enum Request {
    Query {
        tool: builtin::SystemQuery,
    },
    ClickStatus {},
    ClickConfigure {
        config: tools::input::ClickConfig,
        enabled: bool,
        immediate: bool,
    },
    ChangePrepare {
        change: tools::system_changes::SystemChange,
    },
    ChangeApply {
        token: String,
        consent: bool,
    },
    ChangeHistory {},
    ChangeDiscard {
        token: String,
    },
    AppFile {
        id: String,
        reveal: bool,
    },
    DisplayStatus {},
    DisplayHistory {},
    DisplayRestore {
        id: String,
        consent: bool,
    },
    DisplaySwitch {
        target: tools::display::Target,
        consent: bool,
    },
    DisplayDecide {
        id: String,
        keep: bool,
    },
    DriverHistory {
        refresh: bool,
    },
    DriverOpen {
        id: String,
    },
    FeatureDictionaryUpdate {},
    FilterStatus {},
    FilterConfigure {
        config: tools::filters::Config,
        enabled: bool,
        preview: bool,
        consent: bool,
    },
    FilterKeep {},
    FilterPresetSave {
        name: String,
        config: tools::filters::Config,
    },
    FilterPresetRemove {
        id: String,
    },
    FilterImport {},
    FilterProfileRemove {
        id: String,
    },
    FilterExport {
        target: tools::filters::Target,
    },
    FilterRecover {
        id: String,
        consent: bool,
    },
    DeltaPasswords {},
    AudioStatus {},
    AudioConfigure {
        config: tools::audio_dsp::EqConfig,
    },
    AudioStart {
        input: String,
        output: String,
        capture: bool,
        consent: bool,
    },
    AudioStop {},
    AudioDriverPrepare {},
    AudioPresets {},
    AudioPresetSave {
        name: String,
        config: tools::audio_dsp::EqConfig,
    },
    AudioPresetRemove {
        id: String,
    },
    AudioPresetImport {
        content: String,
    },
    AudioPresetExport {
        name: String,
        config: tools::audio_dsp::EqConfig,
        fac: bool,
    },
}

fn allowed_window(label: &str, _request: &Request) -> bool {
    label == "main"
}
#[tauri::command]
pub async fn builtin_execute(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ToolsState>,
    request: Request,
) -> Result<serde_json::Value, AppError> {
    if !allowed_window(window.label(), &request) {
        return Err(tools::error("辅助窗口不能读取或操作系统工具"));
    }
    match request {
        Request::FilterStatus {} => serde_json::to_value(state.filters.status(&state.root).await?)
            .map_err(|_| tools::error("滤镜状态无效")),
        Request::FilterConfigure {
            config,
            enabled,
            preview,
            consent,
        } => {
            if enabled
                && ["preparing", "confirming"]
                    .contains(&state.display.snapshot.lock().await.phase.as_str())
            {
                return Err(tools::error("请先完成显示模式确认，再开启滤镜"));
            }
            state
                .filters
                .configure(&state.root, config, enabled, preview, consent)
                .await?;
            if enabled && consent {
                window
                    .app_handle()
                    .state::<crate::services::settings::SettingsState>()
                    .filter_granted
                    .store(true, std::sync::atomic::Ordering::SeqCst);
            }
            Ok(serde_json::Value::Null)
        }
        Request::FilterKeep {} => {
            state.filters.keep().await?;
            Ok(serde_json::Value::Null)
        }
        Request::FilterPresetSave { name, config } => {
            state.filters.preset_save(&state.root, name, config).await?;
            Ok(serde_json::Value::Null)
        }
        Request::FilterPresetRemove { id } => {
            state.filters.preset_remove(&state.root, &id).await?;
            Ok(serde_json::Value::Null)
        }
        Request::FilterImport {} => {
            let app = window.app_handle().clone();
            let selected = tauri::async_runtime::spawn_blocking(move || {
                app.dialog()
                    .file()
                    .set_title("选择 ICC 校准文件")
                    .add_filter("ICC 校准曲线", &["icc", "icm"])
                    .blocking_pick_file()
                    .map(|path| {
                        path.into_path()
                            .map_err(|_| tools::error("仅支持本地 ICC 文件"))
                    })
                    .transpose()
            })
            .await
            .map_err(|_| tools::error("文件选择窗口异常"))??;
            if let Some(path) = selected {
                tools::filters::import_profile(&state.root, path).await?;
            }
            Ok(serde_json::Value::Null)
        }
        Request::FilterProfileRemove { id } => {
            state.filters.profile_remove(&state.root, &id).await?;
            Ok(serde_json::Value::Null)
        }
        Request::FilterExport { target } => {
            let ramp = tools::filters::target_ramp(&state.root, &target).await?;
            let bytes = tools::icc::export(&ramp)?;
            let directory = state.root.join("exports");
            tools::check_local_path(&directory).await?;
            tokio::fs::create_dir_all(&directory)
                .await
                .map_err(tools::io_error)?;
            let path = directory.join(format!("filter-{}.icc", uuid::Uuid::new_v4()));
            tokio::fs::write(&path, bytes)
                .await
                .map_err(tools::io_error)?;
            window
                .opener()
                .reveal_item_in_dir(&path)
                .map_err(|_| tools::error("ICC 已导出，但无法打开所在目录"))?;
            Ok(serde_json::json!({"path":path}))
        }
        Request::FilterRecover { id, consent } => {
            state.filters.recover(&state.root, &id, consent).await?;
            Ok(serde_json::Value::Null)
        }
        Request::DeltaPasswords {} => {
            serde_json::to_value(tools::remote::delta_passwords(&state).await?)
                .map_err(|_| tools::error("密码数据无效"))
        }
        Request::AudioPresets {} => {
            serde_json::to_value(tools::audio_presets::list(&state.root).await?)
                .map_err(|_| tools::error("音频预设列表无效"))
        }
        Request::AudioPresetSave { name, config } => {
            serde_json::to_value(tools::audio_presets::save(&state.root, name, config).await?)
                .map_err(|_| tools::error("音频预设无效"))
        }
        Request::AudioPresetRemove { id } => {
            tools::audio_presets::remove(&state.root, &id).await?;
            Ok(serde_json::Value::Null)
        }
        Request::AudioPresetImport { content } => {
            let (name, config) = tools::audio_presets::import(&content)?;
            serde_json::to_value(tools::audio_presets::save(&state.root, name, config).await?)
                .map_err(|_| tools::error("音频预设无效"))
        }
        Request::AudioPresetExport { name, config, fac } => {
            let path = tools::audio_presets::export(&state.root, name, config, fac).await?;
            window
                .opener()
                .reveal_item_in_dir(&path)
                .map_err(|_| tools::error("预设已导出，但无法打开所在目录"))?;
            Ok(serde_json::json!({"path":path}))
        }
        Request::AudioDriverPrepare {} => {
            tools::remote::prepare_audio_driver(&state).await?;
            Ok(serde_json::Value::Null)
        }
        Request::AudioStatus {} => serde_json::to_value(state.audio.snapshot().await?)
            .map_err(|_| tools::error("音频状态无效")),
        Request::AudioConfigure { config } => {
            state.audio.configure(config).await?;
            Ok(serde_json::Value::Null)
        }
        Request::AudioStart {
            input,
            output,
            capture,
            consent,
        } => {
            state.audio.start(input, output, capture, consent).await?;
            Ok(serde_json::Value::Null)
        }
        Request::AudioStop {} => {
            state.audio.stop().await?;
            Ok(serde_json::Value::Null)
        }
        Request::DriverHistory { refresh } => {
            serde_json::to_value(tools::remote::drivers(&state, refresh).await?)
                .map_err(|_| tools::error("驱动列表无效"))
        }
        Request::DriverOpen { id } => {
            let history = tools::remote::drivers(&state, false).await?;
            let row = history
                .drivers
                .into_iter()
                .find(|row| row.id == id)
                .ok_or_else(|| tools::error("驱动条目已过期，请刷新"))?;
            let expected = format!(
                "https://www.nvidia.cn/Download/driverResults.aspx/{}/zh-cn",
                row.id
            );
            if row.detail_url != expected || !row.id.bytes().all(|v| v.is_ascii_digit()) {
                return Err(tools::error("驱动来源无效"));
            }
            window
                .opener()
                .open_url(expected, None::<&str>)
                .map_err(|_| tools::error("无法打开 NVIDIA 官方详情页"))?;
            Ok(serde_json::Value::Null)
        }
        Request::FeatureDictionaryUpdate {} => {
            Ok(serde_json::json!({"count":tools::remote::update_dictionary(&state).await?}))
        }
        Request::DisplayStatus {} => {
            serde_json::to_value(state.display.snapshot.lock().await.clone())
                .map_err(|_| tools::error("显示模式状态无效"))
        }
        Request::DisplayHistory {} => {
            serde_json::to_value(tools::display::history(&state.root).await?)
                .map_err(|_| tools::error("显示模式备份无效"))
        }
        Request::DisplayRestore { id, consent } => {
            if state.filters.snapshot.lock().await.enabled {
                return Err(tools::error(
                    "请先停用显示滤镜，避免恢复曲线与显示模式切换冲突",
                ));
            }
            uuid::Uuid::parse_str(&id).map_err(|_| tools::error("显示模式备份标识无效"))?;
            let row = tools::display::history(&state.root)
                .await?
                .into_iter()
                .find(|row| row.id == id)
                .ok_or_else(|| tools::error("显示模式备份不存在"))?;
            state
                .display
                .switch(
                    &state.root,
                    tools::display::Target {
                        id: row.monitor,
                        width: row.width,
                        height: row.height,
                        refresh: row.refresh,
                    },
                    consent,
                )
                .await?;
            Ok(serde_json::Value::Null)
        }
        Request::DisplaySwitch { target, consent } => {
            if state.filters.snapshot.lock().await.enabled {
                return Err(tools::error(
                    "请先停用显示滤镜，避免恢复曲线与显示模式切换冲突",
                ));
            }
            state.display.switch(&state.root, target, consent).await?;
            Ok(serde_json::Value::Null)
        }
        Request::DisplayDecide { id, keep } => {
            state.display.decide(&id, keep).await?;
            Ok(serde_json::Value::Null)
        }
        Request::Query { tool } => builtin::query(&state, tool).await,
        Request::ClickStatus {} => {
            serde_json::to_value(state.clicker.snapshot.lock().await.clone())
                .map_err(|_| tools::error("无法读取连点状态"))
        }
        Request::ClickConfigure {
            config,
            enabled,
            immediate,
        } => {
            state
                .clicker
                .configure(&state.root, config, enabled, immediate)
                .await?;
            Ok(serde_json::Value::Null)
        }
        Request::ChangePrepare { change } => {
            serde_json::to_value(state.changes.prepare(&state.root, change).await?)
                .map_err(|_| tools::error("变更预览序列化失败"))
        }
        Request::ChangeApply { token, consent } => {
            if consent && state.changes.affects_audio(&token).await {
                state.audio.stop().await?;
            }
            serde_json::to_value(state.changes.apply(&state.root, &token, consent).await?)
                .map_err(|_| tools::error("变更回执序列化失败"))
        }
        Request::ChangeDiscard { token } => {
            state.changes.discard(&token).await?;
            Ok(serde_json::Value::Null)
        }
        Request::ChangeHistory {} => serde_json::to_value(state.changes.history().await?)
            .map_err(|_| tools::error("变更历史序列化失败")),
        Request::AppFile { id, reveal } => {
            tools::system_changes::SystemChange::AppUninstall { id: id.clone() }.validate()?;
            let value = tools::platform::run_system(
                &state.root,
                "app-path",
                &[id, if reveal { "reveal" } else { "open" }.into()],
                std::time::Duration::from_secs(30),
            )
            .await?;
            #[derive(Deserialize)]
            struct Location {
                path: std::path::PathBuf,
            }
            let target: Location =
                serde_json::from_value(value).map_err(|_| tools::error("应用路径无效"))?;
            if !target.path.is_absolute()
                || target
                    .path
                    .components()
                    .any(|part| matches!(part, std::path::Component::ParentDir))
            {
                return Err(tools::error("应用路径不合法"));
            }
            if reveal {
                window.opener().reveal_item_in_dir(&target.path)
            } else {
                if !target
                    .path
                    .extension()
                    .is_some_and(|ext| ext.eq_ignore_ascii_case("exe"))
                {
                    return Err(tools::error("仅支持启动检测到的EXE应用"));
                }
                window
                    .opener()
                    .open_path(target.path.to_string_lossy().into_owned(), None::<&str>)
            }
            .map_err(|_| tools::error("无法打开此应用，请检查系统关联与文件状态"))?;
            Ok(serde_json::Value::Null)
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn auxiliary_windows_cannot_escalate_to_system_changes() {
        for request in [
            Request::Query {
                tool: builtin::SystemQuery::Apps,
            },
            Request::ChangeApply {
                token: "token".into(),
                consent: true,
            },
            Request::AudioDriverPrepare {},
            Request::DisplayHistory {},
        ] {
            assert!(allowed_window("main", &request));
            assert!(!allowed_window("performance-overlay", &request));
            assert!(!allowed_window("screen-test", &request));
            assert!(!allowed_window("unknown", &request));
        }
        assert!(!allowed_window("hud", &Request::DeltaPasswords {}));
    }
    #[test]
    fn arbitrary_commands_and_extra_fields_are_rejected() {
        for text in [
            r#"{"operation":"query","tool":"apps","script":"bad"}"#,
            r#"{"operation":"change-prepare","change":{"kind":"gpu-restart","path":"C:/bad"}}"#,
        ] {
            assert!(serde_json::from_str::<Request>(text).is_err());
        }
    }
}
