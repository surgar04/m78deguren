import { useEffect } from 'react';
import type { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { executeMusic, isDesktop, desktopWindowLabel } from '@/lib/desktop';
import {
  desktopLyricsConfigSchema,
  desktopLyricsSnapshotSchema,
  type DesktopLyricsConfig,
} from './contracts';

export const desktopLyricsKey = ['music', 'desktop-lyrics'] as const;
type Snapshot = z.infer<typeof desktopLyricsSnapshotSchema>;
/** 原生配置是唯一事实源；设置面板与歌词窗口的关闭、锁定通过同一事件更新。 */
export function useDesktopLyrics() {
  const cache = useQueryClient();
  const enabled = isDesktop() && desktopWindowLabel() === 'main';
  const query = useQuery({
    queryKey: desktopLyricsKey,
    queryFn: () => executeMusic({ operation: 'desktop-read' }, desktopLyricsSnapshotSchema),
    enabled,
    retry: false,
    staleTime: Infinity,
  });
  useEffect(() => {
    if (!enabled) return;
    let disposed = false,
      stop: (() => void) | undefined;
    void import('@tauri-apps/api/event')
      .then(async ({ listen }) => {
        const cleanup = await listen<unknown>('music:lyrics-config', (event) => {
          const parsed = desktopLyricsConfigSchema.safeParse(event.payload);
          if (parsed.success)
            cache.setQueryData(desktopLyricsKey, (old: Snapshot | undefined) =>
              old ? { ...old, config: parsed.data } : old,
            );
        });
        if (disposed) cleanup();
        else stop = cleanup;
      })
      .catch((cause) => console.warn('桌面歌词设置订阅暂不可用', cause));
    return () => {
      disposed = true;
      stop?.();
    };
  }, [enabled, cache]);
  const mutation = useMutation({
    mutationFn: (config: DesktopLyricsConfig) =>
      executeMusic({ operation: 'desktop-configure', config }, desktopLyricsConfigSchema),
    onSuccess: (config) =>
      cache.setQueryData(desktopLyricsKey, (old: Snapshot | undefined) =>
        old ? { ...old, config } : old,
      ),
  });
  return { query, mutation };
}
