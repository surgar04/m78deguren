import type { LiveHardware, HardwareDevice } from '@/lib/hardware-contracts';
import type { HardwareSnapshot } from './types';
import { unavailableHardware } from './model';

export const DEVICE_KINDS = {
  cpu: 'CPU',
  gpu: 'GPU',
  memory: '内存条',
  motherboard: '主板',
  bios: 'BIOS',
  disk: '物理磁盘',
  volume: '分区',
  audio: '声卡',
  network: '网卡',
  monitor: '显示器',
  os: '操作系统',
} as const;
export function field(device: HardwareDevice | undefined, name: string): string | null {
  return device?.fields.find((field) => field.label === name)?.value ?? null;
}
function numeric(device: HardwareDevice | undefined, name: string): number | null {
  const value = field(device, name);
  if (value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}
export function toHardwareSummary(
  data: LiveHardware | undefined,
  selectedGpu?: string,
): HardwareSnapshot {
  const empty = unavailableHardware();
  if (!data) return empty;
  const cpu = data.devices.find((device) => device.kind === 'cpu');
  const gpu = data.gpus.find((gpu) => gpu.id === selectedGpu) ?? data.gpus[0];
  const memory = data.devices.find((device) => device.kind === 'memory');
  const volume =
    data.devices.find((device) => device.kind === 'volume' && device.name.startsWith('D:')) ??
    data.devices.find((device) => device.kind === 'volume');
  const total = numeric(volume, '总容量 (bytes)'),
    free = numeric(volume, '可用容量 (bytes)');
  const value = (name: string) => data.metrics[name] ?? null;
  return {
    ...empty,
    available: ['ready', 'degraded'].includes(data.status),
    source: 'live',
    capturedAt: data.capturedAt,
    sampleIntervalMs: 1000,
    cpu: value('cpu'),
    gpu: gpu?.metrics['gpu'] ?? null,
    memoryUsed: value('memoryUsed'),
    memoryTotal: value('memoryTotal'),
    processor: cpu
      ? {
          model: cpu.name,
          cores: numeric(cpu, '核心数'),
          threads: numeric(cpu, '线程数'),
          temperature: value('cpuTemperature'),
          frequencyGHz: value('cpuClock') === null ? null : (value('cpuClock') ?? 0) / 1000,
          powerW: value('cpuPower'),
        }
      : null,
    graphics: gpu
      ? {
          model: gpu.name,
          temperature: gpu.metrics['gpuTemperature'] ?? null,
          vramUsedGB: gpu.metrics['vramUsed'] ?? null,
          vramTotalGB: gpu.metrics['vramTotal'] ?? null,
          memoryType: '',
          fanRpm: gpu.metrics['gpuFan'] ?? null,
        }
      : null,
    memoryInfo: memory
      ? {
          kind: field(memory, '内存类型') ?? '内存',
          speedMTs: numeric(memory, '当前速率 (MT/s)') ?? numeric(memory, '标称速率 (MT/s)'),
        }
      : null,
    motherboard: data.devices.find((device) => device.kind === 'motherboard')?.name ?? null,
    disk:
      volume && total !== null && free !== null
        ? {
            label: volume.name,
            kind: field(volume, '文件系统') ?? '',
            totalGB: total / 1e9,
            usedGB: (total - free) / 1e9,
          }
        : null,
    operatingSystem: data.devices.find((device) => device.kind === 'os')?.name ?? null,
    network: {
      downloadMBps: value('download'),
      uploadKBps: value('upload') === null ? null : (value('upload') ?? 0) * 1024,
    },
    currentGame: data.processName,
    samples: data.samples.map((sample) => ({
      timestamp: sample.timestamp,
      cpu: sample.metrics['cpu'] ?? null,
      memory: sample.metrics['memory'] ?? null,
      gpu: sample.gpus.find((card) => card.id === gpu?.id)?.metrics['gpu'] ?? null,
      cpuTemperature: sample.metrics['cpuTemperature'] ?? null,
      gpuTemperature:
        sample.gpus.find((card) => card.id === gpu?.id)?.metrics['gpuTemperature'] ?? null,
    })),
  };
}
