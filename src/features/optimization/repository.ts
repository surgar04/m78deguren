import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { executeOptimizer, isDesktop } from '@/lib/desktop';
import {
  optimizationCatalogSchema,
  optimizationSnapshotSchema,
} from '@/lib/optimization-contracts';
import { changeReceiptSchema } from '@/lib/builtin-contracts';
import { createOptimizationCatalog } from './catalog';
export async function loadOptimizationCatalog() {
  return createOptimizationCatalog(
    await executeOptimizer({ operation: 'catalog' }, optimizationCatalogSchema),
  );
}
export function useOptimizationCatalog() {
  return useQuery({
    queryKey: ['optimization', 'catalog'],
    queryFn: loadOptimizationCatalog,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  });
}
/** 扫描失败保留真实错误，不回退到模拟值；服务状态仅由 Query 管理。 */
export function useOptimizationSnapshot() {
  return useQuery({
    queryKey: ['optimization', 'snapshot'],
    queryFn: () => executeOptimizer({ operation: 'scan' }, optimizationSnapshotSchema),
    enabled: isDesktop(),
    staleTime: 30_000,
    retry: false,
  });
}
export function useOptimizationHistory(enabled: boolean) {
  return useQuery({
    queryKey: ['optimization', 'history'],
    queryFn: () =>
      executeOptimizer({ operation: 'history' }, z.array(changeReceiptSchema).max(200)),
    enabled: enabled && isDesktop(),
    staleTime: 0,
    retry: false,
  });
}
