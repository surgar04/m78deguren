use super::{MusicState, catalog};
use crate::services::tools::{Result, error, io_error};
use serde_json::{Value, json};
use std::io::{Read, Seek, SeekFrom};
use tauri::{
    Manager,
    http::{Method, Request, Response},
};

fn origin(request: &Request<Vec<u8>>) -> Result<&str> {
    let value = request
        .headers()
        .get("Origin")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("http://tauri.localhost");
    if !matches!(
        value,
        "http://tauri.localhost"
            | "http://127.0.0.1:1420"
            | "http://localhost:1420"
            | "http://zhenjing-music.localhost"
    ) {
        return Err(error("音乐请求来源未开放"));
    }
    Ok(value)
}
fn reply(code: u16, mime: &str, body: Vec<u8>) -> Result<Response<Vec<u8>>> {
    Response::builder()
        .status(code)
        .header("Content-Type", mime)
        .header("X-Content-Type-Options", "nosniff")
        .header("Cache-Control", "no-store")
        .body(body)
        .map_err(|_| error("音乐响应无法编码"))
}
pub async fn respond(
    app: &tauri::AppHandle,
    label: &str,
    request: Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    let allowed = origin(&request).map(str::to_owned);
    let outcome = async {
        let state = app.state::<MusicState>();
        let path = request.uri().path();
        if label == "music-sandbox" {
            if path == "/sandbox" && request.method() == Method::GET {
                let mut response = reply(200, "text/html;charset=utf-8", b"<!doctype html><html><head><meta charset=utf-8></head><body><script nonce=zj-owned>fetch('/sandbox-ready',{method:'POST'});</script></body></html>".to_vec())?;
                response.headers_mut().insert("Content-Security-Policy", tauri::http::HeaderValue::from_static("default-src 'none'; script-src 'nonce-zj-owned' 'unsafe-eval'; connect-src http://zhenjing-music.localhost; frame-src 'none'; base-uri 'none'; form-action 'none'"));
                return Ok(response);
            }
            if path == "/sandbox-ready" && request.method() == Method::POST { state.sandbox_ready.notify_one(); return reply(204, "text/plain", vec![]); }
            if let Some(ticket) = path.strip_prefix("/sandbox-result/") && request.method() == Method::POST && request.body().len() <= 5 * 1024 * 1024 {
                let value = serde_json::from_slice(request.body()).map_err(|_| error("脚本结果无效"))?;
                if let Some(sender) = state.sandbox_results.lock().await.remove(ticket) { let _ = sender.send(value); return reply(204, "text/plain", vec![]); }
            }
            return Err(error("脚本沙箱请求未开放"));
        }
        if label != "main" { return Err(error("辅助窗口没有音乐数据权限")); }
        allowed.as_ref().map_err(|_| error("音乐请求来源未开放"))?;
        if request.method() == Method::OPTIONS {
            let mut response = reply(204, "text/plain", vec![])?;
            response.headers_mut().insert("Access-Control-Allow-Methods", tauri::http::HeaderValue::from_static("GET,HEAD,POST,OPTIONS"));
            response.headers_mut().insert("Access-Control-Allow-Headers", tauri::http::HeaderValue::from_static("Content-Type,Range,X-QQ-Session"));
            return Ok(response);
        }
        if let Some(id)=path.strip_prefix("/embed/") {
            uuid::Uuid::parse_str(id).map_err(|_|error("背景网页票据无效"))?;
            let url=state.embeds.lock().await.get(id).cloned().ok_or_else(||error("背景网页尚未登记"))?;
            let target=reqwest::Url::parse(&url).map_err(|_|error("背景网页地址无效"))?;
            let escaped=url.replace('&',"&amp;").replace('"',"&quot;").replace('<',"&lt;").replace('>',"&gt;");
            let html=format!("<!doctype html><html><head><meta charset=utf-8></head><body style=\"margin:0;overflow:hidden\"><iframe src=\"{escaped}\" sandbox=\"allow-scripts\" style=\"position:fixed;inset:0;width:100%;height:100%;border:0\"></iframe></body></html>");
            let mut response=reply(200,"text/html;charset=utf-8",html.into_bytes())?;
            let csp=format!("default-src 'none'; style-src 'unsafe-inline'; frame-src {}; base-uri 'none'; form-action 'none'",target.origin().ascii_serialization());
            response.headers_mut().insert("Content-Security-Policy",tauri::http::HeaderValue::from_str(&csp).map_err(|_|error("背景网页策略无效"))?);
            return Ok(response);
        }
        if let Some(api_path) = path.strip_prefix("/api/") {
            let (provider, endpoint) = api_path.split_once('/').ok_or_else(|| error("音乐 API 路径无效"))?;
            if !matches!(provider, "qq"|"netease") || endpoint.len() > 100 || !endpoint.bytes().all(|b| b.is_ascii_alphanumeric() || b"/_-".contains(&b)) || !matches!(*request.method(), Method::GET|Method::POST) { return Err(error("音乐 API 请求未开放")); }
            let url = reqwest::Url::parse(&format!("https://music.internal{}", request.uri())).map_err(|_| error("音乐 API 参数无效"))?;
            let mut params: serde_json::Map<String, Value> = url.query_pairs().map(|(key, value)| (key.into_owned(), Value::String(value.into_owned()))).collect();
            if request.method() == Method::POST && !request.body().is_empty() {
                if request.body().len() > 1048576 { return Err(error("音乐 API 请求体超过上限")); }
                let body: serde_json::Map<String, Value> = serde_json::from_slice(request.body()).map_err(|_| error("音乐 API 请求体不是对象"))?; params.extend(body);
            }
            let mut headers = serde_json::Map::new();
            if let Some(session) = request.headers().get("X-QQ-Session").and_then(|v| v.to_str().ok()).filter(|v| v.len() < 65536) { headers.insert("x-qq-session".into(), json!(session)); }
            let response = state.rpc(app, json!({"operation":"api","provider":provider,"path":format!("/{endpoint}"),"method":request.method().as_str(),"params":params,"headers":headers})).await?;
            return reply(response["status"].as_u64().filter(|v| (100..=599).contains(v)).unwrap_or(502) as u16, "application/json;charset=utf-8", response["body"].as_str().unwrap_or("{}").as_bytes().to_vec());
        }
        if !matches!(*request.method(), Method::GET|Method::HEAD) { return Err(error("音乐资源只允许读取")); }
        let head = request.method() == Method::HEAD;
        if let Some(id) = path.strip_prefix("/local/").or_else(|| path.strip_prefix("/cover/")) {
            let _permit=state.slots.acquire().await.map_err(|_|error("音乐读取服务已停止"))?;
            uuid::Uuid::parse_str(id).map_err(|_| error("本地音乐资源身份无效"))?;
            let cover = path.starts_with("/cover/");
            let file = if cover { state.root.join("covers").join(if request.uri().query()==Some("matched=1"){format!("{id}.matched")}else{id.to_owned()}) } else { state.catalog.lock().await.entries.get(id).ok_or_else(|| error("歌曲不在本地库中"))?.path.clone() };
            let range = request.headers().get("Range").and_then(|v| v.to_str().ok()).map(str::to_owned);
            return tauri::async_runtime::spawn_blocking(move || {
                catalog::read_path(&file)?;
                let mut reader = std::fs::File::open(&file).map_err(io_error)?;
                let total = reader.metadata().map_err(io_error)?.len();
                let (start, end) = crate::services::tools::recordings::parse_range(range.as_deref(), total)?;
                let length = if total == 0 { 0 } else { end - start + 1 };
                let mut bytes = Vec::new(); if !head { reader.seek(SeekFrom::Start(start)).map_err(io_error)?; reader.take(length).read_to_end(&mut bytes).map_err(io_error)?; }
                let extension = file.extension().and_then(|v| v.to_str()).unwrap_or("").to_ascii_lowercase();
                let mime = if cover { if bytes.starts_with(b"\x89PNG") { "image/png" } else if bytes.starts_with(b"RIFF") { "image/webp" } else { "image/jpeg" } } else { match extension.as_str() { "flac"=>"audio/flac", "wav"=>"audio/wav", "ogg"|"opus"=>"audio/ogg", "aac"=>"audio/aac", "m4a"|"alac"=>"audio/mp4", "aiff"|"aif"=>"audio/aiff", "wma"=>"audio/x-ms-wma", _=>"audio/mpeg" } };
                let partial = !cover && (range.is_some() || length < total);
                let mut builder = Response::builder().status(if partial {206} else {200}).header("Content-Type", mime).header("Content-Length", length).header("Accept-Ranges", "bytes").header("Cache-Control", "private,max-age=120");
                if partial { builder = builder.header("Content-Range", format!("bytes {start}-{end}/{total}")); }
                builder.body(bytes).map_err(|_| error("本地音乐响应无效"))
            }).await.map_err(|_| error("本地音乐读取任务失败"))?;
        }
        if let Some(id) = path.strip_prefix("/media/") {
            let _permit = state.slots.acquire().await.map_err(|_|error("音乐流已停止"))?;
            uuid::Uuid::parse_str(id).map_err(|_| error("音乐媒体身份无效"))?;
            let (port, secret) = state.endpoint.lock().await.clone().ok_or_else(|| error("音乐服务未启动"))?;
            let mut upstream = state.http.request(if head {reqwest::Method::HEAD} else {reqwest::Method::GET}, format!("http://127.0.0.1:{port}/media/{id}")).bearer_auth(secret);
            if let Some(range) = request.headers().get("Range").and_then(|v| v.to_str().ok()) {
                if range.len() > 100 || range.contains(',') || !range.starts_with("bytes=") { return Err(error("音乐范围无效")); }
                upstream = upstream.header("Range", range);
            }
            let mut response = upstream.send().await.map_err(|_| error("音乐资源读取失败"))?;
            let mut builder = Response::builder().status(response.status().as_u16());
            for name in ["content-type", "content-length", "content-range", "accept-ranges", "cache-control"] { if let Some(value) = response.headers().get(name) { builder = builder.header(name, value); } }
            let mut body = Vec::new();
            if !head { while let Some(chunk) = response.chunk().await.map_err(|_| error("音乐资源中断"))? { if body.len() + chunk.len() > 16 * 1024 * 1024 { return Err(error("平台未提供可分段读取的音源")); } body.extend_from_slice(&chunk); } }
            return builder.body(body).map_err(|_| error("音乐媒体响应无效"));
        }
        Err(error("音乐资源不存在"))
    }.await;
    let mut response = outcome.unwrap_or_else(|_| {
        Response::builder()
            .status(400)
            .body(Vec::new())
            .unwrap_or_default()
    });
    if let Ok(origin) = allowed
        && let Ok(value) = tauri::http::HeaderValue::from_str(&origin)
    {
        response
            .headers_mut()
            .insert("Access-Control-Allow-Origin", value);
    }
    response.headers_mut().insert(
        "Access-Control-Expose-Headers",
        tauri::http::HeaderValue::from_static("Content-Length,Content-Range,Accept-Ranges"),
    );
    response.headers_mut().insert(
        "Access-Control-Allow-Credentials",
        tauri::http::HeaderValue::from_static("true"),
    );
    response
}
