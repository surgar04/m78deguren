import { z } from 'zod';
import { executeMusic } from '@/lib/desktop';
import { musicPlayer } from './player';

/**
 * 全屏与音频分析共用一个所有者和串行队列。
 * React StrictMode 会执行“进入→清理→再次进入”；不能让第一次进入的迟到回调关闭第二次会话。
 */
export function createImmersiveSession(apply: (enabled: boolean) => Promise<void>) {
  let owner: symbol | null = null;
  const listeners = new Set<() => void>();
  const changed = () => listeners.forEach((notify) => notify());
  let applied: boolean | undefined;
  let queue = Promise.resolve();
  const synchronize = () => {
    const operation = queue
      .catch(() => {})
      .then(async () => {
        // 开始执行时才读取最新意图，合并已过期的进入/退出，不排队播放过时的窗口切换。
        const enabled = owner !== null;
        if (applied === enabled) return;
        await apply(enabled);
        applied = enabled;
      });
    queue = operation;
    return operation;
  };
  return {
    subscribe: (notify: () => void) => {
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
      };
    },
    snapshot: () => owner !== null,
    acquire() {
      const token = Symbol('music-immersive');
      owner = token;
      changed();
      return {
        ready: synchronize(),
        release() {
          if (owner !== token) return Promise.resolve();
          owner = null;
          changed();
          return synchronize();
        },
      };
    },
  };
}

export const immersiveSession = createImmersiveSession(async (enabled) => {
  await executeMusic({ operation: 'immersive', enabled }, z.null());
  await musicPlayer.enableAnalysis(enabled);
});
