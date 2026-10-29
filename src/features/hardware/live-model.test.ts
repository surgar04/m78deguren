import { describe, expect, it } from 'vitest';
import { hardwareSnapshotSchema, hardwareRequestSchema } from '@/lib/hardware-contracts';
import { toHardwareSummary } from './live-model';

describe('真实硬件数据边界', () => {
  const data = hardwareSnapshotSchema.parse({
    status: 'ready',
    capturedAt: 1000,
    devices: [],
    sensors: [],
    metrics: { cpu: 12, memory: 50, memoryUsed: 4, memoryTotal: 8 },
    gpus: [
      { id: 'a', name: 'GPU A', metrics: { gpu: 14, vramTotal: 16 } },
      { id: 'b', name: 'GPU B', metrics: { gpu: null, vramTotal: null } },
    ],
    samples: [],
    fps: {
      enabled: false,
      processId: 0,
      fps: null,
      low1: null,
      low01: null,
      frameCount: 0,
      message: '',
    },
    recording: { count: 0, start: null, end: null, bytes: 0, error: null },
    warnings: [],
    privileged: false,
    processId: 0,
    processName: null,
  });
  it('按标识切换显卡，不把缺失读数或未知显存补成零', () => {
    expect(toHardwareSummary(data, 'a').gpu).toBe(14);
    expect(toHardwareSummary(data, 'a').graphics?.vramTotalGB).toBe(16);
    expect(toHardwareSummary(data, 'b').gpu).toBeNull();
    expect(toHardwareSummary(data, 'b').graphics?.vramTotalGB).toBeNull();
    expect(toHardwareSummary(undefined).cpu).toBeNull();
  });
  it('拒绝非有限读数、意外返回字段与未确认管理动作', () => {
    expect(hardwareSnapshotSchema.safeParse({ ...data, metrics: { cpu: Infinity } }).success).toBe(
      false,
    );
    expect(hardwareSnapshotSchema.safeParse({ ...data, command: 'powershell' }).success).toBe(
      false,
    );
    for (const request of [
      { operation: 'clear', consent: false },
      { operation: 'fps-start', pid: 0, consent: true },
      { operation: 'export', from: null, to: null, path: 'C:/x' },
    ])
      expect(hardwareRequestSchema.safeParse(request).success).toBe(false);
  });
});
