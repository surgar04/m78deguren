use super::{types::*, *};
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
pub type Processes = Vec<(String, u32, u64)>;
/// 只读取镜像路径、PID 与创建时间，不采集 CPU、内存、命令行或用户环境。
/// 无活动准备时不启动后台轮询，活动期间每两秒读取一次，阻塞访问进入专用线程池。
pub async fn processes() -> Result<Processes> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut system = System::new();
        system.refresh_processes_specifics(
            ProcessesToUpdate::All,
            true,
            ProcessRefreshKind::nothing().with_exe(UpdateKind::Always),
        );
        system
            .processes()
            .values()
            .filter_map(|p| {
                p.exe().map(|exe| {
                    (
                        exe.to_string_lossy().into_owned(),
                        p.pid().as_u32(),
                        p.start_time(),
                    )
                })
            })
            .collect()
    })
    .await
    .map_err(|_| error("进程状态读取失败，请刷新后重试"))
}
pub fn instance(rows: &Processes, path: &str) -> Option<(u32, u64)> {
    rows.iter()
        .filter(|(exe, _, _)| same_path(exe, path))
        .map(|(_, pid, start)| (*pid, *start))
        .min_by_key(|(pid, start)| (*start, *pid))
}
fn same_path(left: &str, right: &str) -> bool {
    left.strip_prefix("\\\\?\\")
        .unwrap_or(left)
        .eq_ignore_ascii_case(right.strip_prefix("\\\\?\\").unwrap_or(right))
}
pub async fn run(root: &Path, operation: &str, arguments: &[String]) -> Result<serde_json::Value> {
    super::super::tools::platform::run_embedded(
        root,
        operation,
        arguments,
        Duration::from_secs(35),
        include_str!("windows.ps1"),
    )
    .await
}
pub async fn verify(root: &Path, path: &str) -> Result<Client> {
    let result = run(root, "acceleration-verify", &[path.into()]).await?;
    serde_json::from_value(result).map_err(|_| error("客户端身份响应无效"))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn full_path_and_generation_are_required() {
        let rows = vec![
            ("D:\\QuickFox\\QuickFox.exe".into(), 10, 20),
            ("D:\\QuickFox\\QuickFox.exe".into(), 11, 21),
        ];
        assert_eq!(
            instance(&rows, "d:\\quickfox\\quickfox.exe"),
            Some((10, 20))
        );
        assert_eq!(instance(&rows, "E:\\Fake\\QuickFox.exe"), None);
        assert_eq!(
            instance(&rows, "\\\\?\\D:\\QuickFox\\QuickFox.exe"),
            Some((10, 20))
        );
    }
}
