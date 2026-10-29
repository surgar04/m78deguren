import type {
  OptimizationCatalog,
  OptimizationDraft,
  OptimizationSetting,
  OptimizationSnapshot,
  OptimizationRow,
} from './types';
import type { RegistryValue } from '@/lib/optimization-contracts';

export function valueLabel(value: RegistryValue) {
  if (!value.exists) return '未设置';
  const text = value.kind === 'MultiString' ? value.multi.join(' | ') : (value.data ?? '');
  return `${value.kind} · ${text.length > 240 ? text.slice(0, 240) + '…' : text}`;
}

const normalize = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase('zh-CN');
const matches = (words: readonly string[], text: string) => {
  const content = normalize(text.replace(/[\r\n]+/gu, ''));
  return words.every((word) => content.includes(word));
};

/** 分类名称、说明、别名及所属设置共同参与查询；多个关键词采用交集。 */
export function searchOptimization(catalog: OptimizationCatalog, query: string) {
  const words = normalize(query).split(/\s+/u).filter(Boolean);
  const settings = catalog.settings.filter((setting) =>
    matches(words, [setting.name, setting.description, ...setting.aliases].join(' ')),
  );
  const categories = catalog.categories.filter((category) =>
    matches(
      words,
      [
        category.name,
        category.description,
        ...category.aliases,
        ...catalog.settings
          .filter((setting) => setting.categoryId === category.id)
          .flatMap((setting) => [setting.name, setting.description, ...setting.aliases]),
      ].join(' '),
    ),
  );
  return { categories, settings };
}

/** 前端目标值必须属于当前目录选项；提交 IPC 时由 Rust 再次独立验证。 */
export function validateDraft(
  catalog: OptimizationCatalog,
  input: OptimizationDraft,
): OptimizationDraft | null {
  const setting = catalog.settings.find((entry) => entry.id === input.id);
  return setting?.choices.some((choice) => choice.value === input.value)
    ? { id: setting.id, value: input.value }
    : null;
}

export function draftEntries(catalog: OptimizationCatalog, drafts: readonly OptimizationDraft[]) {
  const result: { setting: OptimizationSetting; value: string; label: string }[] = [];
  const seen = new Set<string>();
  for (const draft of drafts) {
    if (seen.has(draft.id)) continue;
    const setting = catalog.settings.find((entry) => entry.id === draft.id);
    const choice = setting?.choices.find((entry) => entry.value === draft.value);
    // 目录被替换、空模式或选项下线后，旧草稿不能制造不存在的配置项。
    if (setting && choice) {
      result.push({ setting, value: choice.value, label: choice.label });
      seen.add(setting.id);
    }
  }
  return result;
}

export function currentLabel(setting: OptimizationSetting, row?: OptimizationRow) {
  if (!row) return '未检测';
  if (row.state === 'configured') {
    const label = setting.choices.find((choice) => choice.value === row.selectedValue)?.label;
    return label === '应用配置' ? '目标匹配' : (label ?? '目标匹配');
  }
  return {
    baseline: '预设匹配',
    custom: '自定义',
    partial: '部分匹配',
    unsupported: '不适用',
    error: '读取失败',
  }[row.state];
}
export const riskLabel = { low: '低风险', medium: '中风险', high: '高风险' } as const;
/** 预设只生成草稿；不适用/失败项不写入，高风险只进入“全部”待审清单。 */
export function presetEntries(
  catalog: OptimizationCatalog,
  snapshot: OptimizationSnapshot,
  mode: 'safe' | 'enhanced' | 'all' | 'restore',
): OptimizationDraft[] {
  const rows = new Map(snapshot.rows.map((row) => [row.id, row]));
  return catalog.settings.flatMap((setting) => {
    const row = rows.get(setting.id),
      definition = setting.definition;
    if (!row || row.state === 'error' || row.state === 'unsupported') return [];
    if (mode === 'safe' && !definition.safeEligible) return [];
    if (mode === 'enhanced' && (definition.risk === 'high' || definition.securitySensitive))
      return [];
    const value = mode === 'restore' ? 'restore' : definition.defaultValue;
    if (
      mode === 'restore'
        ? row.state === 'baseline'
        : row.state === 'configured' && row.selectedValue === value
    )
      return [];
    return [{ id: setting.id, value }];
  });
}
