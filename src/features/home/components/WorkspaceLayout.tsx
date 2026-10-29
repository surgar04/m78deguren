import { useEffect, useRef, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { ACCENTS, usePreferences } from '@/stores/preferences';
import { Background } from '@/features/settings/Background';
import { SettingsRuntime, StartupLogo } from '@/features/settings/SettingsRuntime';
import { useSettingsUi } from '@/features/settings/ui-store';
import '@/features/settings/theme.css';
import { useHomePreferences } from '../store';
import type { GameWorkspaceController } from '../useGameWorkspace';
import { Dock, TopBar } from './DesktopChrome';
import { HomeDialogs } from './HomeDialogs';
import { UpdateNotice } from '@/features/settings/UpdateNotice';
import '../home.css';
import '../desktop-density.css';
import '../live-home.css';

gsap.registerPlugin(useGSAP);
function subscribeTheme(callback: () => void) {
  const media = matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', callback);
  return () => media.removeEventListener('change', callback);
}

/** 公共外壳维护导航、窗口与全局反馈，保证各页视觉和生命周期一致。 */
export function WorkspaceLayout({
  workspace,
  active,
  children,
}: {
  workspace: GameWorkspaceController;
  active: 'home' | 'library' | 'hardware' | 'tools' | 'optimization' | 'settings';
  children?: ReactNode;
}) {
  const container = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  const wallpaperDim = useHomePreferences((state) => state.wallpaperDim);
  const compact = usePreferences((state) => state.compact);
  const accent = usePreferences((state) => state.accent);
  const motion = usePreferences((state) => state.motion);
  const ui = useSettingsUi();
  const systemDark = useSyncExternalStore(
    subscribeTheme,
    () => matchMedia('(prefers-color-scheme: dark)').matches,
    () => false,
  );
  const palette = ACCENTS.find((entry) => entry.id === accent) ?? ACCENTS[0];
  const { query, dialog, setDialog, notify, toast } = workspace;
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
    // 同属工具页的详情路由也必须回到顶部，否则从列表底部打开工具会落到长表单中间。
    if (query.isSuccess)
      container.current
        ?.querySelector<HTMLElement>('#main-content')
        ?.focus({ preventScroll: true });
  }, [active, pathname, query.isSuccess]);
  useGSAP(
    () => {
      if (!query.data || motion === 'reduce') return;
      const media = gsap.matchMedia();
      // 只操作合成属性；减少动态效果时直接显示，StrictMode/卸载均清理。
      media.add(
        '(prefers-reduced-motion: no-preference)',
        () => {
          gsap.from('[data-home-enter]', {
            y: 10,
            opacity: 0,
            duration: 0.5,
            stagger: 0.055,
            ease: ui.elasticAnimation ? 'elastic.out(1, 0.7)' : 'power2.out',
            clearProps: 'all',
          });
        },
        container,
      );
      return () => media.revert();
    },
    {
      scope: container,
      dependencies: [query.isSuccess, motion, ui.elasticAnimation],
      revertOnUpdate: true,
    },
  );
  if (query.isError)
    return (
      <main className="page-loading">
        <p role="alert">页面暂时无法加载</p>
        <button
          type="button"
          className="mint-button"
          onClick={() => {
            void query.refetch();
          }}
        >
          重新加载
        </button>
      </main>
    );
  if (!query.data)
    return (
      <div className="page-loading" role="status">
        正在打开臻境…
      </div>
    );
  return (
    <div
      ref={container}
      data-accent={accent}
      data-motion={motion}
      data-theme={ui.theme === 'system' ? (systemDark ? 'dark' : 'light') : ui.theme}
      data-glass={ui.glassEnabled ? ui.glassMode : 'off'}
      data-nav={ui.navPosition}
      data-nav-labels={ui.navLabels}
      data-background={ui.backgroundMode}
      style={
        {
          '--home-mint': ui.customAccent ? `${ui.customAccent}b8` : palette.surface,
          '--home-accent': ui.customAccent ?? palette.color,
          '--glass-blur': `${ui.glassBlur}px`,
        } as CSSProperties
      }
      className={`home-layout ${active === 'library' ? 'library-page' : ''} ${active === 'hardware' ? 'hardware-page' : ''} ${active === 'tools' ? 'tools-page' : ''} ${wallpaperDim ? 'wallpaper-dim' : ''} ${compact ? 'compact' : ''}`}
    >
      <SettingsRuntime notify={notify} />
      <UpdateNotice />
      <StartupLogo />
      <Background accent={ui.customAccent ?? palette.color} />
      <Dock active={active} />
      <div className="home-workspace">
        <TopBar open={setDialog} notify={notify} />
        {children}
      </div>
      {dialog && (
        <HomeDialogs
          key={dialog.kind === 'shortcut' ? `${dialog.kind}-${dialog.id}` : dialog.kind}
          dialog={dialog}
          data={query.data}
          open={setDialog}
          notify={notify}
        />
      )}
      <div className={`home-toast ${toast ? 'visible' : ''}`} role="status" aria-live="polite">
        {toast}
      </div>
    </div>
  );
}
