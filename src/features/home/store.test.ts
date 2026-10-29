import { beforeEach, describe, expect, it } from 'vitest';
import { useHomePreferences } from './store';
describe('首页界面偏好及旧演示状态迁移', () => {
  beforeEach(() => {
    localStorage.clear();
    useHomePreferences.setState({ favorites: [], wallpaperDim: false });
  });
  it('Steam 收藏可切换且拒绝未接入服务的旧演示 ID', () => {
    const state = useHomePreferences.getState();
    state.toggleFavorite('delta');
    expect(useHomePreferences.getState().favorites).toEqual([]);
    state.toggleFavorite('steam:730');
    expect(useHomePreferences.getState().favorites).toEqual(['steam:730']);
    state.toggleFavorite('steam:730');
    expect(useHomePreferences.getState().favorites).toEqual([]);
  });
  it('迁移保留真实收藏和壁纸偏好，移除模拟开关及演示收藏', async () => {
    localStorage.setItem(
      'zhenjing.home.preferences',
      JSON.stringify({
        version: 1,
        state: {
          favorites: ['delta', 'steam:730', 'steam:730'],
          wallpaperDim: true,
          gameMode: true,
          disableWin: true,
        },
      }),
    );
    await useHomePreferences.persist.rehydrate();
    const state = useHomePreferences.getState();
    expect(state.favorites).toEqual(['steam:730']);
    expect(state.wallpaperDim).toBe(true);
    expect(Reflect.has(state, 'gameMode')).toBe(false);
    expect(Reflect.has(state, 'disableWin')).toBe(false);
    expect(typeof state.toggleFavorite).toBe('function');
  });
  it('损坏的存储不会制造默认游戏或开启任何系统功能', async () => {
    localStorage.setItem(
      'zhenjing.home.preferences',
      JSON.stringify({ version: 2, state: 'invalid' }),
    );
    await useHomePreferences.persist.rehydrate();
    expect(useHomePreferences.getState().favorites).toEqual([]);
    expect(useHomePreferences.getState().wallpaperDim).toBe(false);
  });
});
