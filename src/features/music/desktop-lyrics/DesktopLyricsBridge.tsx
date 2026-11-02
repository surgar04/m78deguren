import { useEffect, useSyncExternalStore } from 'react';
import { z } from 'zod';
import { executeMusic, desktopWindowLabel, isDesktop } from '@/lib/desktop';
import { immersiveSession } from '../immersive-session';
import { musicPlayer } from '../player';
import { desktopContent } from './packets';
import { useDesktopLyrics } from './repository';
import type { DesktopLyricsContent } from './contracts';

/** 跨页面常驻的是这个轻量桥。关闭开关时无窗口、无定时器、无渲染器；开启后仅 4 Hz 小时钟 IPC。 */
export default function DesktopLyricsBridge() {
  const { query } = useDesktopLyrics();
  const immersive = useSyncExternalStore(immersiveSession.subscribe, immersiveSession.snapshot);
  const enabled =
    query.data?.config.enabled === true &&
    !immersive &&
    isDesktop() &&
    desktopWindowLabel() === 'main';
  useEffect(() => {
    if (!enabled) return;
    let disposed = false,
      lastTrack: unknown,
      lastLyrics: unknown,
      lastPlaying: unknown,
      clockPending = false;
    let contentPending: DesktopLyricsContent | null | undefined;
    let contentBusy = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    let lastClock: ReturnType<typeof musicPlayer.lyricClock> | undefined;
    const sendContent = async (): Promise<void> => {
      if (contentBusy) return;
      contentBusy = true;
      try {
        // 连续切歌只保留最新待发送内容，避免积压整份歌词或逐个播放过时状态。
        while (!disposed && contentPending !== undefined) {
          const content = contentPending;
          contentPending = undefined;
          await executeMusic({ operation: 'desktop-content', content }, z.null());
        }
      } catch (cause) {
        console.warn('桌面歌词内容暂不可用', cause);
      } finally {
        contentBusy = false;
        if (!disposed && contentPending !== undefined) void sendContent();
      }
    };
    const sendClock = () => {
      if (disposed || clockPending) return;
      const clock = musicPlayer.lyricClock();
      // 暂停时同一读数无需重复传输；跳转、播放状态变化仍立即同步。
      if (
        clock.paused &&
        lastClock?.paused &&
        Math.abs(clock.positionMs - lastClock.positionMs) < 1
      )
        return;
      lastClock = clock;
      clockPending = true;
      void executeMusic(
        {
          operation: 'desktop-clock',
          clock,
        },
        z.null(),
      )
        .catch((cause) => console.warn('桌面歌词时钟暂不可用', cause))
        .finally(() => {
          clockPending = false;
          // 暂停中快速拖动进度时，合并到最新位置，不能丢掉在途请求期间的最后一次跳转。
          if (!disposed && musicPlayer.lyricClock().paused) sendClock();
        });
    };
    const update = () => {
      const state = musicPlayer.snapshot();
      if (lastTrack !== state.track || lastLyrics !== state.lyrics) {
        lastTrack = state.track;
        lastLyrics = state.lyrics;
        contentPending = desktopContent(state.track, state.lyrics);
        void sendContent();
      }
      if (lastPlaying !== state.playing) {
        lastPlaying = state.playing;
        sendClock();
        if (timer) {
          clearInterval(timer);
          timer = null;
        }
        if (state.playing) timer = setInterval(sendClock, 250);
      } else if (!state.playing) sendClock();
    };
    update();
    sendClock();
    const stop = musicPlayer.subscribe(update);
    return () => {
      disposed = true;
      stop();
      if (timer) clearInterval(timer);
    };
  }, [enabled]);
  return null;
}
