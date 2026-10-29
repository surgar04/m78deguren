/** 工具目录契约独立于展示组件；真实服务接入后保持同一结构。 */
export type ToolCategory = 'gaming' | 'network' | 'maintenance';
export const TOOL_ICON_IDS = [
  'crosshair',
  'display',
  'film',
  'download',
  'wifi',
  'clock',
  'runtime',
  'log',
  'box',
  'palette',
  'chart',
  'gpu',
  'drive',
  'audio',
  'mouse',
  'shield',
  'sliders',
  'menu',
  'apps',
] as const;
export type ToolIcon = (typeof TOOL_ICON_IDS)[number];
export type ToolTone = 'mint' | 'blue' | 'violet' | 'orange' | 'rose';
export type ToolFilter = 'all' | 'favorites' | 'recent';

export interface ToolEntry {
  id: string;
  name: string;
  description: string;
  aliases: readonly string[];
  category: ToolCategory;
  icon: ToolIcon;
  tone: ToolTone;
  /** 外部工具入口单独呈现，不计入内置工具数量。 */
  origin: 'builtin' | 'third-party';
  details: readonly string[];
}

export interface ToolCatalog {
  source: 'native' | 'unavailable';
  tools: readonly ToolEntry[];
  external: ToolEntry | null;
}
