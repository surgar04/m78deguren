import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_PREFERENCES, usePreferences } from './preferences';

describe('应用外观偏好边界', () => {
  beforeEach(() => {
    localStorage.clear();
    usePreferences.setState(DEFAULT_PREFERENCES);
  });
  it('迁移原v1紧凑偏好，补全默认强调色与动态效果', async () => {
    localStorage.setItem(
      'zhenjing.preferences',
      JSON.stringify({ version: 1, state: { compact: true } }),
    );
    await usePreferences.persist.rehydrate();
    expect(usePreferences.getState()).toMatchObject({
      compact: true,
      accent: 'mint',
      motion: 'system',
    });
  });
  it('逐字段回退损坏的存储，不覆盖动作', async () => {
    localStorage.setItem(
      'zhenjing.preferences',
      JSON.stringify({
        version: 1,
        state: { compact: 'yes', accent: 'sky', motion: 'invalid', toggleCompact: null },
      }),
    );
    await usePreferences.persist.rehydrate();
    expect(usePreferences.getState()).toMatchObject({
      compact: false,
      accent: 'sky',
      motion: 'system',
    });
    expect(typeof usePreferences.getState().toggleCompact).toBe('function');
  });
  it('拒绝未知输入，刷新恢复有效选项', async () => {
    usePreferences.getState().setAccent('lavender');
    usePreferences.getState().setMotion('reduce');
    usePreferences.getState().setAccent('arbitrary-css');
    usePreferences.getState().setMotion(null);
    await usePreferences.persist.rehydrate();
    expect(usePreferences.getState()).toMatchObject({ accent: 'lavender', motion: 'reduce' });
    const persisted: unknown = JSON.parse(localStorage.getItem('zhenjing.preferences') ?? '{}');
    expect(persisted).toEqual({
      version: 1,
      state: { compact: false, accent: 'lavender', motion: 'reduce' },
    });
  });
  it('恢复默认外观仅修改所属字段并保留动作', () => {
    usePreferences.getState().toggleCompact();
    usePreferences.getState().setAccent('sky');
    usePreferences.getState().resetAppearance();
    expect(usePreferences.getState()).toMatchObject(DEFAULT_PREFERENCES);
    expect(typeof usePreferences.getState().setAccent).toBe('function');
  });
});
