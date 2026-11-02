import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { listen } from '@tauri-apps/api/event';
import { DomLyricPlayer, type LyricLine } from '@applemusic-like-lyrics/core';
import { faGripVertical, faLock, faXmark } from '@fortawesome/free-solid-svg-icons';
import { Icon } from '@/features/home/components/Icon';
import { executeMusic, errorMessage } from '@/lib/desktop';
import {
  desktopLyricsSnapshotSchema,
  desktopLyricsConfigSchema,
  desktopLyricsContentSchema,
  desktopLyricsClockSchema,
  type DesktopLyricsContent,
  type DesktopLyricsConfig,
} from './contracts';
import { desktopClockPosition } from './packets';
import '@applemusic-like-lyrics/core/style.css';
import './desktop-lyrics.css';

/** DOM 歌词核心独立于 Folia 全屏画布。只在这个辅助窗口加载，隐藏/暂停时停止帧循环。 */
export default function DesktopLyricsWindow() {
  const host = useRef<HTMLDivElement>(null),
    renderer = useRef<DomLyricPlayer | null>(null);
  const [content, setContent] = useState<DesktopLyricsContent | null>(null),
    [config, setConfig] = useState<DesktopLyricsConfig | null>(null),
    [failure, setFailure] = useState('');
  const clock = useRef({ positionMs: 0, paused: true, arrived: 0 }),
    wake = useRef(() => {});
  useEffect(() => {
    document.documentElement.classList.add('desktop-lyrics-document');
    let disposed = false;
    const cleanups: (() => void)[] = [];
    const received = { config: false, content: false, clock: false };
    const acceptClock = (value: unknown) => {
      const parsed = desktopLyricsClockSchema.safeParse(value);
      if (!parsed.success) return;
      received.clock = true;
      if (
        parsed.data.paused &&
        clock.current.paused &&
        Math.abs(parsed.data.positionMs - clock.current.positionMs) < 1
      )
        return;
      clock.current = { ...parsed.data, arrived: performance.now() };
      wake.current();
    };
    void (async () => {
      const subscriptions = await Promise.all([
        listen<unknown>('music:lyrics-content', (e) => {
          const v = desktopLyricsContentSchema.nullable().safeParse(e.payload);
          if (v.success) {
            received.content = true;
            setContent(v.data);
          }
        }),
        listen<unknown>('music:lyrics-config', (e) => {
          const v = desktopLyricsConfigSchema.safeParse(e.payload);
          if (v.success) {
            received.config = true;
            setConfig(v.data);
          }
        }),
        listen<unknown>('music:lyrics-clock', (e) => acceptClock(e.payload)),
      ]);
      if (disposed) {
        subscriptions.forEach((stop) => stop());
        return;
      }
      cleanups.push(...subscriptions);
      const state = await executeMusic({ operation: 'desktop-read' }, desktopLyricsSnapshotSchema);
      if (disposed) return;
      if (!received.config) setConfig(state.config);
      if (!received.content) setContent(state.content);
      if (!received.clock) acceptClock(state.clock);
    })().catch((cause) => {
      if (!disposed) setFailure(errorMessage(cause));
    });
    return () => {
      disposed = true;
      cleanups.forEach((stop) => stop());
      document.documentElement.classList.remove('desktop-lyrics-document');
    };
  }, []);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const player = new DomLyricPlayer();
    renderer.current = player;
    player.setEnableBlur(false);
    player.setEnableScale(false);
    player.setEnableSpring(false);
    player.setAlignAnchor('center');
    player.setAlignPosition(0.42);
    const view = player.getElement();
    view.style.width = '100%';
    view.style.height = '100%';
    element.append(view);
    let frame = 0,
      last = 0;
    const advance = (now: number) => {
      frame = 0;
      const c = clock.current;
      player.setCurrentTime(desktopClockPosition(c.positionMs, c.paused, now - c.arrived));
      player.update(last ? Math.min(50, now - last) : 16);
      last = now;
      if (!document.hidden && !c.paused) frame = requestAnimationFrame(advance);
    };
    const start = () => {
      if (document.hidden) {
        cancelAnimationFrame(frame);
        frame = 0;
        last = 0;
        player.pause();
        return;
      }
      if (clock.current.paused) player.pause();
      else player.resume();
      if (!frame) frame = requestAnimationFrame(advance);
    };
    wake.current = start;
    document.addEventListener('visibilitychange', start);
    start();
    return () => {
      wake.current = () => {};
      cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', start);
      renderer.current = null;
      player.dispose();
      view.remove();
    };
  }, []);
  useEffect(() => {
    const lines: LyricLine[] = (content?.lyrics.lines ?? []).map((line) => ({
      words: (line.words.length
        ? line.words
        : [{ text: line.fullText, startTime: line.startTime, endTime: line.endTime }]
      ).map((word) => ({
        word: word.text,
        startTime: word.startTime * 1000,
        endTime: word.endTime * 1000,
      })),
      startTime: line.startTime * 1000,
      endTime: line.endTime * 1000,
      translatedLyric: line.translation ?? '',
      romanLyric: line.romanization ?? '',
      isBG: false,
      isDuet: false,
    }));
    const c = clock.current;
    renderer.current?.setLyricLines(
      lines,
      desktopClockPosition(c.positionMs, c.paused, performance.now() - c.arrived),
    );
    wake.current();
  }, [content]);
  const control = (action: 'drag' | 'lock' | 'close') => {
    void executeMusic({ operation: 'desktop-control', action }, desktopLyricsConfigSchema).catch(
      (cause) => setFailure(errorMessage(cause)),
    );
  };
  return (
    <main
      className={`desktop-lyrics-overlay ${config?.locked ? 'locked' : ''}`}
      style={
        {
          '--desktop-lyric-size': `${config?.fontSize ?? 32}px`,
          opacity: config?.opacity ?? 0.95,
        } as CSSProperties
      }
    >
      {!config?.locked && (
        <header className="desktop-lyrics-toolbar">
          <button
            type="button"
            className="desktop-lyrics-drag"
            onPointerDown={(event) => {
              if (event.button === 0) control('drag');
            }}
            aria-label="拖动桌面歌词"
          >
            <Icon icon={faGripVertical} /> <span>{content?.title ?? '臻境 · 桌面歌词'}</span>
          </button>
          <button
            type="button"
            onClick={() => control('lock')}
            title="锁定并鼠标穿透；从音乐页解锁"
          >
            <Icon icon={faLock} /> 锁定
          </button>
          <button type="button" onClick={() => control('close')} aria-label="关闭桌面歌词">
            <Icon icon={faXmark} />
          </button>
        </header>
      )}
      <div ref={host} className="desktop-lyrics-renderer" aria-label="同步桌面歌词" />
      {!content?.lyrics.lines.length && (
        <div className="desktop-lyrics-empty">
          <b>{content?.title ?? '等待播放'}</b>
          <span>
            {content?.lyrics.isPureMusic
              ? '纯音乐，请欣赏'
              : content?.artist || '暂无同步歌词，可在音乐页匹配或导入'}
          </span>
        </div>
      )}
      {failure && (
        <p className="desktop-lyrics-error" role="alert">
          {failure}
        </p>
      )}
    </main>
  );
}
