//! 分区采用管理员只读预检 → 有效期计划 → 二次核对磁盘身份 → 单次执行。
//! 布局记录不是用户文件备份；执行前必须由用户确认已另行备份重要数据。
use super::{Job, OnboardingState};
use crate::services::tools::{Result, error, save_json};
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};
use tauri::Manager;
const GIB: u64 = 1_073_741_824;
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Disk {
    pub number: u32,
    pub partition: u32,
    pub unique_id: String,
    pub offset: u64,
    pub before_bytes: u64,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub token: String,
    pub system_drive: String,
    pub new_gi_b: u64,
    pub after_bytes: u64,
    pub disk: Disk,
    pub backup_path: String,
}
pub struct Lease {
    pub plan: Plan,
    pub created: Instant,
}
fn after_size(before: u64, new_gib: u64) -> Result<u64> {
    if new_gib < 32 {
        return Err(error("新数据卷至少需要 32 GiB"));
    }
    let requested = new_gib.checked_mul(GIB).ok_or_else(|| error("容量溢出"))?;
    let after = before
        .checked_sub(requested)
        .ok_or_else(|| error("新卷容量超过系统卷"))?
        / 1_048_576
        * 1_048_576;
    if after < 128 * GIB {
        return Err(error("必须为系统卷保留至少 128 GiB"));
    }
    Ok(after)
}
pub async fn elevated(app: &tauri::AppHandle, consent: bool) -> Result<serde_json::Value> {
    if !consent {
        return Err(error("请确认以管理员权限进行只读磁盘预检"));
    }
    if crate::storage_policy::restricted_to_d() {
        return Err(error("开发验收禁止请求真实磁盘管理员操作"));
    }
    let state = app.state::<OnboardingState>();
    let _guard = state.serial.lock().await;
    let mut result = state
        .platform(
            "storage-elevate",
            &[state.root.to_string_lossy().into_owned()],
            Duration::from_secs(120),
        )
        .await?;
    result["expiresAt"] = serde_json::json!(chrono::Utc::now().timestamp_millis() + 900000);
    *state.storage.lock().await = Some(result.clone());
    Ok(result["public"].clone())
}
pub async fn prepare(state: &OnboardingState, gib: u64) -> Result<serde_json::Value> {
    let _guard = state.serial.lock().await;
    if state.progress.lock().await.stage != "storage" {
        return Err(error("请在磁盘空间步骤中准备分区"));
    }
    let snapshot = state
        .storage
        .lock()
        .await
        .clone()
        .ok_or_else(|| error("请先完成管理员只读预检"))?;
    if snapshot["expiresAt"]
        .as_i64()
        .is_none_or(|until| until <= chrono::Utc::now().timestamp_millis())
    {
        return Err(error("磁盘预检已过期，请重新检查"));
    }
    if snapshot["public"]["canSplit"].as_bool() != Some(true)
        || gib > snapshot["public"]["maxNewGiB"].as_u64().unwrap_or(0)
    {
        return Err(error("容量不在本次可安全收缩范围"));
    }
    let disk: Disk =
        serde_json::from_value(snapshot["disk"].clone()).map_err(|_| error("磁盘预检身份无效"))?;
    if disk.unique_id.is_empty()
        || disk.unique_id.len() > 512
        || disk.unique_id.chars().any(char::is_control)
    {
        return Err(error("磁盘唯一标识无效"));
    }
    let plan = Plan {
        token: uuid::Uuid::new_v4().to_string(),
        system_drive: snapshot["public"]["systemDrive"]
            .as_str()
            .ok_or_else(|| error("系统盘标识缺失"))?
            .into(),
        new_gi_b: gib,
        after_bytes: after_size(disk.before_bytes, gib)?,
        disk,
        backup_path: state
            .root
            .join(format!("partition-layout-{}.json", uuid::Uuid::new_v4()))
            .to_string_lossy()
            .into_owned(),
    };
    let preview = serde_json::json!({"token":plan.token,"newGiB":gib,"systemDrive":plan.system_drive,"systemBeforeGiB":plan.disk.before_bytes/GIB,"systemAfterGiB":plan.after_bytes/GIB,"backupPath":plan.backup_path,"expiresInSeconds":900});
    *state.partition.lock().await = Some(Lease {
        plan,
        created: Instant::now(),
    });
    Ok(preview)
}
pub async fn apply(
    app: &tauri::AppHandle,
    token: String,
    confirmation: String,
    backup_confirmed: bool,
    consent: bool,
) -> Result<Job> {
    if crate::storage_policy::restricted_to_d() {
        return Err(error("开发验收禁止真实磁盘分区"));
    }
    if !consent || !backup_confirmed || confirmation != "创建 D 盘" {
        return Err(error("请确认重要文件已有独立备份，并输入“创建 D 盘”"));
    }
    let state = app.state::<OnboardingState>();
    let _guard = state.serial.lock().await;
    if state.progress.lock().await.stage != "storage" {
        return Err(error("当前不在分区步骤"));
    }
    if matches!(state.job.lock().await.phase.as_str(), "running" | "unknown") {
        return Err(error("请先核实上次操作结果"));
    }
    let settings = app.state::<crate::services::settings::SettingsState>();
    let _critical = crate::services::settings::runtime::Critical::acquire(&settings)?;
    let lease = state
        .partition
        .lock()
        .await
        .take()
        .ok_or_else(|| error("请重新生成分区计划"))?;
    if lease.plan.token != token || lease.created.elapsed() > Duration::from_secs(900) {
        return Err(error("分区计划已失效，请重新预检"));
    }
    let mut job = Job {
        phase: "running".into(),
        kind: "partition".into(),
        message: "正在重新核对并创建 D 盘，请勿断电或关闭应用。".into(),
        restart_required: false,
    };
    save_json(&state.root.join("job.json"), &job).await?;
    *state.job.lock().await = job.clone();
    let payload = serde_json::to_string(&lease.plan).map_err(|_| error("分区计划编码失败"))?;
    match state
        .platform(
            "partition-apply",
            &[payload, state.root.to_string_lossy().into_owned()],
            Duration::from_secs(3600),
        )
        .await
    {
        Ok(_) => {
            *state.storage.lock().await = None;
            job.phase = "complete".into();
            job.message="D 盘创建完成。此操作不能一键撤销；若需合并，先转移新卷文件，再使用 Windows 磁盘管理。".into();
        }
        Err(cause) => {
            job.phase = "unknown".into();
            job.message = format!(
                "分区结果需要核实：{cause}。布局记录：{}；不会自动删除新分区。",
                lease.plan.backup_path
            );
        }
    }
    save_json(&state.root.join("job.json"), &job).await?;
    *state.job.lock().await = job.clone();
    Ok(job)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn split_size_rejects_overflow_and_os_starvation() {
        assert!(after_size(512 * GIB, 0).is_err());
        assert!(after_size(512 * GIB, u64::MAX).is_err());
        assert!(after_size(160 * GIB, 64).is_err());
        assert_eq!(after_size(512 * GIB, 64).ok(), Some(448 * GIB));
    }
}
