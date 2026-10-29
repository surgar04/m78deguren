//! 进程内 ETW Present 统计，不启动 PresentMon、不生成虚假 FPS。
//! 每条交换链独立统计，Start/Stop 成对且 Result 成功才计帧；选择最近最活跃交换链，避免多链相加翻倍。
use super::types::Fps;
use crate::services::tools::{Result, error};
#[cfg(windows)]
use ferrisetw::{
    EventRecord,
    parser::Parser,
    provider::{EventFilter, Provider},
    trace::UserTrace,
};
use std::{
    collections::{HashMap, VecDeque},
    sync::{
        Arc, Mutex,
        atomic::{AtomicU32, AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};

#[derive(Default)]
struct Chain {
    previous: Option<i64>,
    intervals: VecDeque<(Instant, f64)>,
}
#[derive(Default)]
struct Buffer {
    pid: u32,
    pending: HashMap<(u32, u8), (u64, i64)>,
    chains: HashMap<(u8, u64), Chain>,
    source_rank: Option<(u8, Instant)>,
    recent_tokens: VecDeque<(u64, Instant)>,
}
impl Buffer {
    fn reset(&mut self, pid: u32) {
        *self = Self {
            pid,
            ..Self::default()
        };
    }
    fn present(&mut self, source: u8, chain: u64, timestamp: i64) {
        if self.chains.len() >= 32 && !self.chains.contains_key(&(source, chain)) {
            return;
        }
        let entry = self.chains.entry((source, chain)).or_default();
        if let Some(previous) = entry.previous {
            // ProcessTrace 已把 QPC 转换成系统 100ns 刻度，不误当作毫秒或当前回调到达时间。
            let ms = (timestamp - previous) as f64 / 10_000.0;
            if !(0.1..=10_000.0).contains(&ms) {
                if ms > 10_000.0 {
                    entry.previous = Some(timestamp);
                }
                return;
            }
            entry.intervals.push_back((Instant::now(), ms));
        }
        entry.previous = Some(timestamp);
        while entry.intervals.len() > 60_000
            || entry
                .intervals
                .front()
                .is_some_and(|(at, _)| at.elapsed() > Duration::from_secs(10))
        {
            entry.intervals.pop_front();
        }
    }
    fn choose_source(&mut self, rank: u8) -> bool {
        if let Some((current, at)) = self.source_rank {
            if at.elapsed() < Duration::from_millis(800) && rank > current {
                return false;
            }
            if rank != current {
                self.chains.clear();
                self.recent_tokens.clear();
            }
        }
        self.source_rank = Some((rank, Instant::now()));
        true
    }
    fn kernel_present(&mut self, rank: u8, timestamp: i64, token: Option<u64>) {
        if !self.choose_source(rank) {
            return;
        }
        while self
            .recent_tokens
            .front()
            .is_some_and(|(_, at)| at.elapsed() > Duration::from_secs(1))
        {
            self.recent_tokens.pop_front();
        }
        if let Some(token) = token.filter(|token| *token != 0) {
            if self.recent_tokens.iter().any(|(known, _)| *known == token) {
                return;
            }
            if self.recent_tokens.len() >= 8192 {
                self.recent_tokens.pop_front();
            }
            self.recent_tokens.push_back((token, Instant::now()));
        }
        // 同优先级的 PresentHistory / Detailed 事件仍按 0.1ms 最小间隔去重。
        self.present(2, 0, timestamp);
    }
    fn read(&self, enabled: bool) -> Fps {
        if !enabled {
            return Fps {
                message: "ETW 未开启".into(),
                ..Fps::default()
            };
        }
        let recent = |chain: &&Chain| {
            chain
                .intervals
                .iter()
                .filter(|(at, _)| at.elapsed() <= Duration::from_secs(1))
                .count()
        };
        let selected = self.chains.values().max_by_key(recent);
        let mut snapshot = Fps {
            enabled,
            process_id: self.pid,
            ..Fps::default()
        };
        if let Some(chain) = selected {
            let current: Vec<_> = chain
                .intervals
                .iter()
                .filter(|(at, _)| at.elapsed() <= Duration::from_secs(1))
                .map(|(_, ms)| *ms)
                .collect();
            let mut all: Vec<_> = chain
                .intervals
                .iter()
                .filter(|(at, _)| at.elapsed() <= Duration::from_secs(10))
                .map(|(_, ms)| *ms)
                .collect();
            snapshot.frame_count = all.len();
            if !current.is_empty() {
                snapshot.fps = Some(1000.0 * current.len() as f64 / current.iter().sum::<f64>());
                all.sort_by(|a, b| b.total_cmp(a));
                snapshot.low1 = low(&all, 100);
                snapshot.low01 = low(&all, 1000);
            }
        }
        snapshot.message = if !enabled {
            "ETW 未开启"
        } else if snapshot.fps.is_none() {
            "等待目标进程的 ETW Present 事件（DXGI / D3D9 / DxgKrnl / Win32k）"
        } else if snapshot.low01.is_none() {
            "0.1% Low 需要窗口内至少 1000 帧；缺失读数不补零"
        } else {
            "ETW Present · 最近 1 秒 FPS / 最近 10 秒 Low"
        }
        .into();
        snapshot
    }
}
fn low(descending: &[f64], denominator: usize) -> Option<f64> {
    if descending.len() < denominator {
        return None;
    }
    let count = descending.len().div_ceil(denominator);
    Some(1000.0 * count as f64 / descending[..count].iter().sum::<f64>())
}
pub struct Frames {
    generation: AtomicU64,
    target: Arc<AtomicU32>,
    configured: AtomicU32,
    buffer: Arc<Mutex<Buffer>>,
    #[cfg(windows)]
    trace: Mutex<Option<UserTrace>>,
}
impl Default for Frames {
    fn default() -> Self {
        Self {
            generation: AtomicU64::new(0),
            target: Arc::new(AtomicU32::new(0)),
            configured: AtomicU32::new(0),
            buffer: Arc::new(Mutex::new(Buffer::default())),
            #[cfg(windows)]
            trace: Mutex::new(None),
        }
    }
}
impl Frames {
    pub fn generation(&self) -> u64 {
        self.generation.load(Ordering::SeqCst)
    }
    /// HUD 只更改自己持有的采样目标；硬件页显式重新启动后旧租约自动失效。
    pub fn hud_target(&self, pid: u32, generation: u64) {
        if self.generation() == generation {
            self.configured.store(pid, Ordering::Relaxed);
            self.foreground(pid);
        }
    }
    pub fn foreground(&self, pid: u32) {
        let configured = self.configured.load(Ordering::Relaxed);
        let target = if configured > 0 {
            configured
        } else if pid == std::process::id() {
            0
        } else {
            pid
        };
        if self.target.swap(target, Ordering::Relaxed) != target
            && let Ok(mut buffer) = self.buffer.lock()
        {
            buffer.reset(target);
        }
    }
    pub fn stop(&self) -> Result<()> {
        self.generation.fetch_add(1, Ordering::SeqCst);
        #[cfg(windows)]
        if let Some(trace) = self
            .trace
            .lock()
            .map_err(|_| error("ETW 状态被占用"))?
            .take()
        {
            trace
                .stop()
                .map_err(|cause| error(format!("ETW 停止失败：{cause:?}")))?;
        }
        self.buffer
            .lock()
            .map_err(|_| error("帧缓冲被占用"))?
            .reset(0);
        Ok(())
    }
    pub fn start(&self, pid: Option<u32>) -> Result<()> {
        self.stop()?;
        self.configured
            .store(pid.unwrap_or_default(), Ordering::Relaxed);
        self.foreground(pid.unwrap_or_default());
        #[cfg(windows)]
        {
            let mut providers = Vec::new();
            for (source, guid, ids) in [
                (
                    0_u8,
                    "CA11C036-0102-4A2D-A6AD-F03CFED5D3C9",
                    vec![42, 43, 55, 56],
                ),
                (1, "783ACA0A-790E-4D7F-8451-AA850511C6B9", vec![1, 2]),
                (
                    2,
                    "802EC45A-1E99-4B83-9920-87C98277BA9D",
                    vec![171, 215, 184, 166, 116, 259, 386, 168, 252, 266],
                ),
                (3, "8C416C79-D49B-4F01-A467-E56D3AA8234C", vec![201]),
            ] {
                let target = self.target.clone();
                let buffer = self.buffer.clone();
                let provider = Provider::by_guid(guid)
                    .add_filter(EventFilter::ByEventIds(ids))
                    .add_callback(
                        move |record: &EventRecord, locator: &ferrisetw::SchemaLocator| {
                            let pid = target.load(Ordering::Relaxed);
                            if pid == 0 || record.process_id() != pid {
                                return;
                            }
                            let Ok(schema) = locator.event_schema(record) else {
                                return;
                            };
                            let parser = Parser::create(record, &schema);
                            let Ok(mut state) = buffer.lock() else {
                                return;
                            };
                            if state.pid != pid {
                                state.reset(pid);
                            }
                            let event = record.event_id();
                            if source >= 2 {
                                let rank = if source == 3 {
                                    3
                                } else if event == 171 {
                                    1
                                } else if event == 215 {
                                    2
                                } else {
                                    match event {
                                        184 => 4,
                                        168 => 5,
                                        166 => 6,
                                        116 => 7,
                                        259 => 8,
                                        386 => 9,
                                        252 => 10,
                                        _ => 11,
                                    }
                                };
                                let token = parser
                                    .try_parse::<u64>("Token")
                                    .or_else(|_| parser.try_parse::<u64>("hToken"))
                                    .ok();
                                state.kernel_present(rank, record.raw_timestamp(), token);
                                return;
                            }
                            let start = if source == 0 {
                                event == 42 || event == 55
                            } else {
                                event == 1
                            };
                            if start {
                                if parser
                                    .try_parse::<u32>("Flags")
                                    .is_ok_and(|flags| flags & 1 != 0)
                                {
                                    return;
                                }
                                let chain = parser
                                    .try_parse::<u64>("pIDXGISwapChain")
                                    .or_else(|_| parser.try_parse::<u64>("pSwapchain"))
                                    .or_else(|_| parser.try_parse::<u64>("pDevice"));
                                if let Ok(chain) = chain {
                                    if state.pending.len() >= 256 {
                                        state.pending.clear();
                                    }
                                    state.pending.insert(
                                        (record.thread_id(), source),
                                        (chain, record.raw_timestamp()),
                                    );
                                }
                            } else if let Some((chain, timestamp)) =
                                state.pending.remove(&(record.thread_id(), source))
                                && parser
                                    .try_parse::<i32>("Result")
                                    .or_else(|_| parser.try_parse::<i32>("ReturnValue"))
                                    .is_ok_and(|result| result == 0)
                                && state.choose_source(0)
                            {
                                state.present(source, chain, timestamp);
                            }
                        },
                    )
                    .build();
                providers.push(provider);
            }
            let mut builder = UserTrace::new().named(format!(
                "Zhenjing-Present-{}-{}",
                std::process::id(),
                uuid::Uuid::new_v4()
            ));
            for provider in providers {
                builder = builder.enable(provider);
            }
            let trace = builder.start_and_process().map_err(|cause| {
                error(format!(
                    "ETW 启动失败（可能缺少权限）：{cause:?}；不会自动请求 UAC"
                ))
            })?;
            *self.trace.lock().map_err(|_| error("ETW 状态被占用"))? = Some(trace);
            Ok(())
        }
        #[cfg(not(windows))]
        {
            Err(error("ETW 需要 Windows"))
        }
    }
    pub fn snapshot(&self) -> Fps {
        #[cfg(windows)]
        let enabled = self.trace.lock().is_ok_and(|trace| trace.is_some());
        #[cfg(not(windows))]
        let enabled = false;
        self.buffer.lock().map_or_else(
            |_| Fps {
                message: "帧缓冲不可用".into(),
                ..Fps::default()
            },
            |buffer| buffer.read(enabled),
        )
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn separates_swapchains_and_does_not_invent_low_values() {
        let mut buffer = Buffer::default();
        buffer.reset(42);
        for index in 0..=1200 {
            buffer.present(0, 1, index * 100_000);
            if index % 2 == 0 {
                buffer.present(0, 2, index * 100_000);
            }
        }
        let fps = buffer.read(true);
        assert_eq!(fps.fps, Some(100.0));
        assert_eq!(fps.low1, Some(100.0));
        assert_eq!(fps.low01, Some(100.0));
        buffer.reset(43);
        buffer.present(0, 1, 1);
        buffer.present(0, 1, 100_001);
        assert_eq!(buffer.read(true).low1, None);
        assert_eq!(buffer.read(true).low01, None);
    }
    #[test]
    fn present_sources_are_not_summed_or_recounted() {
        let mut buffer = Buffer::default();
        buffer.reset(1);
        for index in 0..=120 {
            buffer.kernel_present(1, index * 100_000, Some(index as u64 + 1));
            buffer.kernel_present(2, index * 100_000 + 2000, None);
        }
        assert_eq!(buffer.read(true).fps, Some(100.0));
        let before = buffer.read(true).frame_count;
        buffer.kernel_present(1, 13_000_000, Some(121));
        assert_eq!(buffer.read(true).frame_count, before);
    }
}
