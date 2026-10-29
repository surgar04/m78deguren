import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { executeSteam, isDesktop } from '@/lib/desktop';
import {
  steamSnapshotSchema,
  steamBackupSchema,
  steamImageSchema,
  type SteamRequest,
} from '@/lib/steam-contracts';
export function useSteam() {
  return useQuery({
    queryKey: ['steam', 'snapshot'],
    queryFn: () => executeSteam({ operation: 'snapshot', refresh: false }, steamSnapshotSchema),
    enabled: isDesktop(),
    refetchInterval: 20000,
    refetchIntervalInBackground: false,
    staleTime: 10000,
    retry: false,
  });
}
export function useSteamBackups(enabled: boolean) {
  return useQuery({
    queryKey: ['steam', 'backups'],
    queryFn: () => executeSteam({ operation: 'backups' }, z.array(steamBackupSchema)),
    enabled: enabled && isDesktop(),
    retry: false,
  });
}
export function useSteamImage(kind: 'game' | 'avatar', id: string) {
  return useQuery({
    queryKey: ['steam', 'image', kind, id],
    queryFn: () => executeSteam({ operation: 'image', kind, id }, steamImageSchema),
    enabled: isDesktop() && (kind === 'avatar' ? /^\d{17}$/u.test(id) : /^\d+$/u.test(id)),
    staleTime: 300000,
    gcTime: 30000,
    retry: false,
  });
}
export function useSteamAction<T>(schema: z.ZodType<T>) {
  const client = useQueryClient();
  return useMutation({
    gcTime: 0,
    mutationFn: (request: SteamRequest) => executeSteam(request, schema),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['steam'] });
    },
  });
}
