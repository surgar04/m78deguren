//! 固定产品目录不是模拟数据；执行结果全部由对应服务即时获取。
use serde::Serialize;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolEntry {
    pub id: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    pub aliases: Vec<&'static str>,
    pub category: &'static str,
    pub icon: &'static str,
    pub tone: &'static str,
    pub origin: &'static str,
    pub details: Vec<&'static str>,
}

#[derive(Serialize)]
pub struct ToolCatalog {
    pub source: &'static str,
    pub tools: Vec<ToolEntry>,
    pub external: ToolEntry,
}

pub fn catalog() -> ToolCatalog {
    let definitions = [
        (
            "game-acceleration",
            "游戏加速",
            "通过 QuickFox 官方客户端准备国服游戏线路，确认后启动本机游戏。",
            "network",
            "wifi",
            "mint",
            vec!["QuickFox", "回国", "马来西亚", "国服", "三角洲", "游戏加速"],
        ),
        (
            "crosshair",
            "辅助准心",
            "自定义屏幕准心样式与显示设置，提升游戏瞄准体验。",
            "gaming",
            "crosshair",
            "mint",
            vec!["crosshair", "准星", "屏幕叠加"],
        ),
        (
            "screen-test",
            "屏幕测试",
            "提供多种测试图案，检测屏幕显示效果与坏点情况。",
            "gaming",
            "display",
            "blue",
            vec!["display", "monitor", "坏点", "显示器", "屏幕"],
        ),
        (
            "recordings",
            "录屏管理",
            "浏览和管理已录制的游戏视频，支持预览、重命名与删除。",
            "gaming",
            "film",
            "violet",
            vec!["video", "recording", "视频", "录像", "录屏"],
        ),
        (
            "downloads",
            "下载加速",
            "管理下载任务，支持多线程加速下载游戏或文件。",
            "network",
            "download",
            "mint",
            vec!["download", "URL", "下载", "链接", "多连接"],
        ),
        (
            "speed-test",
            "网络测速",
            "测试当前网络连接的延迟、上传与下载速度。",
            "network",
            "wifi",
            "blue",
            vec!["speed", "ping", "网络", "测速", "延迟"],
        ),
        (
            "time-sync",
            "时间同步",
            "查询系统时间与标准时间的偏差，便于进行时间同步。",
            "network",
            "clock",
            "violet",
            vec!["NTP", "time", "校时", "时钟", "同步"],
        ),
        (
            "runtimes",
            "运行库修复",
            "检测常用运行库组件是否完整，为游戏安装前做好环境检查。",
            "maintenance",
            "runtime",
            "orange",
            vec!["runtime", "VC++", ".NET", "DirectX", "组件"],
        ),
        (
            "crash-logs",
            "蓝屏日志",
            "查看系统事件与蓝屏转储文件的关键信息，辅助定位问题原因。",
            "maintenance",
            "log",
            "rose",
            vec!["BSOD", "BugCheck", "Minidump", "崩溃", "转储"],
        ),
        (
            "display-filter",
            "屏幕滤镜",
            "管理显示器颜色、Gamma、预设与 ICC 校准。",
            "gaming",
            "palette",
            "mint",
            vec!["色温", "饱和度", "ICC", "Gamma", "滤镜"],
        ),
        (
            "overlay-panel",
            "统一 HUD",
            "终末地风格 HUD：系统方案、媒体与下载轮播，游戏时显示真实性能数据。",
            "gaming",
            "chart",
            "blue",
            vec!["FPS", "1% Low", "监控", "OSD", "性能"],
        ),
        (
            "resolution-converter",
            "分辨率转换",
            "计算画幅比例，验证并切换显示模式，超时自动恢复。",
            "gaming",
            "display",
            "violet",
            vec!["分辨率", "刷新率", "宽高比", "Hz"],
        ),
        (
            "dlss-preset",
            "DLSS 预设",
            "管理三角洲行动的 NVIDIA DLSS 模型与性能模式。",
            "gaming",
            "gpu",
            "blue",
            vec!["DLSS", "DLAA", "三角洲", "RTX"],
        ),
        (
            "audio-eq",
            "音频均衡器",
            "多频段 EQ、五种音效、设备路由与虚拟音频驱动。",
            "gaming",
            "audio",
            "violet",
            vec!["EQ", "音效", "音频", "FxSound", "FAC"],
        ),
        (
            "autoclicker",
            "鼠标连点器",
            "配置点击按键、间隔与热键，Esc 紧急停止。",
            "gaming",
            "mouse",
            "mint",
            vec!["连点", "鼠标", "CPS", "热键"],
        ),
        (
            "nvidia-driver-download",
            "NVIDIA 驱动下载",
            "查询官方历史版本，分别浏览桌面和笔记本驱动。",
            "network",
            "download",
            "blue",
            vec!["NVIDIA", "驱动", "Game Ready", "历史版本"],
        ),
        (
            "gpu-rename",
            "显卡名称管理",
            "改写 Windows 显卡显示名称，保存原值并支持恢复。",
            "maintenance",
            "gpu",
            "blue",
            vec!["GPU", "显卡", "名称", "驱动重启"],
        ),
        (
            "disk-health",
            "磁盘健康",
            "读取真实存储可靠性信息，执行 TRIM 或机械盘优化。",
            "maintenance",
            "drive",
            "mint",
            vec!["SMART", "SSD", "HDD", "TRIM", "磁盘"],
        ),
        (
            "nvidia-driver",
            "NVIDIA 3D 设置",
            "管理 45 项全局驱动设置，按实际驱动校验支持能力。",
            "maintenance",
            "sliders",
            "violet",
            vec!["NVIDIA", "3D", "垂直同步", "G-SYNC", "驱动设置"],
        ),
        (
            "vtx-virtualization",
            "虚拟化安全",
            "检查 VBS、内存完整性及 Hyper-V 启动配置。",
            "maintenance",
            "shield",
            "blue",
            vec!["VT-X", "VBS", "Hyper-V", "内存完整性", "虚拟化"],
        ),
        (
            "hidden-features",
            "Windows 隐藏功能",
            "查询和管理 Runtime、Boot 实验功能覆盖与恢复。",
            "maintenance",
            "sliders",
            "violet",
            vec!["ViVe", "Velocity", "隐藏功能", "实验", "特性"],
        ),
        (
            "context-menu",
            "右键菜单管理",
            "管理右键菜单、此电脑条目及盘符可见性。",
            "maintenance",
            "menu",
            "mint",
            vec!["右键", "菜单", "此电脑", "盘符", "命名空间"],
        ),
        (
            "vac-repair",
            "VAC 环境修复",
            "检查并修复 Steam 服务、网络服务及相关本地配置。",
            "maintenance",
            "shield",
            "orange",
            vec!["VAC", "Steam", "服务", "反作弊"],
        ),
        (
            "app-manager",
            "应用管理",
            "读取已安装应用，搜索、排序、定位和启动卸载流程。",
            "maintenance",
            "apps",
            "rose",
            vec!["软件", "应用", "卸载", "程序"],
        ),
    ];
    ToolCatalog {
        source: "native",
        tools: definitions
            .into_iter()
            .map(
                |(id, name, description, category, icon, tone, aliases)| ToolEntry {
                    id,
                    name,
                    description,
                    category,
                    icon,
                    tone,
                    aliases,
                    origin: "builtin",
                    details: Vec::new(),
                },
            )
            .collect(),
        external: ToolEntry {
            id: "external-tools",
            name: "外部工具库",
            description: "收录实用的第三方游戏工具，提供官方来源与说明。",
            category: "maintenance",
            icon: "box",
            tone: "blue",
            origin: "third-party",
            aliases: vec!["第三方", "external", "工具库"],
            details: Vec::new(),
        },
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalTool {
    pub id: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    pub website: &'static str,
}

pub fn external_catalog() -> Vec<ExternalTool> {
    vec![
        ExternalTool {
            id: "obs",
            name: "OBS Studio",
            description: "开源录制与直播工具",
            website: "https://obsproject.com/download",
        },
        ExternalTool {
            id: "cpu-z",
            name: "CPU-Z",
            description: "处理器、主板与内存信息",
            website: "https://www.cpuid.com/softwares/cpu-z.html",
        },
        ExternalTool {
            id: "gpu-z",
            name: "GPU-Z",
            description: "显卡信息与传感器",
            website: "https://www.techpowerup.com/gpuz/",
        },
        ExternalTool {
            id: "hwinfo",
            name: "HWiNFO",
            description: "硬件信息与传感器监测",
            website: "https://www.hwinfo.com/download/",
        },
        ExternalTool {
            id: "crystaldiskinfo",
            name: "CrystalDiskInfo",
            description: "磁盘健康与SMART信息",
            website: "https://crystalmark.info/en/software/crystaldiskinfo/",
        },
        ExternalTool {
            id: "steampp",
            name: "Watt Toolkit",
            description: "游戏平台网络与账号辅助工具",
            website: "https://steampp.net/",
        },
    ]
}
