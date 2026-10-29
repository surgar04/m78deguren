import { beforeEach, describe, expect, it } from 'vitest';
import { useOptimizationPreferences } from './store';
describe('优化草稿存储', () => {
  beforeEach(() => {
    localStorage.clear();
    useOptimizationPreferences.getState().clear();
  });
  it('草稿按 ID 去重，仅保存目标，不保存状态、路径或执行记录', () => {
    const store = useOptimizationPreferences.getState();
    store.stage({ id: 'gameMode', value: 'apply' });
    store.stage({ id: 'gameMode', value: 'restore' });
    store.stage({ id: 'bad/path', value: 'apply' });
    expect(useOptimizationPreferences.getState().drafts).toEqual([
      { id: 'gameMode', value: 'restore' },
    ]);
    store.replaceDrafts([{ id: 'showFileExtensions', value: 'apply' }]);
    expect(useOptimizationPreferences.getState().drafts).toEqual([
      { id: 'showFileExtensions', value: 'apply' },
    ]);
    expect(localStorage.getItem('zhenjing.optimization.preferences')).not.toContain('currentValue');
  });
  it('旧演示草稿迁移后清空，非法数据不能恢复为系统状态', async () => {
    localStorage.setItem(
      'zhenjing.optimization.preferences',
      JSON.stringify({ state: { drafts: [{ id: 'file-extensions', value: 'show' }] }, version: 1 }),
    );
    await useOptimizationPreferences.persist.rehydrate();
    expect(useOptimizationPreferences.getState().drafts).toEqual([]);
    useOptimizationPreferences.getState().stage({ id: 'disableDwmAnimations', value: 'apply' });
    await useOptimizationPreferences.persist.rehydrate();
    expect(useOptimizationPreferences.getState().drafts).toEqual([
      { id: 'disableDwmAnimations', value: 'apply' },
    ]);
    expect(typeof useOptimizationPreferences.getState().stage).toBe('function');
  });
});
