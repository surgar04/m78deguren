import type { ToolCatalog, ToolEntry, ToolFilter } from './types';

/** 展示顺序与栏目名称属于产品结构，不包含任何演示设备/工具业务记录。 */
export const TOOL_GROUPS = [
  { id: 'gaming', label: '游戏辅助' },
  { id: 'network', label: '网络与下载' },
  { id: 'maintenance', label: '系统维护' },
] as const;

const normalize = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase('zh-CN');

/** 收藏、最近与文本搜索取交集；始终返回新数组，不修改查询缓存或用户偏好。 */
export function selectTools(
  catalog: ToolCatalog,
  options: {
    query: string;
    filter: ToolFilter;
    favorites: readonly string[];
    recent: readonly string[];
  },
): ToolEntry[] {
  const words = normalize(options.query).split(/\s+/u).filter(Boolean);
  const records = [...catalog.tools, ...(catalog.external ? [catalog.external] : [])];
  const selected = records.filter((tool) => {
    if (options.filter === 'favorites' && !options.favorites.includes(tool.id)) return false;
    if (options.filter === 'recent' && !options.recent.includes(tool.id)) return false;
    const searchable = normalize([tool.name, tool.description, ...tool.aliases].join(' '));
    return words.every((word) => searchable.includes(word));
  });
  return options.filter === 'recent'
    ? selected.sort((a, b) => options.recent.indexOf(a.id) - options.recent.indexOf(b.id))
    : selected;
}
