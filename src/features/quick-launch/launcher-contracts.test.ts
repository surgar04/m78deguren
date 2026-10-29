import { describe, it, expect } from 'vitest';
import {
  quickConfigSchema,
  quickRequestSchema,
  gamesRequestSchema,
  launchTargetSchema,
  targetKey,
} from '@/lib/launcher-contracts';
describe('原生快捷入口边界', () => {
  const config = {
    navigation: Array.from({ length: 8 }, () => null),
    wheel: {
      enabled: false,
      holdMs: 350,
      size: 420,
      opacity: 0.94,
      desktopOnly: true,
      position: 'cursor',
      slots: Array.from({ length: 8 }, () => null),
    },
  };
  it('始终固定八个槽位，拒绝脚本和自由路径', () => {
    expect(quickConfigSchema.safeParse(config).success).toBe(true);
    expect(quickConfigSchema.safeParse({ ...config, navigation: [null] }).success).toBe(false);
    expect(launchTargetSchema.safeParse({ kind: 'shortcut', id: 'D:/run.exe' }).success).toBe(
      false,
    );
    expect(launchTargetSchema.safeParse({ kind: 'tool', id: 'powershell' }).success).toBe(false);
    expect(quickRequestSchema.safeParse({ operation: 'navigation', index: 8 }).success).toBe(false);
  });
  it('限制原生样式范围并拒绝命令注入字段', () => {
    expect(
      quickConfigSchema.safeParse({ ...config, wheel: { ...config.wheel, holdMs: 0 } }).success,
    ).toBe(false);
    expect(
      quickConfigSchema.safeParse({ ...config, wheel: { ...config.wheel, opacity: NaN } }).success,
    ).toBe(false);
    expect(
      gamesRequestSchema.safeParse({ operation: 'scan', deep: true, path: 'D:/' }).success,
    ).toBe(false);
    expect(
      gamesRequestSchema.safeParse({ operation: 'region', id: crypto.randomUUID(), region: 'jp' })
        .success,
    ).toBe(true);
  });
  it('不同目标类型不会因 ID 相同而碰撞', () => {
    expect(targetKey({ kind: 'tool', id: 'crosshair' })).not.toBe(
      targetKey({ kind: 'tool-page', id: 'crosshair' }),
    );
  });
});
