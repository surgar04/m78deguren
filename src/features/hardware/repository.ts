import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import { executeHardware, isDesktop } from '@/lib/desktop';
import {
  hardwareSnapshotSchema,
  hardwareRemoteSchema,
  type HardwareRequest,
} from '@/lib/hardware-contracts';

const SNAPSHOT_KEY = ['hardware', 'snapshot'] as const;
/** 一个 Query 对应一个原生快照；组件不另外累计采样历史，不制造多份后端状态。 */
export function useHardwareSnapshot(enabled = true) {
  return useQuery({
    queryKey: SNAPSHOT_KEY,
    queryFn: () => executeHardware({ operation: 'snapshot' }, hardwareSnapshotSchema),
    enabled: enabled && isDesktop(),
    refetchInterval: 1000,
    refetchIntervalInBackground: false,
    staleTime: 500,
    retry: false,
  });
}
export function useHardwareRemote(enabled: boolean) {
  return useQuery({
    queryKey: ['hardware', 'remote'],
    queryFn: () => executeHardware({ operation: 'remote-info' }, hardwareRemoteSchema),
    enabled: enabled && isDesktop(),
    refetchInterval: 3000,
    retry: false,
  });
}
export function useHardwareAction<T>(schema: z.ZodType<T>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (request: HardwareRequest) => executeHardware(request, schema),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['hardware'] });
    },
  });
}
