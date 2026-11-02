import { describe, expect, it } from 'vitest';
import { requiresConfirmation } from './confirmation-policy';

describe('二次确认的受限省略策略', () => {
  it.each([
    'game-mode',
    'shortcut-remove',
    'cache-clear',
    'hardware-history-clear',
    'steam-install',
    'steam-uninstall',
  ])('%s 只有显式关闭偏好才省略', (operation) => {
    expect(requiresConfirmation(false, operation)).toBe(false);
    expect(requiresConfirmation(true, operation)).toBe(true);
    expect(requiresConfirmation(undefined, operation)).toBe(true);
  });
  it.each([
    'system-change',
    'runtime-install',
    'account-switch',
    'account-remove',
    'data-reset',
    'driver-install',
    'future-action',
  ])('%s 不受普通开关影响', (operation) => {
    expect(requiresConfirmation(false, operation)).toBe(true);
  });
});
