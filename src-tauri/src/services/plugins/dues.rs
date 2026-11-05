//! 第一方内置会费插件：由发布的 Rust 代码提供可信表格能力，不扩大第三方 Wasm 权限。
//! 金额始终使用整数分；成员同步与本地资料、缴费流水分离，避免远端刷新覆盖人工记录。
use super::{network::Network, storage};
use crate::services::tools::{Result, error, io_error};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeSet,
    path::{Path, PathBuf},
    sync::Arc,
};
use tokio::sync::Mutex;

pub const ID: &str = "org.zhenjing.builtin.group-dues";
const API: &str = "https://805vder84386.vicp.fun/api/v1/groups?wxid=25938509128%40chatroom";
const ORIGIN: &str = "https://805vder84386.vicp.fun";
const GROUP: &str = "25938509128@chatroom";
const MAX_STORE: usize = 16 * 1024 * 1024;
const MAX_AMOUNT: u32 = 100_000_000;

/// 双重门禁：调试构建、路由参数和前端偏好均不能代替经过认证的开发者发行身份。
pub fn visible() -> bool {
    cfg!(feature = "developer-edition") && crate::services::developer::enabled()
}
pub fn require_developer() -> Result<()> {
    if !visible() {
        return Err(error(
            "DUES_DEVELOPER_REQUIRED：此内置插件仅向认证后的开发者版本开放",
        ));
    }
    Ok(())
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Settings {
    pub monthly_cents: u32,
    pub annual_cents: u32,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Member {
    pub wxid: String,
    pub nickname: String,
    pub group_nickname: String,
    pub avatar_url: String,
    pub active: bool,
    /// None 表示使用同步资料；Some（包括空串）表示用户明确设置的本地覆盖值。
    pub local_nickname: Option<String>,
    pub local_group_nickname: Option<String>,
    pub remark: String,
}
#[derive(Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum PaymentKind {
    Monthly,
    Annual,
    Custom,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Payment {
    pub id: String,
    pub wxid: String,
    pub kind: PaymentKind,
    pub month: String,
    pub months: u32,
    pub amount_cents: u32,
    pub remark: String,
    pub recorded_at: String,
    pub voided_at: Option<String>,
    pub void_reason: Option<String>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Ledger {
    pub schema_version: u32,
    pub revision: u64,
    pub group_name: String,
    pub synced_at: Option<String>,
    pub source_updated_at: Option<String>,
    pub complete: bool,
    pub failed_profiles: u32,
    pub settings: Settings,
    pub members: Vec<Member>,
    pub payments: Vec<Payment>,
}
impl Default for Ledger {
    fn default() -> Self {
        Self {
            schema_version: 1,
            revision: 0,
            group_name: "群会费智能表格".into(),
            synced_at: None,
            source_updated_at: None,
            complete: false,
            failed_profiles: 0,
            settings: Settings::default(),
            members: Vec::new(),
            payments: Vec::new(),
        }
    }
}
#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "kebab-case", deny_unknown_fields)]
pub enum Request {
    Snapshot,
    Sync {
        revision: u64,
    },
    Settings {
        revision: u64,
        #[serde(rename = "monthlyCents")]
        monthly_cents: u32,
        #[serde(rename = "annualCents")]
        annual_cents: u32,
    },
    EditMember {
        revision: u64,
        wxid: String,
        nickname: Option<String>,
        #[serde(rename = "groupNickname")]
        group_nickname: Option<String>,
        remark: String,
    },
    Pay {
        revision: u64,
        wxids: Vec<String>,
        month: String,
        kind: PaymentKind,
        #[serde(rename = "amountCents")]
        amount_cents: Option<u32>,
        remark: String,
    },
    Void {
        revision: u64,
        id: String,
        reason: String,
    },
    Avatar {
        wxid: String,
    },
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApiMember {
    wxid: String,
    #[serde(default)]
    nickname: Option<String>,
    #[serde(default)]
    group_nickname: Option<String>,
    #[serde(default)]
    avatar_url: Option<String>,
}
#[derive(Deserialize)]
struct ApiGroup {
    wxid: String,
    name: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApiData {
    group: ApiGroup,
    members: Vec<ApiMember>,
    total: usize,
    complete: bool,
    failed_profiles: u32,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApiMeta {
    updated_at: Option<String>,
}
#[derive(Deserialize)]
struct ApiResponse {
    ok: bool,
    data: ApiData,
    meta: Option<ApiMeta>,
}

fn field(value: &str, max: usize) -> Result<()> {
    if value.len() > max || value.chars().any(|c| c.is_control() && c != '\n') {
        return Err(error("DUES_FIELD：文字无效或超过长度限制"));
    }
    Ok(())
}
fn identity(value: &str) -> Result<()> {
    field(value, 128)?;
    if value.is_empty() || value.chars().any(char::is_whitespace) {
        return Err(error("DUES_MEMBER：成员标识无效"));
    }
    Ok(())
}
/// 月份使用连续整数比较，正确处理十二月跨年；不依赖浮点数或本地时区的日期解析。
fn month_index(value: &str) -> Result<u32> {
    let bytes = value.as_bytes();
    if bytes.len() != 7
        || bytes[4] != b'-'
        || !bytes
            .iter()
            .enumerate()
            .all(|(i, b)| i == 4 || b.is_ascii_digit())
    {
        return Err(error("DUES_MONTH：月份必须为 YYYY-MM"));
    }
    let year = value[..4].parse::<u32>().map_err(|_| error("DUES_MONTH"))?;
    let month = value[5..].parse::<u32>().map_err(|_| error("DUES_MONTH"))?;
    if !(2000..=2199).contains(&year) || !(1..=12).contains(&month) {
        return Err(error("DUES_MONTH：月份超出支持范围"));
    }
    Ok(year * 12 + month - 1)
}
fn overlap(payment: &Payment, start: u32, months: u32) -> Result<bool> {
    let at = month_index(&payment.month)?;
    Ok(payment.voided_at.is_none() && start < at + payment.months && at < start + months)
}
fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}
fn validate(ledger: &Ledger) -> Result<()> {
    if ledger.schema_version != 1
        || ledger.members.len() > 5000
        || ledger.payments.len() > 100_000
        || ledger.settings.monthly_cents > MAX_AMOUNT
        || ledger.settings.annual_cents > MAX_AMOUNT
    {
        return Err(error("DUES_DATA：账本格式或容量无效，原文件已保留"));
    }
    field(&ledger.group_name, 512)?;
    let mut members = BTreeSet::new();
    for member in &ledger.members {
        identity(&member.wxid)?;
        if !members.insert(&member.wxid) {
            return Err(error("DUES_DATA：成员重复"));
        }
        for name in [&member.nickname, &member.group_nickname] {
            field(name, 512)?;
        }
        for name in [&member.local_nickname, &member.local_group_nickname]
            .into_iter()
            .flatten()
        {
            field(name, 512)?;
        }
        field(&member.remark, 2000)?;
        field(&member.avatar_url, 4096)?;
    }
    let mut payments = BTreeSet::new();
    let mut coverage = std::collections::BTreeMap::<&str, Vec<(u32, u32)>>::new();
    for payment in &ledger.payments {
        if uuid::Uuid::parse_str(&payment.id).is_err()
            || !payments.insert(&payment.id)
            || !members.contains(&payment.wxid)
            || payment.amount_cents == 0
            || payment.amount_cents > MAX_AMOUNT
            || payment.months
                != if payment.kind == PaymentKind::Annual {
                    12
                } else {
                    1
                }
            || payment.voided_at.is_some() != payment.void_reason.is_some()
        {
            return Err(error("DUES_DATA：缴费流水无效"));
        }
        let month = month_index(&payment.month)?;
        if month + payment.months > 2200 * 12
            || chrono::DateTime::parse_from_rfc3339(&payment.recorded_at).is_err()
        {
            return Err(error("DUES_DATA：缴费日期或覆盖范围无效"));
        }
        if payment.voided_at.is_none() {
            coverage
                .entry(&payment.wxid)
                .or_default()
                .push((month, month + payment.months));
        }
        field(&payment.remark, 2000)?;
        if let Some(reason) = &payment.void_reason {
            field(reason, 1000)?;
        }
    }
    for periods in coverage.values_mut() {
        periods.sort_unstable();
        if periods.windows(2).any(|pair| pair[0].1 > pair[1].0) {
            return Err(error("DUES_DATA：账本包含重复覆盖月份，已阻止继续写入"));
        }
    }
    if let Some(updated) = &ledger.source_updated_at {
        field(updated, 512)?;
    }
    Ok(())
}
fn load(path: &Path) -> Result<Ledger> {
    match std::fs::symlink_metadata(path) {
        Err(cause) if cause.kind() == std::io::ErrorKind::NotFound => Ok(Ledger::default()),
        Err(cause) => Err(io_error(cause)),
        Ok(_) => {
            let data = storage::read_bounded(path, MAX_STORE)?;
            let ledger: Ledger = serde_json::from_slice(&data)
                .map_err(|_| error("DUES_DATA：账本损坏，已阻止覆盖；请从备份恢复"))?;
            validate(&ledger)?;
            Ok(ledger)
        }
    }
}
/// 原子事务独立于认证入口，便于用真实磁盘验证备份、并发冲突和失败不落盘；生产调用先校验身份。
fn transact(
    path: &Path,
    revision: u64,
    work: impl FnOnce(&mut Ledger) -> Result<()>,
) -> Result<Ledger> {
    let mut ledger = load(path)?;
    if ledger.revision != revision {
        return Err(error(
            "DUES_CONFLICT：数据已变化，请刷新后重试；未覆盖其他窗口的修改",
        ));
    }
    work(&mut ledger)?;
    validate(&ledger)?;
    ledger.revision = ledger
        .revision
        .checked_add(1)
        .ok_or_else(|| error("DUES_REVISION"))?;
    let bytes = serde_json::to_vec(&ledger).map_err(|_| error("DUES_ENCODING"))?;
    if bytes.len() > MAX_STORE {
        return Err(error("DUES_QUOTA：账本已达到容量上限"));
    }
    if path.exists() {
        storage::atomic_write(
            &path.with_extension("backup.json"),
            &storage::read_bounded(path, MAX_STORE)?,
        )?;
    }
    storage::atomic_write(path, &bytes)?;
    Ok(ledger)
}
fn merge(ledger: &mut Ledger, response: ApiResponse) -> Result<()> {
    let data = response.data;
    if !response.ok
        || data.group.wxid != GROUP
        || data.members.len() > 5000
        || data.total < data.members.len()
        || (data.complete && data.total != data.members.len())
    {
        return Err(error(
            "DUES_API：群资料响应不完整或身份不匹配，原数据未修改",
        ));
    }
    field(&data.group.name, 512)?;
    let mut ids = BTreeSet::new();
    for row in &data.members {
        identity(&row.wxid)?;
        if !ids.insert(row.wxid.clone()) {
            return Err(error("DUES_API：响应包含重复成员，原数据未修改"));
        }
    }
    // 不完整同步只合并收到的成员；不能把网络遗漏误判成退群，更不能删除历史账目。
    if data.complete {
        for member in &mut ledger.members {
            member.active = ids.contains(&member.wxid);
        }
    }
    for row in data.members {
        let nickname = row.nickname.unwrap_or_default();
        let group_nickname = row.group_nickname.unwrap_or_default();
        let avatar_url = row.avatar_url.unwrap_or_default();
        if let Some(member) = ledger.members.iter_mut().find(|m| m.wxid == row.wxid) {
            // 空资料可能来自 failedProfiles；不覆盖此前已获取的有效资料。
            if !nickname.is_empty() {
                member.nickname = nickname;
            }
            if !group_nickname.is_empty() || data.failed_profiles == 0 {
                member.group_nickname = group_nickname;
            }
            if !avatar_url.is_empty() {
                member.avatar_url = avatar_url;
            }
            member.active = true;
        } else {
            ledger.members.push(Member {
                wxid: row.wxid,
                nickname,
                group_nickname,
                avatar_url,
                active: true,
                local_nickname: None,
                local_group_nickname: None,
                remark: String::new(),
            });
        }
    }
    ledger.group_name = data.group.name;
    ledger.complete = data.complete;
    ledger.failed_profiles = data.failed_profiles;
    ledger.synced_at = Some(now());
    ledger.source_updated_at = response.meta.and_then(|m| m.updated_at);
    validate(ledger)
}
fn pay(
    ledger: &mut Ledger,
    wxids: Vec<String>,
    month: String,
    kind: PaymentKind,
    amount: Option<u32>,
    remark: String,
) -> Result<()> {
    let start = month_index(&month)?;
    let months = if kind == PaymentKind::Annual { 12 } else { 1 };
    if start + months > 2200 * 12 {
        return Err(error("DUES_MONTH：缴费覆盖月份超出支持范围"));
    }
    let amount = amount.unwrap_or(match kind {
        PaymentKind::Monthly => ledger.settings.monthly_cents,
        PaymentKind::Annual => ledger.settings.annual_cents,
        PaymentKind::Custom => 0,
    });
    if amount == 0
        || amount > MAX_AMOUNT
        || wxids.is_empty()
        || wxids.len() > 500
        || wxids.iter().collect::<BTreeSet<_>>().len() != wxids.len()
    {
        return Err(error("DUES_PAYMENT：请设置有效金额并选择 1–500 位不同成员"));
    }
    field(&remark, 1000)?;
    for wxid in &wxids {
        if !ledger.members.iter().any(|m| &m.wxid == wxid) {
            return Err(error("DUES_MEMBER：成员不存在"));
        }
        for payment in ledger.payments.iter().filter(|p| &p.wxid == wxid) {
            if overlap(payment, start, months)? {
                return Err(error(
                    "DUES_OVERLAP：所选月份已被缴费覆盖，请先核对并撤销原流水；本次批量操作未保存",
                ));
            }
        }
    }
    let auto_note = if months == 12 {
        format!("{}年{}月起12个月会费", &month[..4], &month[5..])
    } else {
        format!("{}年{}月会费", &month[..4], &month[5..])
    };
    let note = if remark.trim().is_empty() {
        auto_note
    } else {
        format!("{auto_note}；{}", remark.trim())
    };
    let timestamp = now();
    for wxid in wxids {
        ledger.payments.push(Payment {
            id: uuid::Uuid::new_v4().to_string(),
            wxid,
            kind,
            month: month.clone(),
            months,
            amount_cents: amount,
            remark: note.clone(),
            recorded_at: timestamp.clone(),
            voided_at: None,
            void_reason: None,
        });
    }
    Ok(())
}

pub struct State {
    path: PathBuf,
    gate: Arc<Mutex<()>>,
    network: Network,
    sync_gate: Mutex<()>,
    avatars: Mutex<std::collections::BTreeMap<String, (std::time::Instant, String)>>,
    avatar_slots: tokio::sync::Semaphore,
}
impl State {
    pub fn new(root: &Path) -> Self {
        Self {
            path: root.join("builtins").join(ID).join("ledger.json"),
            gate: Arc::new(Mutex::new(())),
            network: Network::default(),
            sync_gate: Mutex::new(()),
            avatars: Mutex::new(std::collections::BTreeMap::new()),
            avatar_slots: tokio::sync::Semaphore::new(4),
        }
    }
    /// 锁随阻塞任务一起移动，调用者取消不能让下一次写入与尚在落盘的线程相互覆盖。
    async fn io<T: Send + 'static>(
        &self,
        work: impl FnOnce(&Path) -> Result<T> + Send + 'static,
    ) -> Result<T> {
        let guard = self.gate.clone().lock_owned().await;
        let path = self.path.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let _guard = guard;
            work(&path)
        })
        .await
        .map_err(|_| error("DUES_STORAGE"))?
    }
    async fn snapshot(&self) -> Result<Ledger> {
        self.io(load).await
    }
    async fn change(
        &self,
        revision: u64,
        work: impl FnOnce(&mut Ledger) -> Result<()> + Send + 'static,
    ) -> Result<Ledger> {
        self.io(move |path| {
            require_developer()?;
            transact(path, revision, work)
        })
        .await
    }
    pub async fn execute(&self, request: Request) -> Result<serde_json::Value> {
        require_developer()?;
        let ledger = match request {
            Request::Snapshot => self.snapshot().await?,
            Request::Sync { revision } => {
                let _sync = self
                    .sync_gate
                    .try_lock()
                    .map_err(|_| error("DUES_SYNC_BUSY：成员同步正在进行"))?;
                let data = self
                    .network
                    .fetch(API, &[ORIGIN.to_owned()], 2 * 1024 * 1024)
                    .await?;
                let response: ApiResponse = serde_json::from_slice(&data)
                    .map_err(|_| error("DUES_API：响应格式不受支持，原数据未修改"))?;
                self.change(revision, move |ledger| merge(ledger, response))
                    .await?
            }
            Request::Settings {
                revision,
                monthly_cents,
                annual_cents,
            } => {
                self.change(revision, move |ledger| {
                    ledger.settings = Settings {
                        monthly_cents,
                        annual_cents,
                    };
                    Ok(())
                })
                .await?
            }
            Request::EditMember {
                revision,
                wxid,
                nickname,
                group_nickname,
                remark,
            } => {
                self.change(revision, move |ledger| {
                    let member = ledger
                        .members
                        .iter_mut()
                        .find(|m| m.wxid == wxid)
                        .ok_or_else(|| error("DUES_MEMBER"))?;
                    member.local_nickname = nickname;
                    member.local_group_nickname = group_nickname;
                    member.remark = remark;
                    Ok(())
                })
                .await?
            }
            Request::Pay {
                revision,
                wxids,
                month,
                kind,
                amount_cents,
                remark,
            } => {
                self.change(revision, move |ledger| {
                    pay(ledger, wxids, month, kind, amount_cents, remark)
                })
                .await?
            }
            Request::Void {
                revision,
                id,
                reason,
            } => {
                self.change(revision, move |ledger| {
                    field(&reason, 1000)?;
                    if reason.trim().is_empty() {
                        return Err(error("DUES_REASON：请填写撤销原因"));
                    }
                    let payment = ledger
                        .payments
                        .iter_mut()
                        .find(|p| p.id == id)
                        .ok_or_else(|| error("DUES_PAYMENT"))?;
                    if payment.voided_at.is_some() {
                        return Err(error("DUES_PAYMENT：该流水已撤销"));
                    }
                    payment.voided_at = Some(now());
                    payment.void_reason = Some(reason.trim().to_owned());
                    Ok(())
                })
                .await?
            }
            Request::Avatar { wxid } => return self.avatar(&wxid).await,
        };
        // 下载/磁盘操作期间认证可能过期，返回个人资料之前再次复核。
        require_developer()?;
        serde_json::to_value(ledger).map_err(|_| error("DUES_ENCODING"))
    }
    async fn avatar(&self, wxid: &str) -> Result<serde_json::Value> {
        let _slot = self
            .avatar_slots
            .acquire()
            .await
            .map_err(|_| error("DUES_AVATAR"))?;
        require_developer()?;
        identity(wxid)?;
        let ledger = self.snapshot().await?;
        let url = ledger
            .members
            .iter()
            .find(|m| m.wxid == wxid)
            .map(|m| m.avatar_url.clone())
            .ok_or_else(|| error("DUES_MEMBER"))?;
        if url.is_empty() {
            return Ok(serde_json::Value::Null);
        }
        let mut cache = self.avatars.lock().await;
        cache.retain(|_, (at, _)| at.elapsed() < std::time::Duration::from_secs(600));
        if let Some((_, data)) = cache.get(&url) {
            return Ok(serde_json::Value::String(data.clone()));
        }
        drop(cache);
        // URL 只能取自已同步成员，且限制为实际 API 使用的微信头像源；逐跳 DNS/IP 校验复用插件网关。
        let bytes = self
            .network
            .fetch(
                &url,
                &[
                    "https://mmhead.c2c.wechat.com".into(),
                    "https://wx.qlogo.cn".into(),
                ],
                128 * 1024,
            )
            .await?;
        let mime = match image::guess_format(&bytes) {
            Ok(image::ImageFormat::Png) => "image/png",
            Ok(image::ImageFormat::Jpeg) => "image/jpeg",
            Ok(image::ImageFormat::WebP) => "image/webp",
            _ => return Err(error("DUES_AVATAR：不支持的头像格式")),
        };
        require_developer()?;
        let data = format!("data:{mime};base64,{}", STANDARD.encode(bytes));
        let mut cache = self.avatars.lock().await;
        if cache.len() >= 256 {
            cache.clear();
        }
        cache.insert(url, (std::time::Instant::now(), data.clone()));
        Ok(serde_json::Value::String(data))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn member() -> Member {
        Member {
            wxid: "synthetic-member".into(),
            nickname: "测试".into(),
            group_nickname: String::new(),
            avatar_url: String::new(),
            active: true,
            local_nickname: None,
            local_group_nickname: None,
            remark: String::new(),
        }
    }
    #[test]
    fn annual_covers_cross_year_and_overlapping_batch_is_atomic() -> Result<()> {
        let mut ledger = Ledger {
            members: vec![member()],
            settings: Settings {
                monthly_cents: 1000,
                annual_cents: 10000,
            },
            ..Ledger::default()
        };
        pay(
            &mut ledger,
            vec!["synthetic-member".into()],
            "2026-11".into(),
            PaymentKind::Annual,
            None,
            "已核对".into(),
        )?;
        let payment = &ledger.payments[0];
        assert!(overlap(payment, month_index("2027-10")?, 1)?);
        assert!(!overlap(payment, month_index("2027-11")?, 1)?);
        assert_eq!(payment.amount_cents, 10000);
        assert!(payment.remark.contains("2026年11月"));
        assert!(
            pay(
                &mut ledger,
                vec!["synthetic-member".into()],
                "2027-01".into(),
                PaymentKind::Monthly,
                None,
                String::new()
            )
            .is_err()
        );
        assert_eq!(ledger.payments.len(), 1);
        ledger.payments[0].voided_at = Some(now());
        ledger.payments[0].void_reason = Some("更正".into());
        pay(
            &mut ledger,
            vec!["synthetic-member".into()],
            "2027-01".into(),
            PaymentKind::Custom,
            Some(1234),
            String::new(),
        )?;
        validate(&ledger)?;
        Ok(())
    }
    #[test]
    fn partial_sync_preserves_local_fields_and_complete_sync_archives() -> Result<()> {
        let mut person = member();
        person.local_nickname = Some("本地名".into());
        let mut ledger = Ledger {
            members: vec![person],
            ..Ledger::default()
        };
        let response = |complete: bool| ApiResponse {
            ok: true,
            data: ApiData {
                group: ApiGroup {
                    wxid: GROUP.into(),
                    name: "测试群".into(),
                },
                members: Vec::new(),
                total: usize::from(!complete),
                complete,
                failed_profiles: 0,
            },
            meta: None,
        };
        merge(&mut ledger, response(false))?;
        assert!(ledger.members[0].active);
        merge(&mut ledger, response(true))?;
        assert!(!ledger.members[0].active);
        assert_eq!(ledger.members[0].local_nickname.as_deref(), Some("本地名"));
        Ok(())
    }
    #[test]
    fn malformed_month_money_and_corrupt_store_are_not_silently_replaced() -> Result<()> {
        for value in [
            "2026-00", "2026-13", "26-01", "2026-1", "2026-一", "1999-12",
        ] {
            assert!(month_index(value).is_err());
        }
        let mut ledger = Ledger {
            members: vec![member()],
            ..Ledger::default()
        };
        assert!(
            pay(
                &mut ledger,
                vec!["synthetic-member".into()],
                "2026-11".into(),
                PaymentKind::Monthly,
                None,
                String::new()
            )
            .is_err()
        );
        // dev.ps1 已将 TEMP/TMP 设置为 D 盘；遵循现有原生测试的隔离目录约定。
        let root = tempfile::Builder::new()
            .prefix("dues-test-")
            .tempdir()
            .map_err(io_error)?;
        let path = root.path().join("ledger.json");
        storage::atomic_write(&path, b"broken")?;
        assert!(load(&path).is_err());
        assert_eq!(storage::read_bounded(&path, 10)?, b"broken");
        Ok(())
    }
    #[test]
    fn stable_edition_cannot_enable_builtin_with_debug_build() {
        if !cfg!(feature = "developer-edition") {
            assert!(!visible());
            assert!(require_developer().is_err());
        }
    }
    #[test]
    fn ledger_transactions_keep_backup_reject_stale_revision_and_failed_batch() -> Result<()> {
        let temp = tempfile::tempdir().map_err(io_error)?;
        let path = temp.path().join("ledger.json");
        let first = transact(&path, 0, |ledger| {
            ledger.members.push(member());
            ledger.settings.monthly_cents = 101;
            Ok(())
        })?;
        assert_eq!(first.revision, 1);
        transact(&path, 1, |ledger| {
            pay(
                ledger,
                vec!["synthetic-member".into()],
                "2026-11".into(),
                PaymentKind::Monthly,
                None,
                String::new(),
            )
        })?;
        assert_eq!(load(&path.with_extension("backup.json"))?.revision, 1);
        assert!(transact(&path, 1, |_| Ok(())).is_err());
        assert!(
            transact(&path, 2, |ledger| pay(
                ledger,
                vec!["synthetic-member".into(), "missing-member".into()],
                "2026-12".into(),
                PaymentKind::Monthly,
                None,
                String::new()
            ))
            .is_err()
        );
        let saved = load(&path)?;
        assert_eq!(saved.revision, 2);
        assert_eq!(saved.payments.len(), 1);
        assert_eq!(saved.payments[0].amount_cents, 101);
        Ok(())
    }
    /// 显式联网验收只读固定 API，不写成员资料、不输出姓名、wxid、头像 URL 或响应正文。
    #[tokio::test]
    #[ignore = "requires explicitly requested live group API access"]
    async fn live_dues_api_schema_and_merge_are_compatible() -> Result<()> {
        let bytes = Network::default()
            .fetch(API, &[ORIGIN.to_owned()], 2 * 1024 * 1024)
            .await?;
        let response: ApiResponse =
            serde_json::from_slice(&bytes).map_err(|_| error("DUES_API_SCHEMA"))?;
        let mut ledger = Ledger::default();
        merge(&mut ledger, response)?;
        assert!(ledger.synced_at.is_some());
        assert!(!ledger.members.is_empty());
        validate(&ledger)?;
        Ok(())
    }
}
