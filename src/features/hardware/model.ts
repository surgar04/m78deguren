import type { HardwareSample, HardwareSeriesKey, HardwareSnapshot } from './types';

/** 无数据模式的结构缺省值，不含设备型号、演示序列或业务种子。 */
export function unavailableHardware(): HardwareSnapshot {
  return {
    available: false,
    source: 'unavailable',
    capturedAt: null,
    sampleIntervalMs: null,
    cpu: null,
    gpu: null,
    memoryUsed: null,
    memoryTotal: null,
    processor: null,
    graphics: null,
    memoryInfo: null,
    motherboard: null,
    disk: null,
    operatingSystem: null,
    network: null,
    currentGame: null,
    samples: [],
  };
}

/** 所有仪表与图表共用数值约束，NaN/无穷值不能进入Canvas或ARIA属性。 */
export function percent(value: number | null): number | null {
  return value !== null && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : null;
}
export function memoryPercent(data: HardwareSnapshot): number | null {
  return data.available &&
    data.memoryTotal !== null &&
    data.memoryUsed !== null &&
    data.memoryTotal > 0
    ? percent((data.memoryUsed / data.memoryTotal) * 100)
    : null;
}
export function numberText(value: number | null | undefined, suffix = '', precision = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${Number(value.toFixed(precision))}${suffix}`;
}

/** 以最后一个有效采样时间为锚，切换窗口不改变或补造历史样本。 */
export function samplesInWindow(
  samples: readonly HardwareSample[],
  seconds: number,
): HardwareSample[] {
  const finite = samples
    .filter((sample) => Number.isFinite(sample.timestamp))
    .sort((a, b) => a.timestamp - b.timestamp);
  const end = finite.at(-1)?.timestamp;
  if (end === undefined) return [];
  return finite.filter((sample) => sample.timestamp >= end - seconds * 1000);
}
export function seriesStats(
  samples: readonly HardwareSample[],
  key: HardwareSeriesKey | 'cpuTemperature' | 'gpuTemperature',
) {
  const values = samples.flatMap((sample) => {
    const value = sample[key];
    return value !== null && Number.isFinite(value) ? [value] : [];
  });
  return {
    min: values.length ? Math.min(...values) : null,
    max: values.length ? Math.max(...values) : null,
  };
}
