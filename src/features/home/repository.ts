import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import { executeHome, isDesktop } from '@/lib/desktop';
import {
  homeSnapshotSchema,
  homeContentSchema,
  homePictureSchema,
  type HomeRequest,
} from '@/lib/home-contracts';
export const HOME_KEY = ['home', 'snapshot'] as const;
export function useHome() {
  return useQuery({
    queryKey: HOME_KEY,
    queryFn: () => executeHome({ operation: 'snapshot' }, homeSnapshotSchema),
    enabled: isDesktop(),
    refetchInterval: 2000,
    refetchIntervalInBackground: false,
    staleTime: 1000,
    retry: false,
  });
}
export function useHomeAction<T>(schema: z.ZodType<T>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (request: HomeRequest) => executeHome(request, schema),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: HOME_KEY });
    },
  });
}
export function useHomeContent(kind: 'quote' | 'announcement', enabled = true) {
  return useQuery({
    queryKey: ['home', 'content', kind],
    queryFn: () => executeHome({ operation: 'content', kind, refresh: false }, homeContentSchema),
    enabled: enabled && isDesktop(),
    staleTime: 3600000,
    retry: false,
  });
}
export function useHomePicture(enabled: boolean) {
  return useQuery({
    queryKey: ['home', 'picture'],
    queryFn: () => executeHome({ operation: 'picture', refresh: false }, homePictureSchema),
    enabled: enabled && isDesktop(),
    staleTime: Infinity,
    retry: false,
  });
}
