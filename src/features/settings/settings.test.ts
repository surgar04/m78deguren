import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_UI_SETTINGS, useSettingsUi, uiSettingsSchema } from './ui-store';
import { resolveLocale, translate } from './i18n';
import { shortcutFromEvent } from './shortcut';
import { settingsRequestSchema } from '@/lib/settings-contracts';

describe('设置边界与唯一偏好来源', () => {
  beforeEach(() => useSettingsUi.setState(DEFAULT_UI_SETTINGS));
  it('拒绝隐藏恢复入口、重复导航和恶意素材路径', () => {
    useSettingsUi.getState().patch({ navVisible: ['home'] });
    expect(useSettingsUi.getState().navVisible).toEqual(DEFAULT_UI_SETTINGS.navVisible);
    expect(
      uiSettingsSchema.safeParse({ ...DEFAULT_UI_SETTINGS, navOrder: Array(6).fill('home') })
        .success,
    ).toBe(false);
    useSettingsUi.getState().patch({ backgroundAsset: 'C:/secrets.jpg' });
    expect(useSettingsUi.getState().backgroundAsset).toBeNull();
    useSettingsUi.getState().patch({ theme: undefined });
    expect(useSettingsUi.getState().theme).toBe('light');
  });
  it('外观重置保留用户名和导航，拒绝动作字段注入', () => {
    useSettingsUi
      .getState()
      .patch({ username: '旅行者', navPosition: 'top', theme: 'dark', patch: 'override' });
    expect(useSettingsUi.getState().username).toBe('');
    useSettingsUi.getState().patch({ username: '旅行者', navPosition: 'top', theme: 'dark' });
    useSettingsUi.getState().resetAppearance();
    expect(useSettingsUi.getState().username).toBe('旅行者');
    expect(useSettingsUi.getState().navPosition).toBe('top');
    expect(useSettingsUi.getState().theme).toBe('light');
  });
  it('系统区域映射覆盖六种语言，繁体和不支持的区域有确定结果', () => {
    expect(resolveLocale('system', 'zh-Hant-TW')).toBe('zh-TW');
    expect(resolveLocale('system', 'zh-HK')).toBe('zh-TW');
    expect(resolveLocale('system', 'ja-JP')).toBe('ja');
    expect(resolveLocale('system', 'xx')).toBe('en');
    for (const locale of ['zh-CN', 'zh-TW', 'en', 'ja', 'de', 'fr'] as const)
      expect(translate('设置', locale).length).toBeGreaterThan(0);
  });
  it('录制物理键位，拒绝单独字母与重复事件', () => {
    expect(
      shortcutFromEvent(
        new KeyboardEvent('keydown', { code: 'KeyC', key: 'c', ctrlKey: true, altKey: true }),
      ),
    ).toBe('Ctrl+Alt+C');
    expect(shortcutFromEvent(new KeyboardEvent('keydown', { code: 'F8', key: 'F8' }))).toBe('F8');
    expect(shortcutFromEvent(new KeyboardEvent('keydown', { code: 'KeyA', key: 'a' }))).toBeNull();
    expect(
      shortcutFromEvent(new KeyboardEvent('keydown', { code: 'F8', repeat: true })),
    ).toBeNull();
  });
  it('重置、驱动与更新 IPC 必须明确确认且不接受任意路径', () => {
    expect(
      settingsRequestSchema.safeParse({
        operation: 'pawn-apply',
        token: crypto.randomUUID(),
        install: true,
        consent: false,
      }).success,
    ).toBe(false);
    expect(
      settingsRequestSchema.safeParse({
        operation: 'update-apply',
        token: crypto.randomUUID(),
        consent: true,
        path: 'C:/payload.exe',
      }).success,
    ).toBe(false);
    expect(
      settingsRequestSchema.safeParse({
        operation: 'reset-apply',
        token: crypto.randomUUID(),
        consent: true,
        confirmation: 'yes',
      }).success,
    ).toBe(false);
  });
});
