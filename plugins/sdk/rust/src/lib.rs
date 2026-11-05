//! 臻境 Rust 插件 SDK。WIT 是跨语言 ABI 的唯一来源，调用结果由插件按业务类型再次解析。
pub mod bindings {
    wit_bindgen::generate!({ path: "../../wit", world: "plugin", pub_export_macro: true });
}
pub use bindings::exports::zhenjing::plugin::lifecycle::Guest;
pub use serde_json::{Value, json};
/// 输入始终是不可信 JSON；应用层应继续逐字段检查业务类型。
pub fn parse(input: &str) -> Result<Value, String> {
    serde_json::from_str(input).map_err(|_| "JSON 输入无效".to_owned())
}
pub fn call(method: &str, params: Value) -> Result<Value, String> {
    let input = serde_json::to_string(&json!({"method":method,"params":params}))
        .map_err(|_| "请求编码失败".to_owned())?;
    if input.len() > 1024 * 1024 {
        return Err("请求超过上限".to_owned());
    }
    let response = bindings::zhenjing::plugin::capabilities::call(&input)?;
    serde_json::from_str(&response).map_err(|_| "宿主响应无效".to_owned())
}
pub fn view(value: Value) -> Result<String, String> {
    serde_json::to_string(&value).map_err(|_| "界面编码失败".to_owned())
}
