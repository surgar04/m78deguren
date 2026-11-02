//! 有界 JSON-RPC 子进程。标准输出不记日志，账户口令从不进入日志或前端。
use super::{MusicState, sandbox};
use crate::services::{
    components,
    tools::{Result, error, io_error},
};
use serde_json::{Value, json};
use std::{collections::HashMap, sync::Arc};
use std::{path::Path, time::Duration};
use tauri::Manager;
use tokio::sync::{Mutex, oneshot};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, ChildStdout, Command},
};

pub struct Host {
    child: Mutex<Child>,
    input: Arc<Mutex<ChildStdin>>,
    pending: Arc<Mutex<HashMap<String, oneshot::Sender<Value>>>>,
    reader: tokio::task::JoinHandle<()>,
    pub port: u16,
    pub secret: String,
    _bundles: Vec<components::Bundle>,
}
/// 即便子进程协议损坏也不允许分配无上限字符串。
async fn frame(reader: &mut BufReader<ChildStdout>) -> Result<Value> {
    let mut bytes = Vec::new();
    loop {
        let available = reader.fill_buf().await.map_err(io_error)?;
        if available.is_empty() {
            return Err(error("音乐服务已退出，请重试"));
        }
        let count = available
            .iter()
            .position(|&byte| byte == b'\n')
            .map_or(available.len(), |index| index + 1);
        if bytes.len() + count > 12 * 1024 * 1024 {
            return Err(error("音乐服务响应超过协议上限"));
        }
        let complete = available[count - 1] == b'\n';
        bytes.extend_from_slice(&available[..count]);
        reader.consume(count);
        if complete {
            return serde_json::from_slice(&bytes).map_err(|_| error("音乐服务响应格式无效"));
        }
    }
}
impl Host {
    pub async fn start(root: &Path, app: tauri::AppHandle) -> Result<Self> {
        let bundle = components::music().await?;
        let vault = components::monitor().await?;
        let folder = bundle
            .executable
            .parent()
            .ok_or_else(|| error("音乐组件目录缺失"))?;
        let temporary = root.join("tmp");
        tokio::fs::create_dir_all(&temporary)
            .await
            .map_err(io_error)?;
        let mut command = Command::new(&bundle.executable);
        // Node 不自动采用 Windows 的显式代理。只读当前用户配置并仅传给音乐进程，避免系统代理可用而平台仍直连失败。
        if std::env::var_os("HTTPS_PROXY").is_none() {
            let mut detector = Command::new(&vault.executable);
            detector
                .arg("--music-proxy")
                .stdin(std::process::Stdio::null())
                .stderr(std::process::Stdio::null());
            components::configure_child(&mut detector);
            #[cfg(windows)]
            detector.creation_flags(0x08000000);
            if let Ok(Ok(output)) =
                tokio::time::timeout(Duration::from_secs(5), detector.output()).await
                && output.status.success()
                && output.stdout.len() <= 4096
                && let Ok(text) = std::str::from_utf8(&output.stdout)
                && let Ok(proxy) = reqwest::Url::parse(text.trim())
                && matches!(proxy.scheme(), "http" | "https")
                && proxy.username().is_empty()
                && proxy.password().is_none()
            {
                command
                    .env("HTTPS_PROXY", proxy.as_str())
                    .env("HTTP_PROXY", proxy.as_str());
            }
        }
        command
            .env("NODE_USE_ENV_PROXY", "1")
            .env("NO_PROXY", "127.0.0.1,localhost");
        command
            .arg("--max-old-space-size=256")
            .arg(folder.join("index.ts"))
            .current_dir(root)
            .env("ZHENJING_MUSIC_DATA", root)
            .env("ZHENJING_MUSIC_VAULT", &vault.executable)
            .env("TEMP", &temporary)
            .env("TMP", &temporary)
            .env("ENABLE_GENERAL_UNBLOCK", "false")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .kill_on_drop(true);
        for key in [
            "NODE_OPTIONS",
            "NODE_PATH",
            "NODE_EXTRA_CA_CERTS",
            "NODE_TLS_REJECT_UNAUTHORIZED",
            "ELECTRON_RUN_AS_NODE",
            "LOX_LIBRESPOT_ADDON_PATH",
        ] {
            command.env_remove(key);
        }
        components::configure_child(&mut command);
        #[cfg(windows)]
        command.creation_flags(0x08000000);
        let mut child = command
            .spawn()
            .map_err(|_| error("音乐组件无法启动，请修复安装"))?;
        let input = child
            .stdin
            .take()
            .ok_or_else(|| error("音乐输入管道不可用"))?;
        let mut output = BufReader::new(
            child
                .stdout
                .take()
                .ok_or_else(|| error("音乐输出管道不可用"))?,
        );
        let ready = tokio::time::timeout(Duration::from_secs(30), frame(&mut output))
            .await
            .map_err(|_| error("音乐服务启动超时"))??;
        let port = ready["port"]
            .as_u64()
            .filter(|v| *v > 0 && *v <= 65535)
            .ok_or_else(|| error("音乐流端口无效"))? as u16;
        let secret = ready["secret"]
            .as_str()
            .filter(|v| v.len() == 64 && v.bytes().all(|b| b.is_ascii_hexdigit()))
            .ok_or_else(|| error("音乐流身份无效"))?
            .to_owned();
        if ready["type"] != "ready" || ready["version"] != 1 {
            return Err(error("音乐组件版本不兼容"));
        }
        let input = Arc::new(Mutex::new(input));
        let pending: Arc<Mutex<HashMap<String, oneshot::Sender<Value>>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let replies = pending.clone();
        let writer = input.clone();
        // 持续处理音频流期间发起的反向调用，不依赖前端恰好还有其他 RPC 请求。
        let reader = tokio::spawn(async move {
            while let Ok(response) = frame(&mut output).await {
                if response["type"] == "result" {
                    if let Some(id) = response["id"].as_str()
                        && let Some(sender) = replies.lock().await.remove(id)
                    {
                        let _ = sender.send(response);
                    }
                } else if response["type"] == "host-call" {
                    let state = app.state::<MusicState>();
                    if host_call(&app, &state, &writer, &response).await.is_err() {
                        break;
                    }
                }
            }
            replies.lock().await.clear();
        });
        Ok(Self {
            child: Mutex::new(child),
            input,
            pending,
            reader,
            port,
            secret,
            _bundles: vec![bundle, vault],
        })
    }
    pub async fn request(&self, mut request: Value) -> Result<Value> {
        let id = uuid::Uuid::new_v4().to_string();
        request["id"] = Value::String(id.clone());
        let (sender, receiver) = oneshot::channel();
        self.pending.lock().await.insert(id.clone(), sender);
        if let Err(cause) = send(&self.input, &request).await {
            self.pending.lock().await.remove(&id);
            return Err(cause);
        }
        let response = receiver
            .await
            .map_err(|_| error("音乐服务已断开，请重试"))?;
        if response["ok"] == true {
            Ok(response["value"].clone())
        } else {
            Err(error(
                response["error"]
                    .as_str()
                    .unwrap_or("音乐请求失败")
                    .chars()
                    .take(1000)
                    .collect::<String>(),
            ))
        }
    }
    pub async fn stop(&self) {
        self.reader.abort();
        self.pending.lock().await.clear();
        let _ = self.input.lock().await.shutdown().await;
        let mut child = self.child.lock().await;
        if tokio::time::timeout(Duration::from_secs(4), child.wait())
            .await
            .is_err()
        {
            let _ = child.kill().await;
        }
    }
    pub fn available(&self) -> bool {
        !self.reader.is_finished()
    }
}
impl Drop for Host {
    fn drop(&mut self) {
        self.reader.abort();
    }
}
async fn host_call(
    app: &tauri::AppHandle,
    state: &MusicState,
    input: &Arc<Mutex<ChildStdin>>,
    response: &Value,
) -> Result<()> {
    let ticket = response["id"]
        .as_str()
        .filter(|v| uuid::Uuid::parse_str(v).is_ok())
        .ok_or_else(|| error("音乐桌面请求身份无效"))?;
    let payload = response["payload"]
        .as_str()
        .filter(|v| v.len() <= 4 * 1024 * 1024)
        .ok_or_else(|| error("音乐桌面请求过大"))?;
    let value = match response["action"].as_str() {
        Some("open") => {
            use tauri_plugin_opener::OpenerExt;
            let url = reqwest::Url::parse(payload).map_err(|_| error("音乐授权地址无效"))?;
            if url.scheme() != "https"
                || url.host_str() != Some("accounts.spotify.com")
                || !url.username().is_empty()
                || url.password().is_some()
            {
                Err(error("音乐授权地址未开放"))
            } else {
                app.opener()
                    .open_url(url.as_str(), None::<&str>)
                    .map_err(|_| error("无法打开音乐授权页面"))
                    .map(|_| Value::Null)
            }
        }
        Some("sandbox") => sandbox::evaluate(app, state, payload).await,
        _ => Err(error("音乐桌面能力未开放")),
    };
    send(input,&json!({"type":"host-reply","id":ticket,"ok":value.is_ok(),"value":value.unwrap_or(Value::Null)})).await
}
async fn send(input: &Arc<Mutex<ChildStdin>>, value: &Value) -> Result<()> {
    let mut bytes = serde_json::to_vec(value).map_err(|_| error("音乐请求无法编码"))?;
    if bytes.len() > 5 * 1024 * 1024 {
        return Err(error("音乐请求超过上限"));
    }
    bytes.push(b'\n');
    let mut writer = input.lock().await;
    writer.write_all(&bytes).await.map_err(io_error)?;
    writer.flush().await.map_err(io_error)
}
