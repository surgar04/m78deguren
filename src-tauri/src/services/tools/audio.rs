//! 独立音频线程拥有 WASAPI 流；IPC 只更新参数与控制状态。回调通过无锁环形队列传递立体声帧。
use super::{
    Result,
    audio_dsp::{EqConfig, Parameters, Processor},
    error, save_json,
};
use arc_swap::ArcSwap;
use cpal::{
    SampleFormat, SupportedStreamConfig,
    traits::{DeviceTrait, HostTrait, StreamTrait},
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering},
    },
    thread,
    time::Duration,
};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    pub id: String,
    pub name: String,
    pub flow: String,
    pub virtual_device: bool,
    pub default_device: bool,
    pub sample_rate: u32,
    pub channels: u16,
}
#[derive(Default)]
struct Statistics {
    running: AtomicBool,
    stop: AtomicBool,
    underruns: AtomicU64,
    dropped: AtomicU64,
    peak: AtomicU32,
    message: Mutex<String>,
}
impl Statistics {
    fn failure(&self, value: String) {
        self.running.store(false, Ordering::Release);
        if let Ok(mut message) = self.message.lock() {
            *message = value;
        }
    }
}
struct Engine {
    parameters: Arc<ArcSwap<Parameters>>,
    rate: u32,
    statistics: Arc<Statistics>,
    thread: thread::JoinHandle<()>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub config: EqConfig,
    pub devices: Vec<Device>,
    pub running: bool,
    pub underruns: u64,
    pub dropped: u64,
    pub peak: f32,
    pub message: String,
}
pub struct AudioService {
    file: PathBuf,
    config: tokio::sync::Mutex<EqConfig>,
    engine: Arc<Mutex<Option<Engine>>>,
    serial: tokio::sync::Mutex<()>,
}
fn device_id(device: &cpal::Device, flow: &str) -> Result<String> {
    let id = device.id().map_err(|_| error("无法读取音频设备标识"))?;
    Ok(format!("{:x}", Sha256::digest(format!("{flow}|{id}"))))
}
fn virtual_device(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    ["fxsound", "virtual", "cable", "voicemeeter"]
        .iter()
        .any(|part| name.contains(part))
}
fn devices() -> Result<Vec<Device>> {
    let host = cpal::default_host();
    let mut rows = Vec::new();
    let default = host
        .default_output_device()
        .and_then(|value| value.id().ok());
    for flow in ["loopback", "capture"] {
        let devices = if flow == "loopback" {
            host.output_devices()
        } else {
            host.input_devices()
        }
        .map_err(|cause| error(format!("音频设备枚举失败：{cause}")))?;
        for device in devices.take(128) {
            let config = if flow == "loopback" {
                device.default_output_config()
            } else {
                device.default_input_config()
            };
            let Ok(config) = config else {
                continue;
            };
            let name = device
                .description()
                .map(|value| value.name().to_owned())
                .unwrap_or_else(|_| "未命名设备".into());
            rows.push(Device {
                id: device_id(&device, flow)?,
                virtual_device: virtual_device(&name),
                default_device: device.id().ok() == default,
                name,
                flow: flow.into(),
                sample_rate: config.sample_rate(),
                channels: config.channels(),
            });
        }
    }
    Ok(rows)
}
fn selected(host: &cpal::Host, id: &str, flow: &str) -> Result<cpal::Device> {
    host.devices()
        .map_err(|_| error("无法访问音频设备"))?
        .find(|device| device_id(device, flow).is_ok_and(|value| value == id))
        .ok_or_else(|| error("所选音频设备已断开，请重新扫描"))
}
impl AudioService {
    pub fn load(root: &Path) -> Self {
        let file = root.join("audio-eq.json");
        let config = std::fs::read(&file)
            .ok()
            .and_then(|value| serde_json::from_slice::<EqConfig>(&value).ok())
            .filter(|value| value.validate().is_ok())
            .unwrap_or_default();
        Self {
            file,
            config: tokio::sync::Mutex::new(config),
            engine: Arc::new(Mutex::new(None)),
            serial: tokio::sync::Mutex::new(()),
        }
    }
    pub async fn snapshot(&self) -> Result<Snapshot> {
        let config = self.config.lock().await.clone();
        let engine = self.engine.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let devices = devices()?;
            let engine = engine.lock().map_err(|_| error("音频服务状态不可用"))?;
            let stats = engine.as_ref().map(|value| &value.statistics);
            Ok(Snapshot {
                config,
                devices,
                running: stats.is_some_and(|value| value.running.load(Ordering::Acquire)),
                underruns: stats.map_or(0, |v| v.underruns.load(Ordering::Relaxed)),
                dropped: stats.map_or(0, |v| v.dropped.load(Ordering::Relaxed)),
                peak: stats.map_or(0.0, |v| f32::from_bits(v.peak.load(Ordering::Relaxed))),
                message: stats
                    .and_then(|v| v.message.lock().ok().map(|v| v.clone()))
                    .unwrap_or_default(),
            })
        })
        .await
        .map_err(|_| error("音频查询线程异常"))?
    }
    pub async fn configure(&self, config: EqConfig) -> Result<()> {
        config.validate()?;
        let _guard = self.serial.lock().await;
        save_json(&self.file, &config).await?;
        if let Some(engine) = self
            .engine
            .lock()
            .map_err(|_| error("音频服务状态不可用"))?
            .as_ref()
        {
            engine
                .parameters
                .store(Arc::new(Parameters::compile(&config, engine.rate)));
        }
        *self.config.lock().await = config;
        Ok(())
    }
    pub async fn stop(&self) -> Result<()> {
        let _guard = self.serial.lock().await;
        self.stop_inner().await
    }
    async fn stop_inner(&self) -> Result<()> {
        let engine = self
            .engine
            .lock()
            .map_err(|_| error("音频服务状态不可用"))?
            .take();
        if let Some(engine) = engine {
            engine.statistics.stop.store(true, Ordering::Release);
            tauri::async_runtime::spawn_blocking(move || engine.thread.join())
                .await
                .map_err(|_| error("音频关闭任务异常"))?
                .map_err(|_| error("音频线程异常退出"))?;
        }
        Ok(())
    }
    pub async fn start(
        &self,
        input: String,
        output: String,
        capture: bool,
        consent: bool,
    ) -> Result<()> {
        if !consent
            || input.len() != 64
            || output.len() != 64
            || !input
                .bytes()
                .chain(output.bytes())
                .all(|value| value.is_ascii_hexdigit())
        {
            return Err(error("必须确认有效的音频输入与输出设备"));
        }
        let _guard = self.serial.lock().await;
        self.stop_inner().await?;
        let config = self.config.lock().await.clone();
        let holder = self.engine.clone();
        let statistics = Arc::new(Statistics::default());
        let thread_stats = statistics.clone();
        let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();
        let thread = thread::Builder::new()
            .name("zhenjing-audio".into())
            .spawn(move || {
                match open_streams(input, output, capture, config, thread_stats.clone()) {
                    Ok((input, output, parameters, rate)) => {
                        thread_stats.running.store(true, Ordering::Release);
                        if ready_tx.send(Ok((parameters, rate))).is_err() {
                            return;
                        }
                        while !thread_stats.stop.load(Ordering::Acquire)
                            && thread_stats.running.load(Ordering::Acquire)
                        {
                            thread::sleep(Duration::from_millis(25));
                        }
                        drop(input);
                        drop(output);
                        thread_stats.running.store(false, Ordering::Release);
                    }
                    Err(cause) => {
                        thread_stats.failure(cause.to_string());
                        let _ = ready_tx.send(Err(cause));
                    }
                }
            })
            .map_err(|_| error("无法创建音频线程"))?;
        match tokio::time::timeout(Duration::from_secs(15), ready_rx).await {
            Ok(Ok(Ok((parameters, rate)))) => {
                *holder.lock().map_err(|_| error("音频服务状态不可用"))? = Some(Engine {
                    parameters,
                    rate,
                    statistics,
                    thread,
                });
                Ok(())
            }
            result => {
                statistics.stop.store(true, Ordering::Release);
                tokio::task::spawn_blocking(move || {
                    let _ = thread.join();
                });
                match result {
                    Ok(Ok(Err(cause))) => Err(cause),
                    _ => Err(error("音频设备打开超时或已失效")),
                }
            }
        }
    }
}

type Streams = (cpal::Stream, cpal::Stream, Arc<ArcSwap<Parameters>>, u32);
fn open_streams(
    input: String,
    output: String,
    capture: bool,
    config: EqConfig,
    stats: Arc<Statistics>,
) -> Result<Streams> {
    let host = cpal::default_host();
    let source = selected(&host, &input, if capture { "capture" } else { "loopback" })?;
    let sink = selected(&host, &output, "loopback")?;
    if source.id().ok() == sink.id().ok() {
        return Err(error("输入与输出不能是同一设备，否则会形成音频反馈"));
    }
    let input_config = if capture {
        source.default_input_config()
    } else {
        source.default_output_config()
    }
    .map_err(|_| error("源设备格式不可用"))?;
    let output_config = sink
        .default_output_config()
        .map_err(|_| error("输出设备格式不可用"))?;
    if input_config.channels() == 0
        || output_config.channels() == 0
        || input_config.channels() > 32
        || output_config.channels() > 32
    {
        return Err(error("设备声道配置不受支持"));
    }
    let input_rate = input_config.sample_rate();
    let rate = output_config.sample_rate();
    let capacity = (input_rate as usize / 4).max(1024);
    let (mut producer, consumer) = rtrb::RingBuffer::<[f32; 2]>::new(capacity);
    let target = input_rate as usize * 60 / 1000;
    for _ in 0..target {
        let _ = producer.push([0.0; 2]);
    }
    let input = match input_config.sample_format() {
        SampleFormat::F32 => input_stream::<f32>(&source, input_config, producer, stats.clone()),
        SampleFormat::I16 => input_stream::<i16>(&source, input_config, producer, stats.clone()),
        SampleFormat::I32 => input_stream::<i32>(&source, input_config, producer, stats.clone()),
        SampleFormat::F64 => input_stream::<f64>(&source, input_config, producer, stats.clone()),
        _ => return Err(error("源设备采样格式不受支持")),
    }?;
    let parameters = Arc::new(ArcSwap::from_pointee(Parameters::compile(&config, rate)));
    let output = match output_config.sample_format() {
        SampleFormat::F32 => output_stream::<f32>(
            &sink,
            output_config,
            consumer,
            parameters.clone(),
            stats.clone(),
            input_rate,
            target,
        ),
        SampleFormat::I16 => output_stream::<i16>(
            &sink,
            output_config,
            consumer,
            parameters.clone(),
            stats.clone(),
            input_rate,
            target,
        ),
        SampleFormat::I32 => output_stream::<i32>(
            &sink,
            output_config,
            consumer,
            parameters.clone(),
            stats.clone(),
            input_rate,
            target,
        ),
        SampleFormat::F64 => output_stream::<f64>(
            &sink,
            output_config,
            consumer,
            parameters.clone(),
            stats.clone(),
            input_rate,
            target,
        ),
        _ => return Err(error("输出设备采样格式不受支持")),
    }?;
    input
        .play()
        .map_err(|cause| error(format!("启动音频捕获失败：{cause}")))?;
    output
        .play()
        .map_err(|cause| error(format!("启动音频输出失败：{cause}")))?;
    Ok((input, output, parameters, rate))
}
fn input_stream<T>(
    device: &cpal::Device,
    config: SupportedStreamConfig,
    mut producer: rtrb::Producer<[f32; 2]>,
    stats: Arc<Statistics>,
) -> Result<cpal::Stream>
where
    T: cpal::SizedSample,
    f32: cpal::FromSample<T>,
{
    let channels = usize::from(config.channels());
    let failed = stats.clone();
    device
        .build_input_stream(
            config.into(),
            move |data: &[T], _| {
                for frame in data.chunks_exact(channels) {
                    let left = <f32 as cpal::FromSample<T>>::from_sample_(frame[0]);
                    let right = if channels > 1 {
                        <f32 as cpal::FromSample<T>>::from_sample_(frame[1])
                    } else {
                        left
                    };
                    if producer.push([left, right]).is_err() {
                        stats.dropped.fetch_add(1, Ordering::Relaxed);
                    }
                }
            },
            move |cause| failed.failure(format!("音频输入已中断：{cause}")),
            None,
        )
        .map_err(|cause| error(format!("无法打开输入：{cause}")))
}
fn output_stream<T>(
    device: &cpal::Device,
    config: SupportedStreamConfig,
    mut consumer: rtrb::Consumer<[f32; 2]>,
    parameters: Arc<ArcSwap<Parameters>>,
    stats: Arc<Statistics>,
    input_rate: u32,
    target: usize,
) -> Result<cpal::Stream>
where
    T: cpal::SizedSample + cpal::FromSample<f32>,
{
    let channels = usize::from(config.channels());
    let rate = config.sample_rate();
    let failed = stats.clone();
    let mut processor = Processor::new(rate);
    let mut first = [0.0; 2];
    let mut second = [0.0; 2];
    let mut phase = 0.0;
    device
        .build_output_stream(
            config.into(),
            move |data: &mut [T], _| {
                let parameters = parameters.load();
                let drift = ((consumer.slots() as f64 - target as f64) / target.max(1) as f64)
                    .clamp(-1.0, 1.0)
                    * 0.002;
                let ratio = f64::from(input_rate) / f64::from(rate) * (1.0 + drift);
                let mut peak = 0_f32;
                for frame in data.chunks_exact_mut(channels) {
                    let stereo = [
                        first[0] + (second[0] - first[0]) * phase as f32,
                        first[1] + (second[1] - first[1]) * phase as f32,
                    ];
                    let processed = processor.process(stereo, &parameters);
                    peak = peak.max(processed[0].abs()).max(processed[1].abs());
                    for (index, sample) in frame.iter_mut().enumerate() {
                        let value = if channels == 1 {
                            (processed[0] + processed[1]) * 0.5
                        } else if index < 2 {
                            processed[index]
                        } else {
                            0.0
                        };
                        *sample = T::from_sample_(value);
                    }
                    phase += ratio;
                    while phase >= 1.0 {
                        first = second;
                        second = consumer.pop().unwrap_or_else(|_| {
                            stats.underruns.fetch_add(1, Ordering::Relaxed);
                            [0.0; 2]
                        });
                        phase -= 1.0;
                    }
                }
                stats.peak.store(peak.to_bits(), Ordering::Relaxed);
            },
            move |cause| failed.failure(format!("音频输出已中断：{cause}")),
            None,
        )
        .map_err(|cause| error(format!("无法打开输出：{cause}")))
}
