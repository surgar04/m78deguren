//! 主窗口可以管理采样、报告和局域网服务；独立传感器窗口只允许读取共享快照。
use crate::{
    error::AppError,
    services::{
        hardware::{Hardware, history, types::Snapshot},
        tools::{Result, error},
    },
};
use serde::{Deserialize, Serialize};
use tauri::Manager;

#[derive(Deserialize)]
#[serde(tag = "operation", rename_all = "kebab-case", deny_unknown_fields)]
pub enum Request {
    Snapshot {},
    Restart { privileged: bool, consent: bool },
    SensorsOpen {},
    Copy {},
    Export { from: Option<i64>, to: Option<i64> },
    Clear { consent: bool },
    FpsStart { pid: Option<u32>, consent: bool },
    FpsStop {},
    RemoteInfo {},
    RemoteStart { address: String, consent: bool },
    RemoteStop {},
}
fn permitted(label: &str, request: &Request) -> bool {
    label == "main" || label == "sensor-monitor" && matches!(request, Request::Snapshot {})
}
fn json<T: Serialize>(value: T) -> Result<serde_json::Value> {
    serde_json::to_value(value).map_err(|_| error("硬件响应编码失败"))
}
fn copy_text(snapshot: &Snapshot) -> String {
    let mut text = String::from("臻境 · 完整硬件信息\n");
    for device in &snapshot.devices {
        text.push_str(&format!("\n[{}] {}\n", device.kind, device.name));
        for field in &device.fields {
            text.push_str(&format!("{}：{}\n", field.label, field.value));
        }
    }
    text.push_str("\n[原始传感器]\n");
    for sensor in &snapshot.sensors {
        text.push_str(&format!(
            "{} / {}：{} {}\n",
            sensor.hardware,
            sensor.name,
            sensor
                .value
                .map_or("不可用".into(), |value| format!("{value:.2}")),
            sensor.unit
        ));
    }
    text
}
#[tauri::command]
pub async fn hardware_execute(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Hardware>,
    request: Request,
) -> std::result::Result<serde_json::Value, AppError> {
    if !permitted(window.label(), &request) {
        return Err(error("该辅助窗口没有硬件管理权限"));
    }
    state.ui_seen.store(
        chrono::Utc::now().timestamp_millis(),
        std::sync::atomic::Ordering::Relaxed,
    );
    match request {
        Request::Snapshot {} => {
            state.ui_seen.store(
                chrono::Utc::now().timestamp_millis(),
                std::sync::atomic::Ordering::Relaxed,
            );
            state.start().await?;
            json(state.read().await)
        }
        Request::Restart {
            privileged,
            consent,
        } => {
            if privileged && !consent {
                return Err(error("必须确认读取已安装驱动提供的底层传感器"));
            }
            state.restart(privileged).await?;
            json(())
        }
        Request::Copy {} => json(copy_text(&state.read().await)),
        Request::Clear { consent } => {
            if !consent {
                return Err(error("必须确认清除全部硬件时序记录"));
            }
            state.clear().await?;
            json(())
        }
        Request::Export { from, to } => {
            if from.is_some_and(|value| value < 0)
                || to.is_some_and(|value| value < 0)
                || from.zip(to).is_some_and(|(from, to)| from > to)
            {
                return Err(error("报告时间范围无效"));
            }
            let (points, count) = state
                .history
                .lock()
                .await
                .as_mut()
                .ok_or_else(|| error("记录服务尚未就绪"))?
                .points(from, to)
                .await?;
            let snapshot = state.read().await;
            json(history::report(&state.root, &snapshot, points, count).await?)
        }
        Request::SensorsOpen {} => {
            let app = window.app_handle();
            if let Some(existing) = app.get_webview_window("sensor-monitor") {
                existing.show().map_err(|_| error("传感器窗口无法显示"))?;
                existing
                    .set_focus()
                    .map_err(|_| error("传感器窗口无法聚焦"))?;
            } else {
                let folder = state.root.join("sensor-webview");
                crate::services::tools::check_local_path(&folder).await?;
                tauri::WebviewWindowBuilder::new(
                    app,
                    "sensor-monitor",
                    tauri::WebviewUrl::App("index.html#/sensor-monitor".into()),
                )
                .title("臻境 · 原始传感器")
                .inner_size(1000.0, 720.0)
                .min_inner_size(640.0, 480.0)
                .data_directory(folder)
                .build()
                .map_err(|_| error("传感器窗口创建失败"))?;
            }
            json(())
        }
        Request::FpsStart { pid, consent } => {
            if !consent || pid == Some(0) || pid == Some(std::process::id()) {
                return Err(error("请选择有效目标并确认启动 ETW Present 采样"));
            }
            let frames = state.frames.clone();
            tauri::async_runtime::spawn_blocking(move || frames.start(pid))
                .await
                .map_err(|_| error("ETW 启动任务失败"))??;
            json(())
        }
        Request::FpsStop {} => {
            let frames = state.frames.clone();
            tauri::async_runtime::spawn_blocking(move || frames.stop())
                .await
                .map_err(|_| error("ETW 停止任务失败"))??;
            json(())
        }
        Request::RemoteInfo {} => json(state.remote.info(&state.read().await).await),
        Request::RemoteStart { address, consent } => {
            if !consent {
                return Err(error("必须确认开放局域网只读监控"));
            }
            json(state.remote.start(state.snapshot.clone(), &address).await?)
        }
        Request::RemoteStop {} => {
            state.remote.stop().await;
            json(())
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn auxiliary_is_read_only() {
        assert!(permitted("sensor-monitor", &Request::Snapshot {}));
        assert!(!permitted(
            "sensor-monitor",
            &Request::Clear { consent: true }
        ));
        assert!(!permitted("desktop-island", &Request::Snapshot {}));
        assert!(
            serde_json::from_str::<Request>(
                r#"{"operation":"export","from":null,"to":null,"path":"C:/x"}"#
            )
            .is_err()
        );
    }
}
