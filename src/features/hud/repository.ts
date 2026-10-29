import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listen } from '@tauri-apps/api/event';
import { z } from 'zod';
import { executeHud, isDesktop } from '@/lib/desktop';
import { keepNewerHudReadings } from './model';
import {
  hudLiveSchema,
  hudSnapshotSchema,
  type HudSnapshot,
  type HudRequest,
} from '@/lib/hud-contracts';
const queryKey = ['hud'] as const;
/** HUD 窗口通过后端推送读数；只有打开编辑器时才续租预览，关闭后自然释放采集资源。 */
export function useHud(preview = false) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey,
    queryFn: () => executeHud({ operation: 'snapshot' }, hudSnapshotSchema),
    enabled: isDesktop(),
    retry: false,
    refetchInterval: preview ? 3000 : false,
    structuralSharing: keepNewerHudReadings,
  });
  useEffect(() => {
    if (!isDesktop()) return;
    let disposed = false;
    const cleanup: (() => void)[] = [];
    const add = (promise: Promise<() => void>) => {
      void promise
        .then((fn) => {
          if (disposed) fn();
          else cleanup.push(fn);
        })
        .catch(() => undefined);
    };
    add(
      listen<unknown>('hud-live', (event) => {
        const value = hudLiveSchema.safeParse(event.payload);
        if (value.success)
          client.setQueryData<HudSnapshot>(queryKey, (current) =>
            current ? { ...current, live: value.data } : current,
          );
      }),
    );
    add(
      listen('hud-config-changed', () => {
        void client.invalidateQueries({ queryKey });
      }),
    );
    return () => {
      disposed = true;
      cleanup.forEach((fn) => fn());
    };
  }, [client]);
  return query;
}
export function useHudAction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (request: HudRequest) => executeHud(request, z.unknown()),
    onSuccess: (_data, request) => {
      if (['configure', 'toggle', 'remember', 'import'].includes(request.operation))
        void client.invalidateQueries({ queryKey });
    },
  });
}
