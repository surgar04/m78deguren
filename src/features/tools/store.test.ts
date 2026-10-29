import { beforeEach, describe, expect, it } from 'vitest';
import { useToolPreferences } from './store';

describe('工具偏好边界', () => {
  beforeEach(() => {
    localStorage.removeItem('zhenjing.tools.preferences');
    useToolPreferences.setState({ favorites: [], recent: [] });
  });
  it('打开同一工具去重并置顶，历史有界且不接受路径作为ID', () => {
    for (let index = 0; index < 60; index++)
      useToolPreferences.getState().recordOpen(`tool-${index}`);
    useToolPreferences.getState().recordOpen('tool-30');
    useToolPreferences.getState().recordOpen('C:\\invalid');
    expect(useToolPreferences.getState().recent).toHaveLength(50);
    expect(useToolPreferences.getState().recent[0]).toBe('tool-30');
    expect(new Set(useToolPreferences.getState().recent).size).toBe(50);
  });
  it('收藏可以清空，重新水合不注入演示收藏或复制业务文案', async () => {
    useToolPreferences.getState().toggleFavorite('crosshair');
    useToolPreferences.getState().toggleFavorite('crosshair');
    await useToolPreferences.persist.rehydrate();
    expect(useToolPreferences.getState().favorites).toEqual([]);
    expect(localStorage.getItem('zhenjing.tools.preferences')).not.toContain('辅助准心');
  });
  it('损坏字段安全回退并保留有效字段与动作', async () => {
    localStorage.setItem(
      'zhenjing.tools.preferences',
      JSON.stringify({
        state: { favorites: ['bad/path'], recent: ['time-sync', 'time-sync'] },
        version: 1,
      }),
    );
    await useToolPreferences.persist.rehydrate();
    expect(useToolPreferences.getState().favorites).toEqual([]);
    expect(useToolPreferences.getState().recent).toEqual(['time-sync']);
    expect(typeof useToolPreferences.getState().toggleFavorite).toBe('function');
  });
});
