import { shortcutFromEvent } from './shortcut';
import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { executeSettings, errorMessage } from '@/lib/desktop';
import { runtimeSettingsSchema, type HotkeyAction } from '@/lib/settings-contracts';
import { useSettingsSnapshot, useSettingsQuery, useNativePatch } from './repository';
import { Failure, SettingToggle, SettingRow } from './controls';
import { useText, type TextKey } from './i18n';
import { QuickLaunchPanel } from '@/features/quick-launch/QuickLaunchPanel';

const LABELS: Record<HotkeyAction, TextKey> = {
  overlay: 'HUD 开关',
  crosshair: '准心',
  filter: '滤镜',
  clicker: '连点器',
  previous: '上一曲',
  next: '下一曲',
  'play-pause': '播放 / 暂停',
};
const captureSchema = z
  .object({ token: z.uuid(), expiresInSeconds: z.number().positive() })
  .strict();
/** 录制时暂停原生注册；失焦、卸载、取消、超时都归还租约，原生另有 30 秒兜底。 */
function Recorder({ action, close }: { action: HotkeyAction; close: () => void }) {
  const { t } = useText();
  const patch = useNativePatch();
  const snapshot = useSettingsSnapshot();
  const token = useRef<string | null>(null);
  const [candidate, setCandidate] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    const release = () => {
      const own = token.current;
      token.current = null;
      if (own)
        void executeSettings({ operation: 'hotkey-capture-end', token: own }, z.null()).catch(
          (error) => {
            if (alive) setFailure(errorMessage(error));
          },
        );
    };
    void executeSettings({ operation: 'hotkey-capture-start' }, captureSchema)
      .then((value) => {
        if (!alive) {
          void executeSettings({ operation: 'hotkey-capture-end', token: value.token }, z.null());
          return;
        }
        token.current = value.token;
        setReady(true);
      })
      .catch((error) => {
        if (alive) setFailure(errorMessage(error));
      });
    const key = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') {
        release();
        close();
        return;
      }
      const value = shortcutFromEvent(event);
      if (value) setCandidate(value);
    };
    const blur = () => {
      release();
      close();
    };
    window.addEventListener('keydown', key, true);
    window.addEventListener('blur', blur);
    const timer = window.setTimeout(blur, 25_000);
    return () => {
      alive = false;
      clearTimeout(timer);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('blur', blur);
      release();
    };
  }, [close]);
  const binding = snapshot.data?.config.bindings.find((row) => row.action === action);
  return (
    <section className="settings-review" aria-label={t('录制快捷键')}>
      <h3>{t(LABELS[action])}</h3>
      <p>按下组合键。Esc 取消；25 秒后结束。单独字母、数字和系统保留键不用于全局热键。</p>
      <kbd>{candidate || '…'}</kbd>
      <Failure error={failure ?? patch.error} />
      <div className="settings-actions">
        <button type="button" onClick={close}>
          {t('取消')}
        </button>
        <button
          type="button"
          disabled={!ready || !candidate || !binding || patch.isPending}
          onClick={() => {
            if (binding)
              patch.mutate(
                {
                  operation: 'patch',
                  patch: { kind: 'binding', binding: { ...binding, shortcut: candidate } },
                },
                { onSuccess: close },
              );
          }}
        >
          {t('保存')}
        </button>
      </div>
    </section>
  );
}
export function ShortcutsPanel() {
  const { t } = useText();
  const snapshot = useSettingsSnapshot();
  const runtime = useSettingsQuery({ operation: 'runtime' }, runtimeSettingsSchema, 3_000);
  const patch = useNativePatch();
  const [record, setRecord] = useState<HotkeyAction | null>(null);
  // 引用稳定的回调，避免每次渲染卸载录制租约。
  const close = useCallback(() => setRecord(null), []);
  return (
    <>
      <h2>{t('快捷键')}</h2>
      <Failure error={snapshot.error ?? runtime.error ?? patch.error} />
      {snapshot.data && (
        <>
          <SettingToggle
            label={t('全部热键')}
            checked={snapshot.data.config.hotkeysEnabled}
            disabled={patch.isPending || record !== null}
            onChange={(value) => patch.patch({ kind: 'hotkeys-enabled', value })}
          />
          {snapshot.data.config.bindings.map((binding) => {
            const registered = runtime.data?.hotkeys.find((row) => row.action === binding.action);
            return (
              <div key={binding.action}>
                <SettingRow
                  label={t(LABELS[binding.action])}
                  description={registered?.error ?? t(registered?.registered ? '已注册' : '未注册')}
                >
                  <label>
                    <input
                      type="checkbox"
                      aria-label={t(LABELS[binding.action])}
                      checked={binding.enabled}
                      disabled={patch.isPending || record !== null}
                      onChange={(event) =>
                        patch.patch({
                          kind: 'binding',
                          binding: { ...binding, enabled: event.target.checked },
                        })
                      }
                    />
                  </label>
                  <button
                    type="button"
                    disabled={record !== null}
                    aria-label={`${t('录制快捷键')} ${t(LABELS[binding.action])}`}
                    onClick={() => setRecord(binding.action)}
                  >
                    <kbd>{binding.shortcut}</kbd>
                  </button>
                </SettingRow>
              </div>
            );
          })}
        </>
      )}
      {record && <Recorder key={record} action={record} close={close} />}
      <QuickLaunchPanel />
      <p className="settings-note">
        热键只控制已确认的工具会话。连点器必须先手动启用，Esc
        始终急停；滤镜须在本次启动中确认颜色修改。媒体快捷键控制 Windows 当前媒体会话。
      </p>
    </>
  );
}
