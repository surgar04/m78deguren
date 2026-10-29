import { beforeEach, describe, expect, it } from 'vitest';
import { migrateLegacyPreferences } from './migrate-preferences';
describe('品牌迁移保留已有偏好', () => {
  beforeEach(() => localStorage.clear());
  it('只迁移已知有效 JSON，不覆盖新品牌设置且保留旧值', () => {
    localStorage.setItem('xinjing.settings.ui', '{"state":{"username":"玩家"},"version":1}');
    localStorage.setItem('xinjing.home.preferences', '{"state":{"favorites":["steam:730"]}}');
    localStorage.setItem('zhenjing.home.preferences', '{"state":{"favorites":[]}}');
    localStorage.setItem('xinjing.preferences', 'broken');
    localStorage.setItem('xinjing.unrelated', '{}');
    migrateLegacyPreferences(localStorage);
    expect(localStorage.getItem('zhenjing.settings.ui')).toBe(
      '{"state":{"username":"玩家"},"version":1}',
    );
    expect(localStorage.getItem('xinjing.settings.ui')).not.toBeNull();
    expect(localStorage.getItem('zhenjing.home.preferences')).toBe('{"state":{"favorites":[]}}');
    expect(localStorage.getItem('zhenjing.preferences')).toBeNull();
    expect(localStorage.getItem('zhenjing.unrelated')).toBeNull();
  });
});
