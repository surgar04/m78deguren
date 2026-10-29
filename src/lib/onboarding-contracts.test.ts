import { describe, it, expect } from 'vitest';
import { setupRequestSchema, setupStatusSchema } from './onboarding-contracts';
describe('首次启动 IPC 边界', () => {
  it('安装必须带逐项确认，前端不能传安装路径或任意命令', () => {
    expect(
      setupRequestSchema.safeParse({
        operation: 'steam-install',
        token: 'not-a-ticket',
        drive: 'D',
        consent: true,
      }).success,
    ).toBe(false);
    expect(
      setupRequestSchema.safeParse({
        operation: 'steam-install',
        token: '56c15f2e-a3e1-4602-bffa-9a183b8115da',
        drive: 'D',
        consent: false,
      }).success,
    ).toBe(false);
    expect(
      setupRequestSchema.safeParse({
        operation: 'steam-install',
        token: '56c15f2e-a3e1-4602-bffa-9a183b8115da',
        drive: 'D & cmd',
        consent: true,
      }).success,
    ).toBe(false);
    expect(
      setupRequestSchema.safeParse({ operation: 'storage', script: 'arbitrary' }).success,
    ).toBe(false);
    expect(
      setupRequestSchema.safeParse({
        operation: 'driver-apply',
        id: '56c15f2e-a3e1-4602-bffa-9a183b8115da',
        consent: true,
      }).success,
    ).toBe(true);
  });
  it('Steam 本机身份只接受扫描账号格式，不接受密码', () => {
    expect(
      setupRequestSchema.safeParse({ operation: 'identity', steamId: '76561198000000001' }).success,
    ).toBe(true);
    expect(setupRequestSchema.safeParse({ operation: 'identity', steamId: null }).success).toBe(
      true,
    );
    expect(
      setupRequestSchema.safeParse({
        operation: 'identity',
        steamId: '76561198000000001',
        password: 'never',
      }).success,
    ).toBe(false);
    expect(
      setupRequestSchema.safeParse({ operation: 'identity', steamId: 'http://example.com' })
        .success,
    ).toBe(false);
  });
  it('响应不能夹带未知能力或省略受限模式', () => {
    expect(
      setupStatusSchema.safeParse({
        progress: { version: 1, complete: false, stage: 'storage', completed: [], identity: null },
        job: { phase: '', kind: '', message: '', restartRequired: false },
      }).success,
    ).toBe(false);
  });
});
