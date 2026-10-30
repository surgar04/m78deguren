mod commands;
mod error;
mod services;
#[path = "../../native/common/storage_policy.rs"]
pub mod storage_policy;

use std::path::PathBuf;
use tauri::Manager;
use tauri_plugin_log::{Target, TargetKind};

/// Windows 卸载入口先设置经校验的临时目录，再退出本启动器。
/// MSI 负责产品登记与事务卸载；主程序只打开属于本安装标记的卸载向导。
pub fn handle_uninstall() -> Result<bool, Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args_os().collect();
    if args.len() != 2 || args.get(1).is_none_or(|arg| arg != "--uninstall") {
        return Ok(false);
    }
    let exe = std::env::current_exe()?;
    let folder = exe.parent().ok_or("安装目录不可用")?;
    services::tools::ensure_local_path(folder)?;
    let bytes = std::fs::read(folder.join("zhenjing-install.ini"))?;
    if bytes.len() > 16384 {
        return Err("安装标记超过上限".into());
    }
    let marker = if bytes.starts_with(&[0xff, 0xfe]) {
        String::from_utf16(
            &bytes[2..]
                .chunks_exact(2)
                .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
                .collect::<Vec<_>>(),
        )?
    } else {
        String::from_utf8(bytes)?
    };
    if !marker
        .lines()
        .any(|line| line.trim() == "Id=dev.zhenjing.desktop")
    {
        return Err("安装标记不匹配，拒绝启动卸载".into());
    }
    let temporary = storage_policy::installer_temp_base()?;
    services::tools::ensure_local_path(&temporary)?;
    std::fs::create_dir_all(&temporary)?;
    let product = marker
        .lines()
        .find_map(|line| line.trim().strip_prefix("ProductCode="))
        .ok_or("MSI 产品标识缺失，请从 Windows 已安装的应用中卸载旧版本")?;
    let product_id = uuid::Uuid::parse_str(product.trim_matches(['{', '}']))?;
    let engine = PathBuf::from(std::env::var_os("SystemRoot").ok_or("Windows 系统目录缺失")?)
        .join("System32/msiexec.exe");
    std::process::Command::new(engine)
        .arg("/x")
        .arg(format!("{{{product_id}}}"))
        .arg("/norestart")
        .env("TEMP", &temporary)
        .env("TMP", &temporary)
        .current_dir(folder)
        .spawn()?;
    Ok(true)
}

/// 在创建 WebView 和日志之前校验存储位置。显式目录无效时直接报错，不悄悄切换档案。
fn installed_profile_root() -> std::io::Result<Option<PathBuf>> {
    use std::io::{Error, ErrorKind, Read};
    let executable = std::env::current_exe()?;
    let folder = executable
        .parent()
        .ok_or_else(|| Error::new(ErrorKind::InvalidData, "应用目录不可用"))?;
    let file = match std::fs::File::open(folder.join("zhenjing-profile.ini")) {
        Ok(file) => file,
        Err(cause) if cause.kind() == ErrorKind::NotFound => return Ok(None),
        Err(cause) => return Err(cause),
    };
    let mut bytes = Vec::new();
    file.take(8193).read_to_end(&mut bytes)?;
    parse_profile_root(&bytes)
}
/// 与磁盘操作隔离的解析器；MSI 的 UTF-16 引导必须保留所有语言的用户目录。
fn parse_profile_root(bytes: &[u8]) -> std::io::Result<Option<PathBuf>> {
    use std::io::{Error, ErrorKind};
    if bytes.len() > 8192 {
        return Err(Error::new(ErrorKind::InvalidData, "MSI 档案引导文件过大"));
    }
    let text = if bytes.starts_with(&[0xff, 0xfe]) {
        if !bytes.len().is_multiple_of(2) {
            return Err(Error::new(ErrorKind::InvalidData, "UTF-16 档案引导不完整"));
        }
        String::from_utf16(
            &bytes[2..]
                .chunks_exact(2)
                .map(|v| u16::from_le_bytes([v[0], v[1]]))
                .collect::<Vec<_>>(),
        )
        .map_err(|_| Error::new(ErrorKind::InvalidData, "档案引导编码错误"))?
    } else {
        String::from_utf8(bytes.to_vec())
            .map_err(|_| Error::new(ErrorKind::InvalidData, "档案引导编码错误"))?
    };
    let mut section = false;
    let mut id = None;
    let mut data = None;
    for line in text.trim_start_matches('\u{feff}').lines() {
        let line = line.trim();
        if line.starts_with('[') {
            section = line.eq_ignore_ascii_case("[Application]");
            continue;
        }
        if !section {
            continue;
        }
        if let Some((key, value)) = line.split_once('=') {
            if key.trim().eq_ignore_ascii_case("Id") {
                id = Some(value.trim());
            }
            if key.trim().eq_ignore_ascii_case("DataRoot") {
                data = Some(value.trim());
            }
        }
    }
    if id != Some("dev.zhenjing.desktop") {
        return Err(Error::new(ErrorKind::InvalidData, "MSI 档案引导身份无效"));
    }
    Ok(data.filter(|v| !v.is_empty()).map(PathBuf::from))
}
fn data_root() -> Result<PathBuf, Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();
    let explicit = if let Some(index) = args.iter().position(|argument| argument == "--data-dir") {
        Some(PathBuf::from(
            args.get(index + 1).ok_or("--data-dir 缺少目录")?,
        ))
    } else {
        None
    };
    let root = explicit
        .or_else(|| std::env::var_os("ZHENJING_DATA_DIR").map(PathBuf::from))
        .or_else(|| std::env::var_os("XINJING_DATA_DIR").map(PathBuf::from))
        .map(Ok)
        .unwrap_or_else(|| {
            installed_profile_root()?
                .map(Ok)
                .unwrap_or_else(storage_policy::default_data_root)
        })?;
    storage_policy::validate_data_root(&root)?;
    services::tools::ensure_local_path(&root)?;
    std::fs::create_dir_all(&root)?;
    // 固定实际大小写与分隔符，备份清单和重启助手不能因不同写法误判为不同目录。
    let canonical = std::fs::canonicalize(&root)?;
    let text = canonical.to_str().ok_or("数据目录不是有效 Unicode 路径")?;
    let normalized = PathBuf::from(text.strip_prefix(r"\\?\").unwrap_or(text));
    services::tools::ensure_local_path(&normalized)?;
    // 规范化后再检查一次，避免 8.3 短名称或不同路径写法绕过档案根保护。
    storage_policy::validate_data_root(&normalized)?;
    Ok(normalized)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if let Err(error) = run_app() {
        eprintln!("臻境启动失败: {error}");
        // GUI 子系统没有可见终端；初始化失败必须向用户说明原因，不能只留下闪退。
        rfd::MessageDialog::new()
            .set_title("臻境无法启动")
            .set_level(rfd::MessageLevel::Error)
            .set_description(format!("{error}\n请检查数据目录权限与 Microsoft Edge WebView2 运行时。若指定了 --data-dir，请确认该目录可用。"))
            .show();
        std::process::exit(1);
    }
}

fn run_app() -> Result<(), Box<dyn std::error::Error>> {
    let root = data_root()?;
    let logs = root.join("logs");
    std::fs::create_dir_all(&logs)?;
    let mut context = tauri::generate_context!();
    let settings = services::settings::SettingsState::new(&root)?;
    let onboarding = services::onboarding::OnboardingState::new(&root)?;
    let first_start = !onboarding
        .progress
        .try_lock()
        .map_err(|_| "向导状态被占用")?
        .complete;
    // 同时覆盖插件解析的数据、缓存和日志目录。
    context.config_mut().app.app_directories_override = Some(
        tauri::utils::config::AppDirectoriesOverride::Root(root.clone()),
    );
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(settings)
        .manage(onboarding)
        .manage(services::hardware::HardwareState::new(&root)?)
        .manage(services::hud::HudState::new(&root)?)
        .manage(services::steam::SteamState::new(&root)?)
        .manage(services::home::HomeState::new(&root)?)
        .manage(services::other_games::OtherGamesState::new(&root)?)
        .manage(services::acceleration::AccelerationState::new(&root)?)
        .manage(services::quick_launch::QuickLaunchState::new(&root)?)
        .manage(services::tools::ToolsState::new(&root)?)
        .register_asynchronous_uri_scheme_protocol(
            "zhenjing-asset",
            |context, request, responder| {
                let app = context.app_handle().clone();
                tauri::async_runtime::spawn(async move {
                    let tools = app.state::<services::tools::ToolsState>();
                    let Ok(_permit) = tools.media_slots.acquire().await else {
                        return;
                    };
                    let state = app.state::<services::settings::SettingsState>();
                    let id = request.uri().path().trim_start_matches('/');
                    let target = state.assets.lock().await.path(id);
                    let range = request
                        .headers()
                        .get("Range")
                        .and_then(|value| value.to_str().ok())
                        .map(str::to_owned);
                    let head = request.method() == tauri::http::Method::HEAD;
                    let origin = request
                        .headers()
                        .get("Origin")
                        .and_then(|value| value.to_str().ok())
                        .filter(|origin| {
                            matches!(
                                *origin,
                                "http://tauri.localhost"
                                    | "http://127.0.0.1:1420"
                                    | "http://localhost:1420"
                            )
                        })
                        .unwrap_or("http://tauri.localhost")
                        .to_owned();
                    let response = tauri::async_runtime::spawn_blocking(move || {
                        target.and_then(|(path, asset)| {
                            services::settings::assets::response(
                                &path,
                                &asset,
                                range.as_deref(),
                                head,
                            )
                        })
                    })
                    .await;
                    let mut response = match response {
                        Ok(Ok(response)) => response,
                        _ => tauri::http::Response::builder()
                            .status(404)
                            .body(Vec::new())
                            .unwrap_or_default(),
                    };
                    if let Ok(origin) = tauri::http::HeaderValue::from_str(&origin) {
                        response
                            .headers_mut()
                            .insert("Access-Control-Allow-Origin", origin);
                        response
                            .headers_mut()
                            .insert("Vary", tauri::http::HeaderValue::from_static("Origin"));
                    }
                    responder.respond(response);
                });
            },
        )
        .register_asynchronous_uri_scheme_protocol(
            "zhenjing-media",
            |context, request, responder| {
                let app = context.app_handle().clone();
                tauri::async_runtime::spawn(async move {
                    let state = app.state::<services::tools::ToolsState>();
                    let Ok(_permit) = state.media_slots.acquire().await else {
                        return;
                    };
                    let store = state.recordings.clone();
                    let origin = request
                        .headers()
                        .get("Origin")
                        .and_then(|value| value.to_str().ok())
                        .filter(|origin| {
                            matches!(
                                *origin,
                                "http://tauri.localhost"
                                    | "http://127.0.0.1:1420"
                                    | "http://localhost:1420"
                            )
                        })
                        .unwrap_or("http://tauri.localhost")
                        .to_owned();
                    let id = request.uri().path().trim_start_matches('/').to_owned();
                    let range = request
                        .headers()
                        .get("Range")
                        .and_then(|v| v.to_str().ok())
                        .map(str::to_owned);
                    let head = request.method() == tauri::http::Method::HEAD;
                    let response = tauri::async_runtime::spawn_blocking(move || {
                        let store = store.blocking_lock();
                        store.path(&id).and_then(|path| {
                            services::tools::recordings::media_response(
                                &path,
                                range.as_deref(),
                                head,
                            )
                        })
                    })
                    .await;
                    let mut response = match response {
                        Ok(Ok(response)) => response,
                        _ => tauri::http::Response::builder()
                            .status(416)
                            .body(Vec::new())
                            .unwrap_or_default(),
                    };
                    if let Ok(value) = tauri::http::HeaderValue::from_str(&origin) {
                        response
                            .headers_mut()
                            .insert("Access-Control-Allow-Origin", value);
                        response
                            .headers_mut()
                            .insert("Vary", tauri::http::HeaderValue::from_static("Origin"));
                    }
                    responder.respond(response);
                });
            },
        )
        .manage(services::AppState::new()?)
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([Target::new(TargetKind::Folder {
                    path: logs,
                    file_name: Some("zhenjing".into()),
                })])
                .level(log::LevelFilter::Info)
                .max_file_size(5_000_000)
                .build(),
        )
        .on_window_event(|window, event| {
            if window.label() == "main"
                && let tauri::WindowEvent::CloseRequested { api, .. } = event
            {
                use std::sync::atomic::Ordering;
                if let Some(state) = window
                    .app_handle()
                    .try_state::<services::settings::SettingsState>()
                {
                    if state.critical.load(Ordering::SeqCst) {
                        api.prevent_close();
                        let _ = tauri::Emitter::emit_to(
                            window.app_handle(),
                            "main",
                            "settings-notice",
                            "关键任务正在执行，请等待完成后退出",
                        );
                    } else if state.close_to_tray.load(Ordering::SeqCst)
                        || window
                            .app_handle()
                            .state::<services::quick_launch::QuickLaunchState>()
                            .enabled
                            .load(Ordering::SeqCst)
                    {
                        api.prevent_close();
                        let _ = window.hide();
                    } else {
                        // 独立传感器等辅助窗口存在时，关闭主窗口仍遵循“直接退出”偏好。
                        api.prevent_close();
                        window.app_handle().exit(0);
                    }
                }
            }
            // 直接退出或强制销毁仍结束全部辅助窗口；收托盘仅隐藏，不销毁主窗口。
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
                window.app_handle().exit(0);
            }
        })
        .setup(move |app| {
            services::settings::runtime::tray(app.handle())?;
            let mut config = app
                .config()
                .app
                .windows
                .first()
                .ok_or("缺少主窗口配置")?
                .clone();
            if first_start {
                config.url = tauri::WebviewUrl::App("index.html#/setup".into());
            }
            let minimized = std::env::args().any(|argument| argument == "--autostart")
                && app
                    .state::<services::settings::SettingsState>()
                    .config
                    .try_lock()
                    .map_err(|_| "启动配置被占用")?
                    .minimized_start;
            let mut builder = tauri::WebviewWindowBuilder::from_config(app.handle(), &config)?
                .data_directory(root.join("webview"))
                .visible(first_start || !minimized);
            // 按工作区和 DPI 计算逻辑尺寸，避免 125%/150% 缩放时窗口超出屏幕或遮挡任务栏。
            if let Ok(Some(monitor)) = app.primary_monitor() {
                let available = monitor
                    .work_area()
                    .size
                    .to_logical::<f64>(monitor.scale_factor());
                let width = config.width.min((available.width - 48.0).max(320.0));
                let height = config.height.min((available.height - 48.0).max(320.0));
                builder = builder.inner_size(width, height).min_inner_size(
                    config.min_width.unwrap_or(760.0).min(width),
                    config.min_height.unwrap_or(560.0).min(height),
                );
            }
            builder.build()?;
            services::settings::runtime::boot(app.handle())?;
            services::hud::runtime::boot(app.handle());
            let home_app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(cause) = home_app
                    .state::<services::home::HomeState>()
                    .boot(&home_app)
                    .await
                {
                    log::warn!("首页原生服务启动失败: {cause}");
                }
            });
            log::info!("臻境已启动");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::greet,
            commands::app_info,
            commands::tools::tools_execute,
            commands::builtin::builtin_execute,
            commands::optimizer::optimizer_execute,
            commands::settings::settings_execute,
            commands::hardware::hardware_execute,
            commands::hud::hud_execute,
            commands::onboarding::onboarding_execute,
            commands::steam::steam_execute,
            commands::home::home_execute,
            commands::launchers::other_games_execute,
            commands::launchers::quick_launch_execute,
            commands::acceleration::acceleration_execute
        ])
        .build(context)?
        .run({
            let shutting_down = std::sync::atomic::AtomicBool::new(false);
            move |app, event| {
                if let tauri::RunEvent::ExitRequested { api, code, .. } = event
                    && !shutting_down.swap(true, std::sync::atomic::Ordering::SeqCst)
                {
                    api.prevent_exit();
                    let app = app.clone();
                    app.state::<services::hud::HudState>().cancellation.cancel();
                    let hardware = app.state::<services::hardware::Hardware>().inner().clone();
                    tauri::async_runtime::spawn(async move {
                        let home = app.state::<services::home::HomeState>();
                        if !matches!(
                            tokio::time::timeout(
                                std::time::Duration::from_secs(8),
                                home.shutdown()
                            )
                            .await,
                            Ok(Ok(()))
                        ) {
                            log::warn!("首页控制恢复仍由独立助手完成");
                        }
                        let result = tokio::time::timeout(
                            std::time::Duration::from_secs(6),
                            hardware.shutdown(),
                        )
                        .await;
                        if !matches!(result, Ok(Ok(()))) {
                            log::warn!("硬件记录关闭未正常完成：{result:?}");
                        }
                        app.exit(code.unwrap_or_default());
                    });
                }
            }
        });
    Ok(())
}

#[cfg(test)]
mod profile_bootstrap_tests {
    use super::parse_profile_root;
    #[test]
    fn utf16_preserves_unicode_profile_without_filesystem_writes() {
        let path = "E:\\用户 数据\\🎮\\臻境";
        let text = format!("[Application]\r\nId=dev.zhenjing.desktop\r\nDataRoot={path}\r\n");
        let mut bytes = vec![0xff, 0xfe];
        bytes.extend(text.encode_utf16().flat_map(u16::to_le_bytes));
        assert_eq!(
            parse_profile_root(&bytes).ok().flatten(),
            Some(std::path::PathBuf::from(path))
        );
    }
    #[test]
    fn bootstrap_rejects_wrong_identity_size_and_truncated_utf16() {
        assert!(parse_profile_root(b"[Application]\nId=other\nDataRoot=E:\\data").is_err());
        assert!(parse_profile_root(&vec![b'a'; 8193]).is_err());
        assert!(parse_profile_root(&[0xff, 0xfe, b'A']).is_err());
        assert!(
            parse_profile_root(include_bytes!("../resources/profile-seed.ini"))
                .is_ok_and(|value| value.is_none())
        );
    }
}
