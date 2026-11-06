//! 公网会费只读同步。金额为原始整数游戏币，日期及最新方案由服务端业务算法决定。
use super::{GROUP, Network, ORIGIN, field, identity, now};
use crate::services::tools::{Result, error};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use std::collections::{BTreeMap, BTreeSet};

const SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const MAX_RECORDS: usize = 100_000;

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Person {
    pub wxid: String,
    pub nickname: String,
    pub avatar_url: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Fee {
    pub id: String,
    pub member: Person,
    pub plan: String,
    pub plan_label: String,
    pub amount: u64,
    pub amount_text: String,
    pub currency: String,
    pub payment_date: String,
    pub paid_at: String,
    pub recorded_at: Option<String>,
    pub operator_wxid: String,
    pub expires_on: String,
    pub expires_at: String,
    pub expires_at_text: String,
    pub remaining_days: i64,
    pub remaining_days_text: String,
    pub status: String,
    pub is_expired: bool,
    pub is_due_today: bool,
    pub is_back_payment: bool,
    pub is_latest: bool,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberFees {
    pub member: Person,
    pub latest_fee: Fee,
    pub record_count: usize,
    pub total_amount: u64,
    pub total_amount_text: String,
    pub monthly_total_amount: u64,
    pub yearly_total_amount: u64,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Meta {
    pub schema_version: u32,
    pub revision: u64,
    pub updated_at: Option<String>,
    pub evaluated_on: String,
    pub time_zone: String,
    pub currency: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub record_count: usize,
    pub total_amount: u64,
    pub member_count: Option<usize>,
    pub active_members: Option<usize>,
    pub due_today_members: Option<usize>,
    pub expired_members: Option<usize>,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub synced_at: String,
    pub group_name: String,
    pub meta: Meta,
    pub summary: Summary,
    pub members: Vec<MemberFees>,
    pub records: Vec<Fee>,
}
impl Snapshot {
    /// 请求时间不参与内容相等判断，未变化的轮询不制造版本冲突或重复备份。
    pub fn same_data(&self, other: &Self) -> bool {
        self.group_name == other.group_name
            && self.meta == other.meta
            && self.summary == other.summary
            && self.members == other.members
            && self.records == other.records
    }
}
#[derive(Clone, Deserialize)]
struct Group {
    wxid: String,
    name: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Pagination {
    offset: usize,
    limit: usize,
    total: usize,
    has_more: bool,
    next_offset: Option<usize>,
}
#[derive(Deserialize)]
struct PageMeta {
    #[serde(flatten)]
    meta: Meta,
    pagination: Pagination,
}
#[derive(Deserialize)]
struct Data<T> {
    group: Group,
    view: String,
    items: Vec<T>,
    summary: Summary,
}
#[derive(Deserialize)]
struct Page<T> {
    ok: bool,
    data: Data<T>,
    meta: PageMeta,
}

fn invalid() -> crate::error::AppError {
    error("DUES_REMOTE_INVALID：会费响应不完整或字段无效，原快照未覆盖")
}
fn date(value: &str) -> Result<chrono::NaiveDate> {
    if value.len() != 10 {
        return Err(invalid());
    }
    let parsed = chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d").map_err(|_| invalid())?;
    if parsed.format("%Y-%m-%d").to_string() != value {
        return Err(invalid());
    }
    Ok(parsed)
}
fn instant(value: &str) -> Result<()> {
    chrono::DateTime::parse_from_rfc3339(value).map_err(|_| invalid())?;
    Ok(())
}
fn person(value: &Person) -> Result<()> {
    identity(&value.wxid)?;
    field(&value.nickname, 512)?;
    if let Some(url) = &value.avatar_url {
        field(url, 4096)?;
    }
    Ok(())
}
fn fee(value: &Fee, evaluated: &str) -> Result<()> {
    person(&value.member)?;
    field(&value.id, 128)?;
    identity(&value.operator_wxid)?;
    for text in [
        &value.plan_label,
        &value.amount_text,
        &value.expires_at_text,
        &value.remaining_days_text,
    ] {
        field(text, 128)?;
    }
    if value.id.is_empty()
        || !matches!(value.plan.as_str(), "monthly" | "yearly")
        || value.currency != "POKEMMO_POKEYEN"
        || value.amount > SAFE_INTEGER
    {
        return Err(invalid());
    }
    date(&value.payment_date)?;
    instant(&value.paid_at)?;
    instant(&value.expires_at)?;
    if let Some(at) = &value.recorded_at {
        instant(at)?;
    }
    let days = (date(&value.expires_on)? - date(evaluated)?).num_days();
    let status = if days < 0 {
        "expired"
    } else if days == 0 {
        "due_today"
    } else {
        "active"
    };
    if days != value.remaining_days
        || value.status != status
        || value.is_expired != (days < 0)
        || value.is_due_today != (days == 0)
    {
        return Err(invalid());
    }
    Ok(())
}

/// 所有分页、汇总与流水交叉校验后才允许提交。空快照合法，代表远端重置后的真实状态。
pub fn validate(snapshot: &Snapshot) -> Result<()> {
    let meta = &snapshot.meta;
    if meta.schema_version != 1
        || meta.revision > SAFE_INTEGER
        || meta.currency != "POKEMMO_POKEYEN"
        || meta.time_zone.is_empty()
        || snapshot.members.len() > 5000
        || snapshot.records.len() > MAX_RECORDS
    {
        return Err(invalid());
    }
    field(&snapshot.group_name, 512)?;
    field(&meta.time_zone, 128)?;
    date(&meta.evaluated_on)?;
    instant(&snapshot.synced_at)?;
    if let Some(at) = &meta.updated_at {
        instant(at)?;
    }
    let mut records = BTreeMap::new();
    let mut totals = BTreeMap::<&str, (usize, u64, u64, u64, usize)>::new();
    for record in &snapshot.records {
        fee(record, &meta.evaluated_on)?;
        if records.insert(record.id.as_str(), record).is_some() {
            return Err(invalid());
        }
        let total = totals.entry(&record.member.wxid).or_default();
        total.0 += 1;
        total.1 = total
            .1
            .checked_add(record.amount)
            .filter(|sum| *sum <= SAFE_INTEGER)
            .ok_or_else(invalid)?;
        if record.plan == "monthly" {
            total.2 += record.amount;
        } else {
            total.3 += record.amount;
        }
        total.4 += usize::from(record.is_latest);
    }
    let mut people = BTreeSet::new();
    let mut states = [0usize; 3];
    let mut sum = 0u64;
    for member in &snapshot.members {
        person(&member.member)?;
        field(&member.total_amount_text, 128)?;
        fee(&member.latest_fee, &meta.evaluated_on)?;
        if !people.insert(member.member.wxid.as_str())
            || member.member.wxid != member.latest_fee.member.wxid
            || !member.latest_fee.is_latest
            || records.get(member.latest_fee.id.as_str()).copied() != Some(&member.latest_fee)
            || totals.get(member.member.wxid.as_str()).copied()
                != Some((
                    member.record_count,
                    member.total_amount,
                    member.monthly_total_amount,
                    member.yearly_total_amount,
                    1,
                ))
        {
            return Err(invalid());
        }
        sum = sum
            .checked_add(member.total_amount)
            .filter(|v| *v <= SAFE_INTEGER)
            .ok_or_else(invalid)?;
        states[if member.latest_fee.is_expired {
            2
        } else if member.latest_fee.is_due_today {
            1
        } else {
            0
        }] += 1;
    }
    let summary = &snapshot.summary;
    if people.len() != totals.len()
        || summary.member_count != Some(people.len())
        || summary.record_count != snapshot.records.len()
        || summary.total_amount != sum
        || summary.active_members != Some(states[0])
        || summary.due_today_members != Some(states[1])
        || summary.expired_members != Some(states[2])
    {
        return Err(invalid());
    }
    Ok(())
}

type PageIdentity = (Meta, Summary, String, usize);

/// 单页收集器独立于 HTTP，便于验证分页中途写入、跨天和异常游标；生产与测试使用相同规则。
fn append_page<T>(
    page: Page<T>,
    view: &str,
    maximum: usize,
    offset: usize,
    result: &mut Vec<T>,
    first: &mut Option<PageIdentity>,
) -> Result<Option<usize>> {
    let p = page.meta.pagination;
    if !page.ok
        || page.data.group.wxid != GROUP
        || page.data.view != view
        || p.offset != offset
        || p.limit != 500
        || p.total > maximum
        || offset > p.total
        || page.data.items.len() > 500
        || page.data.items.len() > p.total.saturating_sub(offset)
    {
        return Err(invalid());
    }
    if let Some((meta, summary, group, total)) = first.as_ref() {
        if meta != &page.meta.meta
            || summary != &page.data.summary
            || group != &page.data.group.name
            || total != &p.total
        {
            return Err(error("DUES_REMOTE_CHANGED"));
        }
    } else {
        *first = Some((
            page.meta.meta,
            page.data.summary,
            page.data.group.name,
            p.total,
        ));
    }
    let end = offset
        .checked_add(page.data.items.len())
        .ok_or_else(invalid)?;
    if p.has_more != (end < p.total)
        || p.next_offset != if p.has_more { Some(end) } else { None }
        || (p.has_more && end <= offset)
    {
        return Err(invalid());
    }
    result.extend(page.data.items);
    Ok(if p.has_more { Some(end) } else { None })
}
/// 不使用昵称推测身份，不按缴费日期增量拉取，补登和删除均由全量快照正确反映。
async fn pages<T: DeserializeOwned>(
    network: &Network,
    view: &str,
    maximum: usize,
) -> Result<(Vec<T>, Meta, Summary, String)> {
    let path = if view == "members" {
        "guild-fees"
    } else {
        "guild-fees/records"
    };
    let mut offset = 0usize;
    let mut result = Vec::new();
    let mut first: Option<PageIdentity> = None;
    loop {
        let url = format!("{ORIGIN}/api/v1/{path}?limit=500&offset={offset}");
        let bytes = network.fetch(&url, &[ORIGIN.to_owned()], 2 * 1024 * 1024).await
            .map_err(|_| error("DUES_FEES_NETWORK：暂时无法读取会费接口，请检查网络或接口访问权限；已保存数据保留"))?;
        let page: Page<T> = serde_json::from_slice(&bytes).map_err(|_| invalid())?;
        if let Some(next) = append_page(page, view, maximum, offset, &mut result, &mut first)? {
            offset = next;
        } else {
            let (meta, summary, group, total) = first.ok_or_else(invalid)?;
            if result.len() != total {
                return Err(invalid());
            }
            return Ok((result, meta, summary, group));
        }
    }
}
async fn once(network: &Network) -> Result<Snapshot> {
    let (members, meta, summary, group_name) =
        pages::<MemberFees>(network, "members", 5000).await?;
    let (records, record_meta, record_summary, record_group) =
        pages::<Fee>(network, "records", MAX_RECORDS).await?;
    if meta != record_meta
        || group_name != record_group
        || summary.record_count != record_summary.record_count
        || summary.total_amount != record_summary.total_amount
    {
        return Err(error("DUES_REMOTE_CHANGED"));
    }
    let snapshot = Snapshot {
        synced_at: now(),
        group_name,
        meta,
        summary,
        members,
        records,
    };
    validate(&snapshot)?;
    Ok(snapshot)
}
pub async fn download(network: &Network) -> Result<Snapshot> {
    // revision 与 evaluatedOn 任一个变化均重新从第一页读取，重试有总时限及次数上限。
    tokio::time::timeout(std::time::Duration::from_secs(120), async {
        for _ in 0..3 {
            match once(network).await {
                Err(cause) if cause.to_string().contains("DUES_REMOTE_CHANGED") => continue,
                result => return result,
            }
        }
        Err(error(
            "DUES_FEES_BUSY：会费数据连续变化，请稍后重新同步；原快照保留",
        ))
    })
    .await
    .map_err(|_| error("DUES_FEES_TIMEOUT：会费同步超时，已保存数据保留"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> Result<Snapshot> {
        let fee = serde_json::json!({"id":"synthetic-fee","member":{"wxid":"synthetic-member","nickname":"合成成员","avatarUrl":null},
            "plan":"monthly","planLabel":"月费","amount":200000,"amountText":"20W","currency":"POKEMMO_POKEYEN",
            "paymentDate":"2026-11-06","paidAt":"2026-11-05T16:00:00Z","recordedAt":null,"operatorWxid":"synthetic-operator",
            "expiresOn":"2026-12-06","expiresAt":"2026-12-06T15:59:59.999Z","expiresAtText":"2026年12月6日",
            "remainingDays":30,"remainingDaysText":"剩余30天","status":"active","isExpired":false,"isDueToday":false,"isBackPayment":false,"isLatest":true});
        serde_json::from_value(serde_json::json!({"syncedAt":"2026-11-06T03:00:00Z","groupName":"合成群",
            "meta":{"schemaVersion":1,"revision":12,"updatedAt":null,"evaluatedOn":"2026-11-06","timeZone":"Asia/Shanghai","currency":"POKEMMO_POKEYEN"},
            "summary":{"memberCount":1,"recordCount":1,"totalAmount":200000,"activeMembers":1,"dueTodayMembers":0,"expiredMembers":0},
            "members":[{"member":fee["member"],"latestFee":fee,"recordCount":1,"totalAmount":200000,"totalAmountText":"20W","monthlyTotalAmount":200000,"yearlyTotalAmount":0}],
            "records":[fee]})).map_err(|_| invalid())
    }
    fn page(
        offset: usize,
        revision: u64,
        evaluated: &str,
        next: Option<usize>,
    ) -> Result<Page<u8>> {
        serde_json::from_value(serde_json::json!({"ok":true,"data":{"group":{"wxid":GROUP,"name":"合成群"},"view":"members","items":[1],
            "summary":{"memberCount":2,"recordCount":2,"totalAmount":0,"activeMembers":2,"dueTodayMembers":0,"expiredMembers":0}},
            "meta":{"schemaVersion":1,"revision":revision,"updatedAt":null,"evaluatedOn":evaluated,"timeZone":"Asia/Shanghai","currency":"POKEMMO_POKEYEN",
                "pagination":{"offset":offset,"limit":500,"total":2,"hasMore":next.is_some(),"nextOffset":next}}})).map_err(|_|invalid())
    }
    #[test]
    fn complete_pages_require_same_revision_day_summary_and_advancing_cursor() -> Result<()> {
        let mut items = Vec::new();
        let mut first = None;
        assert_eq!(
            append_page(
                page(0, 12, "2026-11-06", Some(1))?,
                "members",
                5000,
                0,
                &mut items,
                &mut first
            )?,
            Some(1)
        );
        for (revision, day) in [(13, "2026-11-06"), (12, "2026-11-07")] {
            assert!(
                append_page(
                    page(1, revision, day, None)?,
                    "members",
                    5000,
                    1,
                    &mut items,
                    &mut first
                )
                .is_err()
            );
        }
        assert!(
            append_page(
                page(1, 12, "2026-11-06", Some(1))?,
                "members",
                5000,
                1,
                &mut items,
                &mut first
            )
            .is_err()
        );
        assert_eq!(
            append_page(
                page(1, 12, "2026-11-06", None)?,
                "members",
                5000,
                1,
                &mut items,
                &mut first
            )?,
            None
        );
        assert_eq!(items.len(), 2);
        Ok(())
    }
    #[test]
    fn game_currency_totals_latest_identity_and_expiry_are_validated() -> Result<()> {
        let valid = fixture()?;
        validate(&valid)?;
        assert_eq!(valid.members[0].latest_fee.amount, 200000);
        assert!(valid.records[0].recorded_at.is_none());
        let mut invalids = Vec::new();
        let mut v = valid.clone();
        v.records.push(v.records[0].clone());
        invalids.push(v);
        let mut v = valid.clone();
        v.members[0].total_amount = 2000;
        invalids.push(v);
        let mut v = valid.clone();
        v.members[0].latest_fee.member.wxid = "other-person".into();
        invalids.push(v);
        let mut v = valid.clone();
        v.records[0].currency = "CNY".into();
        invalids.push(v);
        let mut v = valid.clone();
        v.meta.evaluated_on = "2026-12-07".into();
        invalids.push(v);
        for v in invalids {
            assert!(validate(&v).is_err());
        }
        Ok(())
    }
    #[test]
    fn remote_reset_and_failed_snapshot_preserve_local_ledger_and_backup() -> Result<()> {
        use super::super::{Ledger, Member, PaymentKind, load, pay, transact};
        let root = tempfile::tempdir().map_err(crate::services::tools::io_error)?;
        let path = root.path().join("ledger.json");
        let saved = transact(&path, 0, |ledger| {
            ledger.members.push(Member {
                wxid: "synthetic-member".into(),
                nickname: "本地昵称".into(),
                group_nickname: String::new(),
                avatar_url: String::new(),
                active: true,
                local_nickname: Some("用户编辑".into()),
                local_group_nickname: None,
                remark: "保留备注".into(),
            });
            pay(
                ledger,
                vec!["synthetic-member".into()],
                "2026-11".into(),
                PaymentKind::Monthly,
                Some(101),
                String::new(),
            )?;
            ledger.remote_fees = Some(fixture()?);
            Ok(())
        })?;
        let mut bad = fixture()?;
        bad.summary.total_amount = 999;
        assert!(
            transact(&path, saved.revision, |l| {
                l.remote_fees = Some(bad);
                Ok(())
            })
            .is_err()
        );
        assert_eq!(load(&path)?.revision, saved.revision);
        let mut empty = fixture()?;
        empty.members.clear();
        empty.records.clear();
        empty.meta.revision += 1;
        empty.summary = Summary {
            record_count: 0,
            total_amount: 0,
            member_count: Some(0),
            active_members: Some(0),
            due_today_members: Some(0),
            expired_members: Some(0),
        };
        let reset = transact(&path, saved.revision, |l| {
            l.remote_fees = Some(empty);
            Ok(())
        })?;
        assert_eq!(reset.payments[0].amount_cents, 101);
        assert_eq!(reset.members[0].local_nickname.as_deref(), Some("用户编辑"));
        assert_eq!(
            load(&path.with_extension("backup.json"))?
                .remote_fees
                .as_ref()
                .map(|s| s.records.len()),
            Some(1)
        );
        // 已发行 schemaVersion=1 文件缺少新字段时仍可读取，不做破坏性文件迁移。
        let mut old = serde_json::to_value(Ledger::default()).map_err(|_| invalid())?;
        old.as_object_mut()
            .ok_or_else(invalid)?
            .remove("remoteFees");
        let compatible: Ledger = serde_json::from_value(old).map_err(|_| invalid())?;
        assert!(compatible.remote_fees.is_none());
        Ok(())
    }
    #[tokio::test]
    #[ignore = "显式访问原公网会费 API；只读，不登记费用、不输出个人资料"]
    async fn live_public_guild_fees_snapshot() -> Result<()> {
        let snapshot = download(&Network::default()).await?;
        validate(&snapshot)?;
        Ok(())
    }
}
