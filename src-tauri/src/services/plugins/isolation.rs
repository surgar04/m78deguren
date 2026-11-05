//! 进程组仅负责异常退出回收，不代替 Wasm 权限隔离，也不修改系统设置或注册表。
//! 使用安全封装持有不可继承的 Job 句柄；主程序退出后由 Windows 终止仍在等待 WASI 的宿主。
use crate::services::tools::{Result, error};
#[cfg(windows)]
pub struct ProcessGroup(win32job::Job);
#[cfg(not(windows))]
pub struct ProcessGroup;
impl ProcessGroup {
    pub fn new() -> Result<Self> {
        #[cfg(windows)]
        {
            let mut limits = win32job::ExtendedLimitInfo::new();
            limits.limit_kill_on_job_close();
            win32job::Job::create_with_limit_info(&limits)
                .map(Self)
                .map_err(|_| error("PLUGIN_PROCESS_GUARD：无法建立插件进程回收保护"))
        }
        #[cfg(not(windows))]
        {
            Err(error("PLUGIN_PLATFORM：当前宿主仅支持 Windows"))
        }
    }
    pub fn attach(&self, child: &tokio::process::Child) -> Result<()> {
        #[cfg(windows)]
        {
            let handle = child
                .raw_handle()
                .ok_or_else(|| error("PLUGIN_PROCESS_GUARD"))?;
            self.0
                .assign_process(handle as isize)
                .map_err(|_| error("PLUGIN_PROCESS_GUARD：无法保护插件子进程，已阻止执行"))
        }
        #[cfg(not(windows))]
        {
            let _ = child;
            Err(error("PLUGIN_PLATFORM"))
        }
    }
}
