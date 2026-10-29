import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { z } from 'zod';
import type { HudLive } from '@/lib/hud-contracts';
import { executeHud, isDesktop, settingsAssetUrl } from '@/lib/desktop';
import { useSettingsUi } from '@/features/settings/ui-store';
import { useHud, useHudAction } from './repository';
import { HudView } from './HudView';

export default function HudWindow() {
  const query = useHud();
  const action = useHudAction();
  const ui = useSettingsUi();
  const [viewport, setViewport] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  const [closing, setClosing] = useState(false),
    [epoch, setEpoch] = useState(0),
    [now, setNow] = useState(Date.now);
  useEffect(() => {
    document.body.classList.add('hud-window');
    document.documentElement.classList.add('hud-document');
    const timer = setInterval(() => setNow(Date.now()), 2000);
    const sync = (event: StorageEvent) => {
      if (event.key === 'zhenjing.settings.ui') void useSettingsUi.persist.rehydrate();
    };
    window.addEventListener('storage', sync);
    const resize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', resize);
    const cleanups: (() => void)[] = [];
    let disposed = false;
    const add = (promise: Promise<() => void>) =>
      void promise
        .then((fn) => {
          if (disposed) fn();
          else cleanups.push(fn);
        })
        .catch(() => undefined);
    if (isDesktop()) {
      add(listen('hud-closing', () => setClosing(true)));
      add(
        listen('hud-enter', () => {
          setClosing(false);
          setEpoch((value) => value + 1);
        }),
      );
    }
    return () => {
      disposed = true;
      clearInterval(timer);
      document.body.classList.remove('hud-window');
      document.documentElement.classList.remove('hud-document');
      window.removeEventListener('storage', sync);
      window.removeEventListener('resize', resize);
      cleanups.forEach((fn) => fn());
    };
  }, []);
  useEffect(() => {
    const language = ui.language === 'system' ? navigator.language : ui.language;
    const locale = language.startsWith('zh')
      ? language.includes('TW') || language.includes('HK')
        ? 'zh-TW'
        : 'zh-CN'
      : language.startsWith('ja')
        ? 'ja'
        : language.startsWith('de')
          ? 'de'
          : language.startsWith('fr')
            ? 'fr'
            : 'en';
    if (isDesktop())
      void executeHud({ operation: 'locale', locale }, z.null()).catch(() => undefined);
  }, [ui.language]);
  useEffect(() => {
    if (!ui.font.startsWith('font:')) return;
    let alive = true;
    const face = new FontFace('ZhenjingHudCustom', `url("${settingsAssetUrl(ui.font.slice(5))}")`);
    void face
      .load()
      .then((font) => {
        if (alive) {
          document.fonts.add(font);
          document.body.style.setProperty(
            '--hud-font',
            'ZhenjingHudCustom, ZhenjingHudInter, MiSans, sans-serif',
          );
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      document.fonts.delete(face);
      document.body.style.removeProperty('--hud-font');
    };
  }, [ui.font]);
  if (!query.data) return null;
  const { config } = query.data;
  const stale = now - (query.data.live.capturedAt ?? 0) > 6500;
  const live: HudLive = stale ? { scene: '@waiting', game: false } : query.data.live;
  // 显示器工作区可能比用户设置小；使用实际视口缩放，避免高 DPI/小屏被原生窗口裁切。
  const fitted = {
    ...config,
    scale: Math.min(
      config.scale,
      viewport.width / (live.game ? 720 : 580),
      viewport.height / (180 * config.fontScale),
    ),
  };
  return (
    <main
      className="hud-window-surface"
      onClick={() => {
        if (!config.locked && config.clickToCycle) action.mutate({ operation: 'next' });
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        if (!config.locked) action.mutate({ operation: 'open-settings' });
      }}
    >
      <HudView config={fitted} live={live} closing={closing} epoch={epoch} />
      {!config.locked && (
        <div className="hud-window-controls" onClick={(event) => event.stopPropagation()}>
          <button
            type="button"
            title="拖动 HUD"
            onPointerDown={() => action.mutate({ operation: 'drag' })}
          >
            拖动
          </button>
          {live.scene === '@media' &&
            (['previous', 'play-pause', 'next'] as const).map((value, index) => (
              <button
                type="button"
                key={value}
                disabled={action.isPending}
                title={['上一曲', '播放 / 暂停', '下一曲'][index]}
                onClick={() => action.mutate({ operation: 'media', action: value })}
              >
                {['‹', live.media?.status === 'playing' ? 'Ⅱ' : '▶', '›'][index]}
              </button>
            ))}
          <button type="button" onClick={() => action.mutate({ operation: 'next' })}>
            轮播
          </button>
          <button type="button" onClick={() => action.mutate({ operation: 'remember' })}>
            保存位置
          </button>
          <button type="button" onClick={() => action.mutate({ operation: 'open-settings' })}>
            设置
          </button>
        </div>
      )}
      {(action.error || query.error || live.error) && (
        <small className="hud-window-error" role="status">
          {action.error?.message ?? query.error?.message ?? live.error}
        </small>
      )}
    </main>
  );
}
