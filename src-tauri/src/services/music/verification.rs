//! 仅 debug EXE 编译的真实 WebView2 验收入口，不开放脚本 IPC，不启动账户、监控或系统工具。
use super::{MusicState, sandbox};
use crate::services::tools::{Result, error, io_error};
use serde_json::json;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use tauri::Manager;

pub fn run() -> std::result::Result<(), Box<dyn std::error::Error>> {
    if std::env::var("ZHENJING_RESTRICT_WRITES_TO_D").as_deref() != Ok("1") {
        return Err("音乐原生验收必须启用 D 盘写入保护".into());
    }
    let workspace = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .ok_or("项目目录缺失")?;
    let root = workspace
        .join(".cache/verification")
        .join(format!("music-sandbox-{}", uuid::Uuid::new_v4()));
    crate::services::tools::ensure_local_path(&root)?;
    std::fs::create_dir_all(&root)?;
    let state = MusicState::new(&root)?;
    let completed = Arc::new(AtomicBool::new(false));
    let setup_completed = completed.clone();
    tauri::Builder::default()
        .manage(state)
        .register_asynchronous_uri_scheme_protocol("zhenjing-music", |context, request, responder| {
            let app = context.app_handle().clone();
            let label = context.webview_label().to_owned();
            tauri::async_runtime::spawn(async move {
                responder.respond(super::respond(&app, &label, request).await);
            });
        })
        .setup(move |app| {
            let app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let result = tokio::time::timeout(std::time::Duration::from_secs(60), check(&app))
                    .await.map_err(|_| error("音乐原生验收超时")).and_then(|value| value);
                let report = json!({"passed":result.is_ok(),"error":result.as_ref().err().map(ToString::to_string),"plannedChecks":["first-evaluation","concurrent-calls","script-failure-recovery","network-isolation"]});
                let written = tokio::fs::write(root.join("result.json"), report.to_string()).await;
                if let Some(window) = app.get_webview_window("music-sandbox") { let _ = window.destroy(); }
                if result.is_ok() && written.is_ok() {
                    setup_completed.store(true, Ordering::Release);
                    println!("Music WebView2 verification passed: {}", root.display());
                    app.exit(0);
                } else {
                    eprintln!("Music WebView2 verification failed: {}", root.display());
                    app.exit(1);
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())?
        .run(|_, event| {
            // 本验收没有主窗口，销毁失败的沙箱时仍须保留事件循环以检查自动恢复。
            if let tauri::RunEvent::ExitRequested { code: None, api, .. } = event {
                api.prevent_exit();
            }
        });
    if completed.load(Ordering::Acquire) {
        Ok(())
    } else {
        Err("音乐脚本沙箱验收未通过，详情见独立验收目录".into())
    }
}

async fn check(app: &tauri::AppHandle) -> Result<()> {
    let state = app.state::<MusicState>();
    let (cold_first, cold_second) = tokio::join!(
        sandbox::evaluate(app, &state, "1+2"),
        sandbox::evaluate(app, &state, "4+4"),
    );
    if cold_first? != json!(3) || cold_second? != json!(8) {
        return Err(error("首次脚本执行失败"));
    }
    println!("Music sandbox stage passed: first-evaluation");
    let (first, second) = tokio::join!(
        sandbox::evaluate(
            app,
            &state,
            "globalThis.__verification=(globalThis.__verification||0)+1"
        ),
        sandbox::evaluate(
            app,
            &state,
            "globalThis.__verification=(globalThis.__verification||0)+1"
        ),
    );
    if first? != json!(1) || second? != json!(2) {
        return Err(error("并发脚本未顺序执行"));
    }
    println!("Music sandbox stage passed: concurrent-calls");
    if sandbox::evaluate(app, &state, "throw Error('verification')")
        .await
        .is_ok()
    {
        return Err(error("无效脚本未拒绝"));
    }
    if sandbox::evaluate(app, &state, "6*7").await? != json!(42) {
        return Err(error("沙箱未能在失败后自动重建"));
    }
    println!("Music sandbox stage passed: script-failure-recovery");
    if sandbox::evaluate(
        app,
        &state,
        "fetch('https://example.com').then(()=>false,()=>true)",
    )
    .await?
        != json!(true)
    {
        return Err(error("脚本沙箱不应访问外网"));
    }
    tokio::fs::metadata(&state.root).await.map_err(io_error)?;
    Ok(())
}
