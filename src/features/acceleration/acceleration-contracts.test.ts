import { describe, expect, it } from 'vitest';
import {
  accelerationRequestSchema,
  accelerationSnapshotSchema,
  isPreparationActive,
} from '@/lib/acceleration-contracts';

describe('官方客户端协作边界', () => {
  it('拒绝路径、命令行、任意网址和隐式确认', () => {
    for (const request of [
      { operation: 'open', path: 'D:\\fake.exe' },
      { operation: 'open', args: '--connect' },
      { operation: 'website', kind: 'https://fake.invalid/' },
      { operation: 'confirm', id: crypto.randomUUID(), consent: false },
      { operation: 'prepare', gameId: 'D:\\game.exe' },
    ])
      expect(accelerationRequestSchema.safeParse(request).success).toBe(false);
  });
  it('只接受单次会话确认和有界客户端候选', () => {
    expect(
      accelerationRequestSchema.parse({
        operation: 'confirm',
        id: crypto.randomUUID(),
        consent: true,
      }).operation,
    ).toBe('confirm');
    expect(
      accelerationRequestSchema.safeParse({
        operation: 'select',
        index: 8,
        hash: 'a'.repeat(64),
        revision: 'b'.repeat(64),
      }).success,
    ).toBe(false);
  });
  it('客户端运行不等于会话确认，更不包含推测 Ping', () => {
    const state = accelerationSnapshotSchema.parse({
      config: { client: null, remindOnExit: true },
      revision: 'a'.repeat(64),
      clients: [],
      clientRunning: true,
      session: null,
      warnings: [],
    });
    expect(isPreparationActive(state.session)).toBe(false);
    expect(
      accelerationSnapshotSchema.safeParse({ ...state, ping: 30, accelerated: true }).success,
    ).toBe(false);
  });
});
