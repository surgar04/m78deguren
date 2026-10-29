//! 识别规则集中维护。名称只是候选，必须再检查 PE、目录结构及区服证据。
use serde::Serialize;
#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: &'static str,
    pub name: &'static str,
    pub executables: &'static [&'static str],
    pub directories: &'static [&'static str],
    pub launchers: &'static [&'static str],
}
pub const PROFILES: &[Profile] = &[
    Profile {
        id: "genshin",
        name: "原神",
        executables: &["YuanShen.exe", "GenshinImpact.exe"],
        directories: &["Genshin Impact Game", "YuanShen", "原神"],
        launchers: &[],
    },
    Profile {
        id: "honkai3",
        name: "崩坏3",
        executables: &["BH3.exe"],
        directories: &[
            "Honkai Impact 3rd",
            "Honkai Impact 3",
            "Honkai Impact 3rd glb",
            "崩坏3",
        ],
        launchers: &[],
    },
    Profile {
        id: "starrail",
        name: "崩坏：星穹铁道",
        executables: &["StarRail.exe"],
        directories: &[
            "Star Rail Games",
            "Star Rail",
            "崩坏：星穹铁道",
            "崩坏星穹铁道",
        ],
        launchers: &[],
    },
    Profile {
        id: "arknights",
        name: "明日方舟",
        executables: &["Arknights.exe"],
        directories: &[
            "Arknights Game",
            "Arknights_EN",
            "Arknights_JP",
            "Arknights_KR",
            "Arknights_TC",
            "Arknights",
            "明日方舟",
        ],
        launchers: &[],
    },
    Profile {
        id: "endfield",
        name: "明日方舟：终末地",
        executables: &["Endfield.exe"],
        directories: &[
            "Endfield Game",
            "EndField Game",
            "Arknights Endfield",
            "Endfield",
            "终末地",
        ],
        launchers: &["Hypergryph Launcher.exe", "GRYPHLINK.exe", "HGLauncher.exe"],
    },
    Profile {
        id: "deltaforce",
        name: "三角洲行动",
        executables: &["DeltaForceClient-Win64-Shipping.exe"],
        directories: &["Delta Force", "DeltaForce", "三角洲行动"],
        launchers: &[
            "DeltaForceLauncher.exe",
            "TCLS/Client.exe",
            "Client/TCLS/Client.exe",
        ],
    },
    Profile {
        id: "nte",
        name: "异环",
        executables: &["HTGame.exe", "NTEGame.exe", "NTEGlobalGame.exe"],
        directories: &["Neverness To Everness", "NTEGlobal", "NTE", "异环"],
        launchers: &["NTEGlobalLauncher.exe", "NTELauncher.exe"],
    },
    Profile {
        id: "wuthering",
        name: "鸣潮",
        executables: &["Wuthering Waves.exe", "Client-Win64-Shipping.exe"],
        directories: &["Wuthering Waves Game", "Wuthering Waves", "鸣潮"],
        launchers: &["launcher.exe", "launcher_main.exe"],
    },
];
pub fn by_id(id: &str) -> Option<&'static Profile> {
    PROFILES.iter().find(|profile| profile.id == id)
}
pub fn steam_family(id: u32, name: &str) -> Option<&'static Profile> {
    let known = match id {
        1671200 => Some("honkai3"),
        2507950 => Some("deltaforce"),
        3513350 => Some("wuthering"),
        4732690 => Some("endfield"),
        4508340 => Some("nte"),
        _ => None,
    };
    if let Some(id) = known {
        return by_id(id);
    }
    let name = name.to_lowercase();
    for (needle, id) in [
        ("endfield", "endfield"),
        ("终末地", "endfield"),
        ("genshin", "genshin"),
        ("原神", "genshin"),
        ("honkai impact", "honkai3"),
        ("崩坏3", "honkai3"),
        ("star rail", "starrail"),
        ("星穹铁道", "starrail"),
        ("arknights", "arknights"),
        ("明日方舟", "arknights"),
        ("delta force", "deltaforce"),
        ("三角洲", "deltaforce"),
        ("neverness", "nte"),
        ("异环", "nte"),
        ("wuthering", "wuthering"),
        ("鸣潮", "wuthering"),
    ] {
        if name.contains(needle) {
            return by_id(id);
        }
    }
    None
}
pub fn by_exe(name: &str) -> Option<&'static Profile> {
    PROFILES.iter().find(|profile| {
        profile
            .executables
            .iter()
            .any(|candidate| candidate.eq_ignore_ascii_case(name))
    })
}
