import { useState } from 'react';
import { faClosedCaptioning } from '@fortawesome/free-solid-svg-icons';
import { Icon } from '@/features/home/components/Icon';
import { Modal } from '@/features/home/components/Modal';
import { executeMusic, errorMessage } from '@/lib/desktop';
import { desktopLyricsConfigSchema } from './contracts';
import { useDesktopLyrics } from './repository';

/** 拖动过程只更新输入草稿，松开/键盘操作结束再持久化，避免每个像素都写盘并打断滑块。 */
function LyricRange({
  label,
  value,
  min,
  max,
  step,
  format,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (n: number) => string;
  onCommit: (n: number) => Promise<unknown>;
}) {
  const [draft, setDraft] = useState<number | null>(null),
    [pending, setPending] = useState(false);
  const commit = () => {
    if (draft === null || draft === value || pending) return;
    setPending(true);
    void onCommit(draft)
      .catch(() => {})
      .finally(() => {
        setDraft(null);
        setPending(false);
      });
  };
  return (
    <label>
      <span>
        {label} · {format(draft ?? value)}
      </span>
      <input
        aria-label={label}
        type="range"
        min={min}
        max={max}
        step={step}
        value={draft ?? value}
        disabled={pending}
        onChange={(e) => setDraft(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
    </label>
  );
}
export function DesktopLyricsControls() {
  const [open, setOpen] = useState(false),
    [failure, setFailure] = useState('');
  const { query, mutation } = useDesktopLyrics();
  const config = query.data?.config;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-pressed={config?.enabled ?? false}>
        <Icon icon={faClosedCaptioning} />
        桌面歌词
      </button>
      {open && (
        <Modal title="桌面歌词" onClose={() => setOpen(false)} className="music-desktop-settings">
          <p className="music-help">
            在其他应用上方显示同步歌词。仅普通播放模式呈现，沉浸演绎时自动隐藏。
          </p>
          {(query.error || mutation.error || failure) && (
            <p role="alert">{failure || errorMessage(query.error ?? mutation.error)}</p>
          )}
          {config && (
            <div className="music-desktop-options">
              <label>
                <span>
                  <b>启用桌面歌词</b>
                  <small>播放后显示，可拖动到屏幕任意位置</small>
                </span>
                <input
                  type="checkbox"
                  checked={config.enabled}
                  disabled={mutation.isPending}
                  onChange={(e) => mutation.mutate({ ...config, enabled: e.target.checked })}
                />
              </label>
              <label>
                <span>
                  <b>锁定与鼠标穿透</b>
                  <small>锁定后从此处关闭，即可重新拖动</small>
                </span>
                <input
                  type="checkbox"
                  checked={config.locked}
                  disabled={mutation.isPending}
                  onChange={(e) => mutation.mutate({ ...config, locked: e.target.checked })}
                />
              </label>
              <LyricRange
                label="字号"
                value={config.fontSize}
                min={20}
                max={56}
                step={2}
                format={(n) => `${n} px`}
                onCommit={(n) => mutation.mutateAsync({ ...config, fontSize: n })}
              />
              <LyricRange
                label="不透明度"
                value={config.opacity}
                min={0.3}
                max={1}
                step={0.05}
                format={(n) => `${Math.round(n * 100)}%`}
                onCommit={(n) => mutation.mutateAsync({ ...config, opacity: n })}
              />
              <button
                type="button"
                onClick={() => {
                  setFailure('');
                  void executeMusic(
                    { operation: 'desktop-control', action: 'reset-position' },
                    desktopLyricsConfigSchema,
                  ).catch((cause) => setFailure(errorMessage(cause)));
                }}
              >
                恢复到屏幕底部
              </button>
            </div>
          )}
          <p className="music-help">
            拖动歌词上方把手移动，拖动窗口边缘调整大小。纯音乐或无歌词时显示歌曲信息。
          </p>
        </Modal>
      )}
    </>
  );
}
