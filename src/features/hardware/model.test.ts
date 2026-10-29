import { describe, expect, it } from 'vitest';
import type { HardwareSnapshot } from './types';
import {
  memoryPercent,
  numberText,
  percent,
  samplesInWindow,
  seriesStats,
  unavailableHardware,
} from './model';

const fixture: HardwareSnapshot = {
  ...unavailableHardware(),
  available: true,
  source: 'live',
  capturedAt: 61000,
  cpu: 18,
  gpu: null,
  memoryUsed: 4,
  memoryTotal: 8,
  samples: Array.from({ length: 61 }, (_, index) => ({
    timestamp: 1000 + index * 1000,
    cpu: 18,
    gpu: null,
    memory: 50,
    cpuTemperature: null,
    gpuTemperature: null,
  })),
};
describe('硬件快照与历史边界', () => {
  it('窗口与仪表从同一份明确测试样本派生，不在渲染时补造读数', () => {
    const data = fixture;
    expect(data.samples).toHaveLength(61);
    expect(data.samples.at(-1)).toMatchObject({
      cpu: data.cpu,
      gpu: data.gpu,
      memory: memoryPercent(data),
      cpuTemperature: data.processor?.temperature ?? null,
      gpuTemperature: data.graphics?.temperature ?? null,
    });
  });
  it('数值缺失/非有限值不能变成0或写入图形，百分比限制在有效范围', () => {
    expect(percent(Number.NaN)).toBeNull();
    expect(percent(Infinity)).toBeNull();
    expect(percent(-2)).toBe(0);
    expect(percent(120)).toBe(100);
    expect(numberText(null, '%')).toBe('—');
    expect(numberText(undefined)).toBe('—');
    expect(numberText(47.5, '%')).toBe('47.5%');
    expect(memoryPercent(unavailableHardware())).toBeNull();
  });
  it('窗口以最后采样为锚，包含边界且不修改原序列', () => {
    const samples = [...fixture.samples].reverse();
    const before = samples.map((sample) => sample.timestamp);
    expect(samplesInWindow(samples, 30)).toHaveLength(31);
    expect(samplesInWindow(samples, 15)).toHaveLength(16);
    expect(samples.map((sample) => sample.timestamp)).toEqual(before);
    expect(samplesInWindow([], 60)).toEqual([]);
  });
  it('统计跳过不可用值，无有效读数时保留null', () => {
    const sample = fixture.samples[0];
    if (!sample) throw new Error('测试样本缺失');
    expect(
      seriesStats(
        [
          { ...sample, cpu: null },
          { ...sample, cpu: Number.NaN },
          { ...sample, cpu: 18 },
        ],
        'cpu',
      ),
    ).toEqual({ min: 18, max: 18 });
    expect(seriesStats([], 'gpu')).toEqual({ min: null, max: null });
  });
});
