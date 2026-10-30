import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { executeAcceleration, isDesktop } from '@/lib/desktop';
import {
  accelerationSnapshotSchema,
  isPreparationActive,
  type AccelerationRequest,
} from '@/lib/acceleration-contracts';
import { OTHER_KEY } from '@/features/quick-launch/repository';
import { HOME_KEY } from '@/features/home/repository';

export const ACCELERATION_KEY = ['acceleration', 'snapshot'] as const;
/** 真实状态只保存在 Query；取消/完成后停止频繁刷新，无页面时由 Rust 结束会话监测。 */
export function useAcceleration() {
  return useQuery({
    queryKey: ACCELERATION_KEY,
    queryFn: () => executeAcceleration({ operation: 'snapshot' }, accelerationSnapshotSchema),
    enabled: isDesktop(),
    retry: false,
    staleTime: 2000,
    refetchInterval: (query) => (isPreparationActive(query.state.data?.session) ? 2000 : 15000),
    refetchIntervalInBackground: false,
  });
}
export function useAccelerationAction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (request: AccelerationRequest) =>
      executeAcceleration(request, accelerationSnapshotSchema),
    onSuccess: (value) => {
      client.setQueryData(ACCELERATION_KEY, value);
      void client.invalidateQueries({ queryKey: OTHER_KEY });
      void client.invalidateQueries({ queryKey: HOME_KEY });
    },
    // 失败也刷新后端会话，例如启动失败应显示真实失败状态，不能停留在等待确认。
    onError: () => {
      void client.invalidateQueries({ queryKey: ACCELERATION_KEY });
    },
  });
}
