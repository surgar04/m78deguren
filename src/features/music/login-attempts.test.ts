import { expect, it, vi } from 'vitest';
import { createLoginAttempts } from '../../../integrations/folia-engine/login-attempts';

it('长授权串封装为短票据，不泄漏到界面查询键，并按原始标识取消', async () => {
  const cancel = vi.fn<(_provider: string, _key: string) => Promise<void>>().mockResolvedValue();
  const registry = createLoginAttempts(cancel),
    original = 'signed-opaque-value'.repeat(300);
  const id = registry.register('qq', original);
  expect(id.length).toBe(36);
  expect(id).not.toContain('signed');
  expect(registry.resolve('qq', id)).toBe(original);
  expect(() => registry.resolve('netease', id)).toThrow();
  await registry.cancel('qq', id);
  expect(cancel).toHaveBeenCalledWith('qq', original);
  await registry.cancel('qq', id);
  expect(cancel).toHaveBeenCalledTimes(1);
});
it('过期和多次尝试保持有界，并回收旧平台尝试', () => {
  let clock = 0;
  const cancel = vi.fn<(_provider: string, _key: string) => Promise<void>>().mockResolvedValue();
  const registry = createLoginAttempts(cancel, () => clock),
    first = registry.register('qq', 'first');
  for (let n = 0; n < 8; n++) registry.register('qq', `attempt-${n}`);
  expect(() => registry.resolve('qq', first)).toThrow();
  expect(cancel).toHaveBeenCalledWith('qq', 'first');
  const timed = registry.register('qq', 'timed');
  clock = 600001;
  expect(() => registry.resolve('qq', timed)).toThrow('过期');
});
