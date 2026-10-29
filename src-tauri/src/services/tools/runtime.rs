//! 运行库采用“检测→官方下载→微软签名/哈希→用户逐项确认→安装→重新检测”的两阶段流程。
use super::{
    Result,
    downloads::{DownloadInput, DownloadManager},
    error, platform,
};
use serde::Serialize;
use std::{path::PathBuf, sync::Arc, time::Duration};
use tokio::sync::Mutex;

pub struct Package {
    pub id: &'static str,
    pub name: &'static str,
    pub url: &'static str,
}
pub const PACKAGES: &[Package] = &[
    Package {
        id: "vc-v14-x64",
        name: "Visual C++ v14 x64",
        url: "https://aka.ms/vc14/vc_redist.x64.exe",
    },
    Package {
        id: "vc-v14-x86",
        name: "Visual C++ v14 x86",
        url: "https://aka.ms/vc14/vc_redist.x86.exe",
    },
    Package {
        id: "vc-2013-x64",
        name: "Visual C++ 2013 x64",
        url: "https://aka.ms/highdpimfc2013x64enu",
    },
    Package {
        id: "vc-2013-x86",
        name: "Visual C++ 2013 x86",
        url: "https://aka.ms/highdpimfc2013x86enu",
    },
    Package {
        id: "vc-2012-x64",
        name: "Visual C++ 2012 x64",
        url: "https://download.microsoft.com/download/1/6/B/16B06F60-3B20-4FF2-B699-5E9B7962F9AE/VSU_4/vcredist_x64.exe",
    },
    Package {
        id: "vc-2012-x86",
        name: "Visual C++ 2012 x86",
        url: "https://download.microsoft.com/download/1/6/B/16B06F60-3B20-4FF2-B699-5E9B7962F9AE/VSU_4/vcredist_x86.exe",
    },
    Package {
        id: "vc-2010-x64",
        name: "Visual C++ 2010 x64",
        url: "https://download.microsoft.com/download/1/6/5/165255E7-1014-4D0A-B094-B6A430A6BFFC/vcredist_x64.exe",
    },
    Package {
        id: "vc-2010-x86",
        name: "Visual C++ 2010 x86",
        url: "https://download.microsoft.com/download/1/6/5/165255E7-1014-4D0A-B094-B6A430A6BFFC/vcredist_x86.exe",
    },
    Package {
        id: "vc-2008-x64",
        name: "Visual C++ 2008 x64",
        url: "https://download.microsoft.com/download/5/D/8/5D8C65CB-C849-4025-8E95-C3966CAFD8AE/vcredist_x64.exe",
    },
    Package {
        id: "vc-2008-x86",
        name: "Visual C++ 2008 x86",
        url: "https://download.microsoft.com/download/5/D/8/5D8C65CB-C849-4025-8E95-C3966CAFD8AE/vcredist_x86.exe",
    },
    Package {
        id: "dotnet481",
        name: ".NET Framework 4.8.1",
        url: "https://go.microsoft.com/fwlink/?linkid=2203305",
    },
    Package {
        id: "directx",
        name: "DirectX旧版兼容组件",
        url: "https://download.microsoft.com/download/1/7/1/1718ccc4-6315-4d8e-9543-8e28a4e18c4c/dxwebsetup.exe",
    },
];
#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeJob {
    pub phase: String,
    pub package_id: String,
    pub name: String,
    pub message: String,
    pub download_id: Option<String>,
    pub token: Option<String>,
    pub sha256: Option<String>,
    pub publisher: Option<String>,
    pub bytes: Option<u64>,
    pub exit_code: Option<i64>,
    pub restart_required: bool,
}
struct Prepared {
    token: String,
    path: PathBuf,
    hash: String,
    package_id: String,
    created: std::time::Instant,
}
#[derive(Default)]
pub struct RuntimeService {
    pub job: Mutex<RuntimeJob>,
    prepared: Mutex<Option<Prepared>>,
}
impl RuntimeService {
    pub async fn snapshot(&self) -> RuntimeJob {
        self.job.lock().await.clone()
    }
    pub async fn prepare(
        self: &Arc<Self>,
        id: String,
        root: PathBuf,
        manager: Arc<DownloadManager>,
        client: reqwest::Client,
    ) -> Result<()> {
        let package = PACKAGES
            .iter()
            .find(|p| p.id == id)
            .ok_or_else(|| error("运行库ID不在允许列表"))?;
        let mut job = self.job.lock().await;
        if matches!(
            job.phase.as_str(),
            "downloading" | "verifying" | "installing" | "unknown"
        ) {
            return Err(error("已有运行库操作进行中，请先等待结果"));
        }
        *job = RuntimeJob {
            phase: "downloading".into(),
            package_id: id.clone(),
            name: package.name.into(),
            message: "仅下载与验证，尚未运行安装器".into(),
            ..RuntimeJob::default()
        };
        drop(job);
        *self.prepared.lock().await = None;
        let service = self.clone();
        let url = package.url.to_owned();
        tauri::async_runtime::spawn(async move {
            let result = async {
                let download_id = manager
                    .create(
                        DownloadInput {
                            url,
                            file_name: format!("{id}.exe"),
                            connections: 4,
                            limit_kib: 0,
                            expected_sha256: None,
                        },
                        client,
                    )
                    .await?;
                service.job.lock().await.download_id = Some(download_id.clone());
                let started = std::time::Instant::now();
                loop {
                    let task = manager.task(&download_id).await?;
                    match task.status.as_str() {
                        "complete" => {
                            service.job.lock().await.phase = "verifying".into();
                            let path = manager.final_path(&task);
                            let signature = platform::run(
                                &root,
                                "signature",
                                &[path.to_string_lossy().into_owned()],
                                Duration::from_secs(60),
                            )
                            .await?;
                            let subject = signature
                                .get("subject")
                                .and_then(|v| v.as_str())
                                .unwrap_or_default();
                            let is_microsoft = subject
                                .split(',')
                                .any(|field| field.trim() == "O=Microsoft Corporation");
                            if signature.get("valid").and_then(|v| v.as_bool()) != Some(true)
                                || !is_microsoft
                            {
                                return Err(error(
                                    "安装包未通过有效Microsoft Authenticode签名，禁止执行",
                                ));
                            }
                            let token = uuid::Uuid::new_v4().to_string();
                            let hash = task.sha256.ok_or_else(|| error("安装包缺少完整哈希"))?;
                            *service.prepared.lock().await = Some(Prepared {
                                token: token.clone(),
                                path,
                                hash: hash.clone(),
                                package_id: id,
                                created: std::time::Instant::now(),
                            });
                            let mut job = service.job.lock().await;
                            job.phase = "ready".into();
                            job.message =
                                "已验证微软签名；确认后才会请求管理员权限并写入系统目录".into();
                            job.token = Some(token);
                            job.sha256 = Some(hash);
                            job.publisher = Some(subject.into());
                            job.bytes = task.total;
                            return Ok(());
                        }
                        "failed" | "cancelled" | "paused" => return Err(error(task.message)),
                        _ => {}
                    }
                    if started.elapsed() > Duration::from_secs(1800) {
                        manager
                            .control(&download_id, "pause", super::downloads::http_client()?)
                            .await?;
                        return Err(error("安装包准备超过30分钟，已暂停下载"));
                    }
                    tokio::time::sleep(Duration::from_millis(350)).await;
                }
            }
            .await;
            if let Err(cause) = result {
                let mut job = service.job.lock().await;
                job.phase = "failed".into();
                job.message = cause.to_string();
            }
        });
        Ok(())
    }
    pub async fn install(
        self: &Arc<Self>,
        token: &str,
        consent: bool,
        root: PathBuf,
    ) -> Result<()> {
        if !consent {
            return Err(error("需要逐项确认系统目录和注册表写入"));
        }
        let mut prepared = self.prepared.lock().await;
        let package = prepared
            .take()
            .ok_or_else(|| error("请先准备并验证安装包"))?;
        if package.token != token || package.created.elapsed() > Duration::from_secs(900) {
            *prepared = Some(package);
            return Err(error("安装确认已过期或无效，请重新准备"));
        }
        if self.job.lock().await.phase != "ready" {
            return Err(error("安装包当前不是可安装状态"));
        }
        self.job.lock().await.phase = "installing".into();
        drop(prepared);
        let service = self.clone();
        tauri::async_runtime::spawn(async move {
            let result = async {
                let file_path = package.path.clone();
                // 持有禁止共享写入/删除的句柄直至安装结束，缩小签名验证后的替换竞态。
                let lock = tauri::async_runtime::spawn_blocking(move || {
                    super::ensure_local_path(&file_path)?;
                    let mut options = std::fs::OpenOptions::new();
                    options.read(true);
                    #[cfg(windows)]
                    {
                        use std::os::windows::fs::OpenOptionsExt;
                        options.share_mode(1);
                    }
                    options.open(file_path).map_err(super::io_error)
                })
                .await
                .map_err(|_| error("安装包锁定任务失败"))??;
                let receipt = platform::run(
                    &root,
                    "install-runtime",
                    &[
                        package.path.to_string_lossy().into_owned(),
                        package.hash,
                        package.package_id,
                    ],
                    Duration::from_secs(1800),
                )
                .await;
                drop(lock);
                receipt
            }
            .await;
            let mut job = service.job.lock().await;
            match result {
                Ok(receipt) => {
                    job.exit_code = receipt.get("exitCode").and_then(|v| v.as_i64());
                    job.restart_required = receipt
                        .get("restartRequired")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false);
                    if receipt.get("success").and_then(|v| v.as_bool()) == Some(true) {
                        job.phase = "complete".into();
                        job.message = if job.restart_required {
                            "安装器返回成功，需要重启后再次检测"
                        } else {
                            "安装器返回成功，请重新检测组件状态"
                        }
                        .into();
                    } else {
                        job.phase = "failed".into();
                        job.message = format!(
                            "安装器退出码 {:?}，请查看系统安装提示；未报告修复成功",
                            job.exit_code
                        );
                    }
                }
                Err(cause) => {
                    job.phase = "unknown".into();
                    job.message = format!(
                        "安装状态需核实：{cause}。请检查安装器/UAC提示及组件检测结果，避免重复执行"
                    );
                }
            }
            let _ = super::save_json(&root.join("runtime-last-result.json"), &*job).await;
        });
        Ok(())
    }
}
