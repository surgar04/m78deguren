//! 系统优化只接受目录 ID 与枚举目标；注册表目标永远来自编译期白名单。
use super::{Result, error, platform};
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, path::Path, time::Duration};

pub const CATALOG: &str = include_str!("windows/optimizer-catalog.json");

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Selection {
    pub id: String,
    pub value: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RegistryValue {
    pub exists: bool,
    pub kind: Option<String>,
    pub data: Option<String>,
    pub multi: Vec<String>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RegistryPreview {
    pub path: String,
    pub name: String,
    pub before: RegistryValue,
    pub after: RegistryValue,
    pub owners: Vec<String>,
}

#[derive(Deserialize)]
struct Catalog {
    items: Vec<Definition>,
}
#[derive(Deserialize)]
struct Definition {
    id: String,
    variants: Vec<Variant>,
}
#[derive(Deserialize)]
struct Variant {
    value: String,
}

pub fn validate(selections: &[Selection]) -> Result<()> {
    if selections.is_empty() || selections.len() > 201 {
        return Err(error("一次请选择 1–201 项优化配置"));
    }
    let catalog: Catalog = serde_json::from_str(CATALOG).map_err(|_| error("内置优化目录损坏"))?;
    let mut seen = HashSet::new();
    for selection in selections {
        if !seen.insert(&selection.id)
            || !catalog.items.iter().any(|item| {
                item.id == selection.id
                    && (selection.value == "restore"
                        || item
                            .variants
                            .iter()
                            .any(|variant| variant.value == selection.value))
            })
        {
            return Err(error("优化配置未知、重复或目标值不受支持"));
        }
    }
    Ok(())
}

pub fn catalog() -> Result<serde_json::Value> {
    serde_json::from_str(CATALOG).map_err(|_| error("内置优化目录损坏"))
}

pub async fn scan(root: &Path) -> Result<serde_json::Value> {
    platform::run_system(root, "optimizer-scan", &[], Duration::from_secs(90)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn complete_catalog_and_input_boundary() -> Result<()> {
        let value = catalog()?;
        let rows = value["items"]
            .as_array()
            .ok_or_else(|| error("目录不是数组"))?;
        assert_eq!(rows.len(), 201);
        let expected = [
            ("gaming", 20),
            ("gpu", 14),
            ("performance", 33),
            ("privacy", 56),
            ("ai", 9),
            ("services", 22),
            ("disk", 6),
            ("apps", 6),
            ("network", 19),
            ("explorer", 11),
            ("audio", 5),
        ];
        for (category, count) in expected {
            assert_eq!(
                rows.iter()
                    .filter(|row| row["category"] == category)
                    .count(),
                count
            );
        }
        assert!(validate(&[]).is_err());
        assert!(
            validate(&[Selection {
                id: "HKEY_LOCAL_MACHINE".into(),
                value: "apply".into()
            }])
            .is_err()
        );
        assert!(
            validate(&[Selection {
                id: "win32Priority".into(),
                value: "arbitrary".into()
            }])
            .is_err()
        );
        validate(&[Selection {
            id: "win32Priority".into(),
            value: "program".into(),
        }])?;
        validate(&[Selection {
            id: "disableUAC".into(),
            value: "restore".into(),
        }])?;
        assert!(
            validate(&[
                Selection {
                    id: "gameMode".into(),
                    value: "apply".into()
                },
                Selection {
                    id: "gameMode".into(),
                    value: "restore".into()
                }
            ])
            .is_err()
        );
        Ok(())
    }
}
