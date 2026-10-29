//! 扩展内置工具入口。先由枚举收窄能力，再调用固定 Windows 适配器；不接收任意命令。
use super::{Result, ToolsState, platform};
use serde::Deserialize;
use std::time::Duration;

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SystemQuery {
    Apps,
    Gpus,
    Virtualization,
    Disks,
    Context,
    Vac,
    Displays,
    Nvidia,
    Dlss,
    FeaturesRuntime,
    FeaturesBoot,
}

impl SystemQuery {
    fn operation(self) -> &'static str {
        match self {
            Self::Apps => "apps",
            Self::Gpus => "gpus",
            Self::Virtualization => "virtualization",
            Self::Disks => "disks",
            Self::Context => "context",
            Self::Vac => "vac-status",
            Self::Displays => "displays",
            Self::Nvidia => "nvidia",
            Self::Dlss => "dlss",
            Self::FeaturesRuntime => "features-runtime",
            Self::FeaturesBoot => "features-boot",
        }
    }
}

pub async fn query(state: &ToolsState, tool: SystemQuery) -> Result<serde_json::Value> {
    let mut value = platform::run_system(
        &state.root,
        tool.operation(),
        &[state.root.join("changes").to_string_lossy().into_owned()],
        Duration::from_secs(60),
    )
    .await?;
    if matches!(
        tool,
        SystemQuery::FeaturesRuntime | SystemQuery::FeaturesBoot
    ) {
        let dictionary = super::remote::dictionary(&state.root).await?;
        value["dictionary"] =
            serde_json::to_value(dictionary).map_err(|_| super::error("功能名称字典无效"))?;
    }
    Ok(value)
}
