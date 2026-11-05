//! 示例只操作自身计数，不访问系统或用户文件。
use zhenjing_plugin_sdk::{Guest, bindings, call, json, parse, view};
struct Counter;
impl Guest for Counter {
    fn invoke(command: String, input: String) -> Result<String, String> {
        // 示例数据格式不变，正式迁移在此通过 storage 能力转换私有副本。
        if command == "migrate" {
            let input = parse(&input)?;
            let to = input["to"]
                .as_u64()
                .filter(|v| *v > 0)
                .ok_or("无效迁移版本")?;
            return Ok(json!({"dataVersion":to}).to_string());
        }
        let count = call("storage.get", json!({"key":"counter"}))?
            .as_u64()
            .unwrap_or(0);
        if command == "increment" {
            call(
                "storage.put",
                json!({"key":"counter","value":count.saturating_add(1)}),
            )?;
        }
        view(
            json!({"type":"stack","children":[{"type":"heading","text":"Rust 插件"},{"type":"metric","text":"私有计数","value":count.to_string()},{"type":"button","text":"增加计数","command":"increment"}]}),
        )
    }
}
bindings::export!(Counter with_types_in bindings);
