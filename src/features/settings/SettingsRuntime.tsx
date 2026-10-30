import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { listen } from '@tauri-apps/api/event';
import { z } from 'zod';
import { executeSettings, isDesktop, settingsAssetUrl, errorMessage } from '@/lib/desktop';
import { useSettingsSnapshot } from './repository';
import { useSettingsUi } from './ui-store';
import { useText } from './i18n';

let bootAcknowledged = false;
/** 原生事件只使 Query 失效；辅助窗口通过 storage 事件同步 UI，不复制原生配置。 */
export function SettingsRuntime({ notify }: { notify: (message: string) => void }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const snapshot = useSettingsSnapshot();
  const ui = useSettingsUi();
  const { locale } = useText();
  const notifyRef = useRef(notify);
  useEffect(() => {
    notifyRef.current = notify;
  }, [notify]);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === 'zhenjing.settings.ui') void useSettingsUi.persist.rehydrate();
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  useEffect(() => {
    if (!isDesktop()) return;
    let disposed = false;
    const cleanups: (() => void)[] = [];
    const add = (promise: Promise<() => void>) => {
      void promise
        .then((unlisten) => {
          if (disposed) unlisten();
          else cleanups.push(unlisten);
        })
        .catch((error) => notifyRef.current(errorMessage(error)));
    };
    add(
      listen('settings-native-changed', () => {
        void client.invalidateQueries({ queryKey: ['settings'] });
      }),
    );
    add(
      listen<unknown>('quick-launch-page', (event) => {
        const path = z
          .string()
          .max(128)
          .regex(
            /^\/(?:library(?:\/other)?|hardware|tools(?:\/[a-z0-9-]+)?|optimization|settings)?$/u,
          )
          .safeParse(event.payload);
        if (path.success) void navigate(path.data);
      }),
    );
    add(
      listen('hud-open-settings', () => {
        void navigate('/tools/overlay-panel');
      }),
    );
    add(
      listen('settings-update-changed', () => {
        void client.invalidateQueries({ queryKey: ['settings', { operation: 'update-status' }] });
      }),
    );
    add(
      listen('acceleration-changed', () => {
        void client.invalidateQueries({ queryKey: ['acceleration', 'snapshot'] });
      }),
    );
    add(
      listen('settings-assets-changed', () => {
        void client.invalidateQueries({ queryKey: ['settings', { operation: 'snapshot' }] });
      }),
    );
    add(
      listen<unknown>('settings-notice', (event) => {
        const parsed = z.string().max(4096).safeParse(event.payload);
        if (parsed.success) notifyRef.current(parsed.data);
      }),
    );
    add(
      listen<unknown>('settings-tool-needed', (event) => {
        const parsed = z.enum(['overlay', 'screen-filter']).safeParse(event.payload);
        if (parsed.success)
          void navigate(`/tools/${parsed.data === 'overlay' ? 'overlay-panel' : 'display-filter'}`);
      }),
    );
    return () => {
      disposed = true;
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [client, navigate]);
  useEffect(() => {
    const failure = (event: Event) => {
      if (event instanceof CustomEvent) {
        const message = z.string().max(4096).safeParse(event.detail);
        if (message.success) notifyRef.current(message.data);
      }
    };
    window.addEventListener('quick-launch-error', failure);
    return () => window.removeEventListener('quick-launch-error', failure);
  }, []);
  useEffect(() => {
    if (!snapshot.data || bootAcknowledged || !isDesktop()) return;
    void executeSettings({ operation: 'boot-ready' }, z.null())
      .then(() => {
        bootAcknowledged = true;
      })
      .catch((error) => notifyRef.current(errorMessage(error)));
  }, [snapshot.data]);
  useEffect(() => {
    let alive = true;
    const builtins: Record<string, string> = {
      MiSans: 'MiSans, sans-serif',
      system: 'system-ui, sans-serif',
      serif: '"Noto Serif SC", SimSun, serif',
      mono: 'Consolas, monospace',
    };
    const builtin = builtins[ui.font];
    if (builtin) {
      document.documentElement.style.setProperty('--app-font', builtin);
      return;
    }
    const asset = snapshot.data?.assets.find(
      (asset) => `font:${asset.id}` === ui.font && asset.kind === 'font',
    );
    if (!asset) {
      document.documentElement.style.setProperty('--app-font', 'MiSans, sans-serif');
      return;
    }
    const face = new FontFace('ZhenjingCustom', `url("${settingsAssetUrl(asset.id)}")`);
    void face
      .load()
      .then((loaded) => {
        if (alive) {
          document.fonts.add(loaded);
          document.documentElement.style.setProperty(
            '--app-font',
            'ZhenjingCustom, MiSans, sans-serif',
          );
        }
      })
      .catch((error) => {
        if (alive) notifyRef.current(`字体加载失败：${errorMessage(error)}`);
      });
    return () => {
      alive = false;
      if (face) document.fonts.delete(face);
    };
  }, [ui.font, snapshot.data?.assets]);
  return null;
}
let splashShown = false;
export function StartupLogo() {
  const enabled = useSettingsUi((state) => state.splashEnabled);
  const logo = useSettingsUi((state) => state.splashLogo);
  const [visible, setVisible] = useState(() => enabled && !splashShown);
  useEffect(() => {
    if (!visible) return;
    splashShown = true;
    const timeout = setTimeout(() => setVisible(false), 650);
    return () => clearTimeout(timeout);
  }, [visible]);
  return visible ? (
    <div className="settings-startup-logo" aria-hidden="true">
      <img
        alt=""
        src={logo ? settingsAssetUrl(logo) : '/assets/home/brand.svg'}
        onError={(event) => {
          event.currentTarget.src = '/assets/home/brand.svg';
        }}
      />
    </div>
  ) : null;
}
