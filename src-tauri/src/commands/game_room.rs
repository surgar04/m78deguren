//! 中间页能力边界独立于主窗口；官方扫码及其他远程网页不获授任何此处命令。
use crate::{
    error::AppError,
    services::{
        game_room::{GameRoomState, Preferences, community},
        tools::{Result, error},
    },
};
use serde::Deserialize;
use serde_json::{Value, json};
use tauri::Manager;

#[derive(Deserialize)]
#[serde(tag = "operation", rename_all = "kebab-case", deny_unknown_fields)]
pub enum Request {
    Snapshot {},
    Open {},
    Telemetry {},
    Configure {
        preferences: Preferences,
    },
    Categories {},
    Weapons {
        category: u32,
    },
    Loadouts {
        category: Option<u32>,
        weapon: String,
        search: String,
        page: u32,
    },
    Like {
        id: u64,
    },
    Report {
        id: u64,
        consent: bool,
    },
    Submit {
        category: u32,
        weapon: String,
        code: String,
        cost: u64,
        description: String,
        author: String,
        consent: bool,
    },
    Passwords {},
    Streamers {
        refresh: bool,
    },
    Link {
        key: String,
    },
    Stats {},
    AuthOpen {},
    AuthCancel {},
    Logout {
        consent: bool,
    },
    Refresh {},
    Season {
        sid: String,
        queue: String,
    },
    Detail {
        room_id: String,
        start_time: String,
        queue: String,
    },
    Dictionaries {},
    Asset {
        url: String,
    },
    StickyRestore {
        consent: bool,
    },
}
fn validate_queue(queue: &str) -> Result<()> {
    if !["sol", "tdm"].contains(&queue) {
        return Err(error("战绩模式无效"));
    }
    Ok(())
}
pub fn allowed(label: &str) -> bool {
    matches!(label, "main" | "game-room")
}
#[tauri::command]
pub async fn game_room_execute(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, GameRoomState>,
    request: Request,
) -> std::result::Result<Value, AppError> {
    if !allowed(window.label()) {
        return Err(error("当前窗口没有游戏空间权限"));
    }
    let app = window.app_handle();
    match request {
        Request::Asset { url } => state.asset(&url).await,
        Request::Snapshot {} => {
            let mut value = state.snapshot().await?;
            value["protectionMessage"] = json!(if crate::storage_policy::restricted_to_d() {
                "开发验收环境：粘滞键保护仅检测，不执行系统修改".to_owned()
            } else {
                app.state::<crate::services::home::HomeState>()
                    .status
                    .read()
                    .await
                    .message
                    .clone()
            });
            Ok(value)
        }
        Request::Open {} => {
            state.show(app).await?;
            Ok(Value::Null)
        }
        Request::Telemetry {} => state.telemetry(app).await,
        Request::Configure { preferences } => state.configure(app, preferences).await,
        Request::Categories {} => state.community("/api/categories", None).await,
        Request::Weapons { category } => {
            if category == 0 || category > 10000 {
                return Err(error("武器分类无效"));
            }
            state
                .community(&format!("/api/weapons/{category}"), None)
                .await
        }
        Request::Loadouts {
            category,
            weapon,
            search,
            page,
        } => {
            if page == 0
                || page > 10000
                || category.is_some_and(|v| v == 0 || v > 10000)
                || !community::text_valid(&weapon, 100)
                || !community::text_valid(&search, 120)
            {
                return Err(error("改枪码筛选条件超出范围"));
            }
            let mut url = reqwest::Url::parse("https://df.nexbox.top/api/loadouts")
                .map_err(|_| error("社区地址配置无效"))?;
            {
                let mut query = url.query_pairs_mut();
                query.append_pair("page", &page.to_string());
                if let Some(id) = category {
                    query.append_pair("category_id", &id.to_string());
                }
                if !weapon.is_empty() {
                    query.append_pair("weapon_name", &weapon);
                }
                if !search.trim().is_empty() {
                    query.append_pair("search", search.trim());
                }
            }
            state
                .community(
                    &format!("{}?{}", url.path(), url.query().unwrap_or_default()),
                    None,
                )
                .await
        }
        Request::Like { id } => state.reaction(id, false).await,
        Request::Report { id, consent } => {
            if !consent {
                return Err(error("请确认报告该改枪码不可用"));
            }
            state.reaction(id, true).await
        }
        Request::Submit {
            category,
            weapon,
            code,
            cost,
            description,
            author,
            consent,
        } => {
            if !consent
                || category == 0
                || category > 10000
                || weapon.trim().is_empty()
                || code.trim().is_empty()
                || cost == 0
                || cost > 10_000_000_000
                || !community::text_valid(&weapon, 100)
                || !community::text_valid(&code, 300)
                || !community::text_valid(&description, 2000)
                || !community::text_valid(&author, 80)
            {
                return Err(error(
                    "投稿字段无效，请检查分类、武器、费用与改枪码，并确认提交审核",
                ));
            }
            state.community("/api/loadouts",Some(json!({"category_id":category,"weapon_name":weapon.trim(),"code":code.trim(),"cost":cost,"description":description.trim(),"author":if author.trim().is_empty(){"匿名"}else{author.trim()}}))).await
        }
        Request::Passwords {} => match crate::services::tools::remote::delta_passwords(
            &app.state::<crate::services::tools::ToolsState>(),
        )
        .await
        {
            Ok(value) => serde_json::to_value(value).map_err(|_| error("每日密码编码失败")),
            Err(_) => community::backup_passwords(&state).await,
        },
        Request::Streamers { refresh } => state.streamers(refresh).await,
        Request::Link { key } => {
            community::open_link(app, &key).await?;
            Ok(Value::Null)
        }
        Request::Stats {} => Ok(state.wegame.snapshot().await),
        Request::AuthOpen {} => {
            state.wegame.login(app).await?;
            Ok(Value::Null)
        }
        Request::AuthCancel {} => {
            state.wegame.cancel(app).await?;
            Ok(Value::Null)
        }
        Request::Logout { consent } => {
            if !consent {
                return Err(error("请确认退出 WeGame 数据源并清除本机战绩缓存"));
            }
            state.wegame.logout(app).await?;
            Ok(Value::Null)
        }
        Request::Refresh {} => {
            state
                .wegame
                .collect(app, json!({"kind":"refresh"}), true)
                .await
        }
        Request::Season { sid, queue } => {
            validate_queue(&queue)?;
            if sid.is_empty() || sid.len() > 20 || !sid.bytes().all(|b| b.is_ascii_digit()) {
                return Err(error("赛季标识无效"));
            }
            state
                .wegame
                .collect(app, json!({"kind":"season","sid":sid,"queue":queue}), true)
                .await
        }
        Request::Detail {
            room_id,
            start_time,
            queue,
        } => {
            validate_queue(&queue)?;
            if room_id.is_empty()
                || !community::text_valid(&room_id, 128)
                || !community::text_valid(&start_time, 64)
            {
                return Err(error("对局标识无效"));
            }
            state
                .wegame
                .collect(
                    app,
                    json!({"kind":"detail","roomId":room_id,"startTime":start_time,"queue":queue}),
                    true,
                )
                .await
        }
        Request::Dictionaries {} => {
            let urls = [
                (
                    "agents",
                    "https://jsonschema.qpic.cn/f17859b917badfa9a083ad92c9eca90b/b965f0631cd937fde49b54fe0b709276/agentInfo",
                ),
                (
                    "maps",
                    "https://jsonschema.qpic.cn/f17859b917badfa9a083ad92c9eca90b/558596903da9c0e12df38eee20dcfc36/map",
                ),
                (
                    "skins",
                    "https://comm.ams.game.qq.com/ide/?instanceid=661959&sIdeFlow=xXpyy2&method=dfm/object.list&param=%7B%22primary%22%3A%22assets%22%7D",
                ),
            ];
            let mut out = json!({});
            for (key, url) in urls {
                let path = state.root.join(format!("dictionary-{key}.json"));
                if let Some(value) = community::read_cache(&path, 8_388_608).await {
                    out[key] = value;
                    continue;
                }
                let response = state
                    .http
                    .get(url)
                    .send()
                    .await
                    .map_err(|_| error("无法读取官方地图/干员/藏品字典"))?;
                let bytes = community::bounded(response, 8_000_000).await?;
                let value: Value =
                    serde_json::from_slice(&bytes).map_err(|_| error("官方字典格式不兼容"))?;
                crate::services::tools::save_json(&path, &value).await?;
                out[key] = value;
            }
            Ok(out)
        }
        Request::StickyRestore { consent } => {
            if !consent {
                return Err(error("请确认恢复原粘滞键设置"));
            }
            app.state::<crate::services::home::HomeState>()
                .restore_sticky(app)
                .await?;
            Ok(Value::Null)
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn remote_and_auxiliary_windows_cannot_call_game_commands() {
        assert!(allowed("main"));
        assert!(allowed("game-room"));
        assert!(!allowed("delta-wegame-auth"));
        assert!(!allowed("hud"));
        assert!(!allowed("delta-site-x"));
    }
    #[test]
    fn schemas_reject_arbitrary_endpoints_and_invalid_modes() {
        assert!(
            serde_json::from_value::<Request>(
                json!({"operation":"link","key":"map","url":"file:///C:/"})
            )
            .is_err()
        );
        assert!(validate_queue("sol").is_ok());
        assert!(validate_queue("tdm").is_ok());
        assert!(validate_queue("arbitrary").is_err());
    }
}
