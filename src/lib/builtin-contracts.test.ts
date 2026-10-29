import { describe, expect, it } from 'vitest';
import {
  builtinRequestSchema,
  eqConfigSchema,
  systemChangeSchema,
  type EqConfig,
} from './builtin-contracts';
import { eqResponse, frequencies } from '@/features/tools/native/eq-model';

const flat: EqConfig = {
  enabled: true,
  preamp: 0,
  headroom: false,
  bands: frequencies(10).map((frequency) => ({ frequency, gain: 0 })),
  effects: { clarity: 0, bass: 0, width: 0, ambience: 0, dynamics: 0 },
};
describe('扩展工具的输入边界', () => {
  it('拒绝任意系统路径、越界设置和缺少确认的修改', () => {
    for (const value of [
      { kind: 'gpu-rename', id: 'a'.repeat(64), name: 'name\ncommand' },
      { kind: 'nvidia', scope: 'arbitrary', settings: [{ id: 1, value: 2 }] },
      {
        kind: 'feature',
        store: 0,
        id: 1,
        priority: 0,
        state: 2,
        variant: 0,
        payloadKind: 0,
        payload: 0,
        reset: false,
      },
      { kind: 'restore', id: '../backup.json' },
      { kind: 'gpu-restart', command: 'powershell' },
    ])
      expect(systemChangeSchema.safeParse(value).success).toBe(false);
    expect(
      builtinRequestSchema.safeParse({
        operation: 'display-switch',
        target: { id: 'a'.repeat(64), width: 1920, height: 1080, refresh: 60 },
        consent: false,
      }).success,
    ).toBe(false);
    expect(
      builtinRequestSchema.safeParse({
        operation: 'filter-recover',
        id: crypto.randomUUID(),
        consent: false,
      }).success,
    ).toBe(false);
  });
  it('EQ 拒绝乱序频率、重复频率和非有限增益', () => {
    expect(eqConfigSchema.safeParse(flat).success).toBe(true);
    expect(eqConfigSchema.safeParse({ ...flat, bands: [...flat.bands].reverse() }).success).toBe(
      false,
    );
    expect(
      eqConfigSchema.safeParse({
        ...flat,
        bands: flat.bands.map(() => ({ frequency: 100, gain: 0 })),
      }).success,
    ).toBe(false);
    expect(eqConfigSchema.safeParse({ ...flat, preamp: Infinity }).success).toBe(false);
  });
});
describe('EQ 响应图与可选频段', () => {
  it('平直预设为零 dB，单个中心频段达到指定增益', () => {
    for (const f of [20, 100, 1000, 16000]) expect(eqResponse(flat, f)).toBeCloseTo(0, 7);
    const boosted = {
      ...flat,
      bands: flat.bands.map((band) => ({ ...band, gain: band.frequency === 1000 ? 6 : 0 })),
    };
    expect(eqResponse(boosted, 1000)).toBeCloseTo(6, 6);
    expect(eqResponse({ ...boosted, headroom: true }, 1000)).toBeCloseTo(0, 6);
  });
  it('所有支持的频段数量覆盖合法音频范围且严格递增', () => {
    for (const count of [5, 10, 15, 20, 31]) {
      const values = frequencies(count);
      expect(values).toHaveLength(count);
      expect(
        values.every(
          (frequency, index) =>
            frequency >= 20 &&
            frequency <= 20000 &&
            (index === 0 || frequency > (values[index - 1] ?? 0)),
        ),
      ).toBe(true);
    }
  });
});
