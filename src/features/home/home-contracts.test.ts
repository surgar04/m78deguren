import { describe, expect, it } from 'vitest';
import { homeRequestSchema, homeSnapshotSchema } from '@/lib/home-contracts';
describe('首页 IPC 安全边界', () => {
  it('启动只接受登记 ID 及明确动作，不接受任意路径、参数或空确认', () => {
    const id = crypto.randomUUID();
    expect(homeRequestSchema.safeParse({ operation: 'launch', id, consent: true }).success).toBe(
      true,
    );
    for (const request of [
      { operation: 'launch', id, consent: false },
      { operation: 'launch', id, consent: true, path: 'C:/Windows/cmd.exe' },
      { operation: 'launch', id: '../../run.exe', consent: true },
      {
        operation: 'add',
        ticket: 'path.exe',
        name: '程序',
        isGame: false,
        revision: '0'.repeat(64),
      },
    ])
      expect(homeRequestSchema.safeParse(request).success).toBe(false);
  });
  it('单项策略不能顺带覆盖另一项设置', () => {
    expect(
      homeRequestSchema.safeParse({
        operation: 'policy',
        key: 'autoGameMode',
        enabled: true,
        consent: true,
      }).success,
    ).toBe(true);
    expect(
      homeRequestSchema.safeParse({
        operation: 'policy',
        key: 'autoGameMode',
        enabled: true,
        consent: true,
        disableWinInGame: true,
      }).success,
    ).toBe(false);
    expect(
      homeRequestSchema.safeParse({
        operation: 'policy',
        key: 'registry',
        enabled: true,
        consent: true,
      }).success,
    ).toBe(false);
  });
  it('排序拒绝重复 ID，服务快照不能用缺失值冒充真实数据', () => {
    const id = crypto.randomUUID();
    expect(
      homeRequestSchema.safeParse({ operation: 'reorder', ids: [id, id], revision: '0'.repeat(64) })
        .success,
    ).toBe(false);
    expect(
      homeSnapshotSchema.safeParse({
        username: '用户',
        shortcuts: [],
        runtime: { effective: true },
      }).success,
    ).toBe(false);
  });
});
