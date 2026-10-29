//! 从同一份原始传感器快照提取摘要，匹配失败保留 null，不按型号补造数值。
use super::types::{Device, Gpu, Metrics, Sensor, WireMetrics};

/// 补齐操作系统识别但未提供传感器的适配器（例如虚拟显示驱动），不把它们伪装成有读数的 GPU。
pub fn complete_devices(gpus: &mut Vec<Gpu>, devices: &[Device]) {
    let mut represented = std::collections::HashMap::<String, usize>::new();
    for gpu in gpus.iter() {
        *represented
            .entry(gpu.name.trim().to_lowercase())
            .or_default() += 1;
    }
    for device in devices.iter().filter(|device| device.kind == "gpu") {
        let remaining = represented
            .entry(device.name.trim().to_lowercase())
            .or_default();
        if *remaining > 0 {
            *remaining -= 1;
        } else if gpus.len() < 32 {
            gpus.push(Gpu {
                id: device.id.clone(),
                name: device.name.clone(),
                metrics: Metrics::new(),
            });
        }
    }
}

fn value(sensors: &[&Sensor], kind: &str, names: &[&str]) -> Option<f64> {
    for name in names {
        if let Some(sensor) = sensors
            .iter()
            .find(|sensor| sensor.sensor_type == kind && sensor.name.eq_ignore_ascii_case(name))
            && let Some(value) = sensor.value.filter(|value| value.is_finite())
        {
            return Some(value);
        }
    }
    None
}
fn memory(sensors: &[&Sensor], names: &[&str]) -> Option<f64> {
    value(sensors, "Data", names)
        .or_else(|| value(sensors, "SmallData", names).map(|value| value / 1024.0))
}
pub fn summarize(sensors: &[Sensor], raw: WireMetrics) -> (Metrics, Vec<Gpu>, u32) {
    let cpu: Vec<_> = sensors
        .iter()
        .filter(|sensor| sensor.hardware_type == "Cpu")
        .collect();
    let mut metrics = Metrics::from([
        (
            "diskTemperature".into(),
            sensors
                .iter()
                .filter(|sensor| {
                    sensor.hardware_type == "Storage" && sensor.sensor_type == "Temperature"
                })
                .filter_map(|sensor| sensor.value)
                .reduce(f64::max),
        ),
        ("cpu".into(), raw.cpu),
        ("memory".into(), raw.memory),
        ("memoryUsed".into(), raw.memory_used),
        ("memoryTotal".into(), raw.memory_total),
        ("download".into(), raw.download),
        ("upload".into(), raw.upload),
        (
            "cpuTemperature".into(),
            value(
                &cpu,
                "Temperature",
                &[
                    "CPU Package",
                    "Core (Tctl/Tdie)",
                    "Core (Tdie)",
                    "CPU Core",
                    "CPU Cores (Average)",
                ],
            )
            .or_else(|| {
                cpu.iter()
                    .filter(|sensor| sensor.sensor_type == "Temperature")
                    .filter_map(|sensor| sensor.value)
                    .reduce(f64::max)
            }),
        ),
        (
            "cpuClock".into(),
            value(&cpu, "Clock", &["CPU Total", "CPU Core #1", "Core #1"]),
        ),
        (
            "cpuPower".into(),
            value(&cpu, "Power", &["CPU Package", "Package", "CPU Cores"]),
        ),
        (
            "cpuVoltage".into(),
            value(&cpu, "Voltage", &["CPU Core", "CPU Core #1", "CPU VCore"]),
        ),
        (
            "cpuFan".into(),
            value(&cpu, "Fan", &["CPU", "CPU Fan", "Fan #1"]),
        ),
    ]);
    // 少数 CPU 仅按核心命名频率，取真实核心平均值，避免把总线时钟当作 CPU 频率。
    if metrics["cpuClock"].is_none() {
        let clocks: Vec<_> = cpu
            .iter()
            .filter(|sensor| {
                sensor.sensor_type == "Clock" && sensor.name.to_ascii_lowercase().contains("core")
            })
            .filter_map(|sensor| sensor.value)
            .collect();
        if !clocks.is_empty() {
            metrics.insert(
                "cpuClock".into(),
                Some(clocks.iter().sum::<f64>() / clocks.len() as f64),
            );
        }
    }
    let mut groups = std::collections::BTreeMap::<&str, Vec<&Sensor>>::new();
    for sensor in sensors
        .iter()
        .filter(|sensor| sensor.hardware_type.starts_with("Gpu"))
    {
        groups.entry(&sensor.hardware_id).or_default().push(sensor);
    }
    let gpus = groups
        .into_iter()
        .take(32)
        .map(|(id, group)| Gpu {
            id: id.into(),
            name: group
                .first()
                .map_or(String::new(), |sensor| sensor.hardware.clone()),
            metrics: Metrics::from([
                (
                    "gpu".into(),
                    value(
                        &group,
                        "Load",
                        &["GPU Core", "D3D 3D", "GPU D3D 3D", "GPU Engine (Windows)"],
                    ),
                ),
                (
                    "gpuTemperature".into(),
                    value(&group, "Temperature", &["GPU Core", "GPU Temperature"]),
                ),
                (
                    "gpuClock".into(),
                    value(&group, "Clock", &["GPU Core", "GPU Clock"]),
                ),
                (
                    "gpuMemoryClock".into(),
                    value(&group, "Clock", &["GPU Memory"]),
                ),
                (
                    "gpuPower".into(),
                    value(
                        &group,
                        "Power",
                        &["GPU Package", "GPU Power", "GPU Board Power"],
                    ),
                ),
                (
                    "gpuFan".into(),
                    value(&group, "Fan", &["GPU Fan", "GPU Fan #1", "GPU"]),
                ),
                ("gpuVoltage".into(), value(&group, "Voltage", &["GPU Core"])),
                (
                    "vramUsed".into(),
                    memory(
                        &group,
                        &[
                            "GPU Memory Used",
                            "D3D Dedicated Memory Used",
                            "GPU Dedicated Memory Used (Windows)",
                        ],
                    ),
                ),
                (
                    "vramTotal".into(),
                    memory(&group, &["GPU Memory Total", "GPU Memory Total (DXGI)"]),
                ),
            ]),
        })
        .collect();
    (metrics, gpus, raw.process_id)
}
