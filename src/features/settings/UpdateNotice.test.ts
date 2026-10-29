import { describe, expect, it } from 'vitest';
import { reminderVisible } from './update-reminder-model';
describe('真实更新提醒的去重与再次提醒规则', () => {
  it('稍后处理只隐藏相同版本相同阶段，下载就绪或新版本仍然提醒', () => {
    const dismissed = { version: '1.0.0', stage: 'available' as const, until: 2000 };
    expect(reminderVisible('1.0.0', 'available', dismissed, 1000)).toBe(false);
    expect(reminderVisible('1.0.0', 'ready', dismissed, 1000)).toBe(true);
    expect(reminderVisible('1.1.0', 'available', dismissed, 1000)).toBe(true);
    expect(reminderVisible('1.0.0', 'available', dismissed, 2000)).toBe(true);
    expect(reminderVisible('1.0.0', 'available', null, 1000)).toBe(true);
    expect(
      reminderVisible(
        '1.0.0',
        'available',
        { version: '1.0.0', stage: 'unverified', until: 2000 },
        1000,
      ),
    ).toBe(true);
  });
});
