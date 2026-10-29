import type { z } from 'zod';
import type {
  optimizationCategoryIdSchema,
  OptimizationDefinition,
  OptimizationRow,
  OptimizationSnapshot,
} from '@/lib/optimization-contracts';
export type OptimizationCategoryId = z.infer<typeof optimizationCategoryIdSchema>;
export type OptimizationIcon =
  | 'display'
  | 'gamepad'
  | 'bolt'
  | 'lock'
  | 'wifi'
  | 'gear'
  | 'file'
  | 'window'
  | 'gpu'
  | 'ai'
  | 'disk'
  | 'apps'
  | 'audio';
export type OptimizationTone = 'mint' | 'blue' | 'violet' | 'orange';
export interface OptimizationCategory {
  id: OptimizationCategoryId;
  name: string;
  description: string;
  aliases: readonly string[];
  icon: OptimizationIcon;
  tone: OptimizationTone;
  count: number;
}
/** 产品目录不存放本机状态；实际值只引用 Query 中的扫描快照。 */
export interface OptimizationSetting {
  id: string;
  categoryId: OptimizationCategoryId;
  name: string;
  description: string;
  aliases: readonly string[];
  icon: OptimizationIcon;
  tone: OptimizationTone;
  featuredDescription?: string;
  choices: readonly { value: string; label: string }[];
  details: readonly string[];
  definition: OptimizationDefinition;
}
export interface OptimizationCatalog {
  source: 'native';
  categories: readonly OptimizationCategory[];
  settings: readonly OptimizationSetting[];
  featuredIds: readonly string[];
  reference: string;
}
export interface OptimizationDraft {
  id: string;
  value: string;
}
export type { OptimizationDefinition, OptimizationRow, OptimizationSnapshot };
