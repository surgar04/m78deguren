import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { z } from 'zod';
import { executeGameRoom, isDesktop } from '@/lib/desktop';
import { gameRoomSchema, type GameRoomRequest } from '@/lib/game-room-contracts';

/** 查询只在调用页面存在时运行；后台页不启动额外高频采样，也不保存第二份服务状态。 */
export function useDeltaQuery<T>(
  request: GameRoomRequest,
  schema: z.ZodType<T>,
  interval?: number,
) {
  return useQuery<T>({
    queryKey: ['delta', request],
    queryFn: () => executeGameRoom(request, schema),
    enabled: isDesktop(),
    refetchInterval: interval ?? false,
    refetchIntervalInBackground: false,
    staleTime: interval ? 0 : 60_000,
    retry: false,
  });
}
export function useGameRoom() {
  return useDeltaQuery({ operation: 'snapshot' }, gameRoomSchema, 2000);
}
export function useDeltaAction() {
  const client = useQueryClient();
  const [notice, setNotice] = useState('');
  const mutation = useMutation({
    mutationFn: (request: GameRoomRequest) => executeGameRoom(request, z.unknown()),
    onMutate: () => setNotice(''),
    onSuccess: () => {
      setNotice('操作已完成');
      void client.invalidateQueries({ queryKey: ['delta'] });
    },
  });
  return { ...mutation, notice };
}
