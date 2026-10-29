import { useQuery } from '@tanstack/react-query';
import type { ToolCatalog } from './types';
import { executeTool, isDesktop } from '@/lib/desktop';
import { catalogSchema } from '@/lib/tool-contracts';

/** 唯一目录查询：直接读取Rust产品目录，网页环境明确返回不可用。 */
export async function loadToolCatalog(): Promise<ToolCatalog> {
  if (!isDesktop()) {
    return { source: 'unavailable', tools: [], external: null };
  }
  return executeTool({ operation: 'catalog' }, catalogSchema);
}

export function useToolCatalog() {
  return useQuery({
    queryKey: ['tools', 'catalog'],
    queryFn: loadToolCatalog,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}
