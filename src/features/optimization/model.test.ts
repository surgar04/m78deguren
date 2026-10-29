import rawCatalog from '../../../src-tauri/src/services/tools/windows/optimizer-catalog.json';
import { describe, expect, it } from 'vitest';
import { optimizationCatalogSchema } from '@/lib/optimization-contracts';
import { createOptimizationCatalog } from './catalog';
import {
  currentLabel,
  draftEntries,
  presetEntries,
  searchOptimization,
  validateDraft,
} from './model';
import type { OptimizationSnapshot } from './types';

const catalog = createOptimizationCatalog(optimizationCatalogSchema.parse(rawCatalog));
/** 纯模型测试数据，仅存在于测试文件，不构成生产回退或设备读数。 */
const snapshot: OptimizationSnapshot = {
  checkedAt: 0,
  osBuild: 'test',
  admin: false,
  rows: catalog.settings.map((setting) => ({
    id: setting.id,
    state: 'custom',
    selectedValue: null,
    checks: [],
    skipped: [],
    error: null,
  })),
};
describe('全量优化目录与预设边界', () => {
  it('201 项、11 类、完整枚举均存在，搜索支持全角和交集', () => {
    expect(catalog.settings).toHaveLength(201);
    expect(catalog.categories).toHaveLength(11);
    expect(catalog.categories.reduce((sum, item) => sum + item.count, 0)).toBe(201);
    expect(searchOptimization(catalog, 'ＤＮＳ 缓存').settings.map((item) => item.id)).toEqual([
      'optimizeDnsCache',
    ]);
    expect(searchOptimization(catalog, '相机').settings.map((item) => item.id)).toContain(
      'denyAppCamera',
    );
    expect(searchOptimization(catalog, '不存在的功能').settings).toEqual([]);
    expect(
      catalog.settings
        .find((item) => item.id === 'win32Priority')
        ?.choices.map((choice) => choice.value),
    ).toEqual(['program', 'background', 'extreme', 'restore']);
  });
  it('只接受目录中的 ID 与对应目标，失效草稿不能制造配置', () => {
    expect(validateDraft(catalog, { id: 'showFileExtensions', value: 'apply' })).toEqual({
      id: 'showFileExtensions',
      value: 'apply',
    });
    expect(validateDraft(catalog, { id: 'showFileExtensions', value: 'program' })).toBeNull();
    expect(validateDraft(catalog, { id: 'HKEY_LOCAL_MACHINE', value: 'apply' })).toBeNull();
    expect(
      draftEntries(catalog, [
        { id: 'removed', value: 'apply' },
        { id: 'gameMode', value: 'apply' },
        { id: 'gameMode', value: 'restore' },
      ]),
    ).toHaveLength(1);
  });
  it('安全及增强预设不包含高风险和安全削弱项目，全部预设仍可逐项审阅', () => {
    const high = new Set(
      catalog.settings
        .filter((item) => item.definition.risk === 'high' || item.definition.securitySensitive)
        .map((item) => item.id),
    );
    for (const mode of ['safe', 'enhanced'] as const)
      for (const draft of presetEntries(catalog, snapshot, mode))
        expect(high.has(draft.id)).toBe(false);
    expect(presetEntries(catalog, snapshot, 'all').map((draft) => draft.id)).toContain(
      'disableUAC',
    );
    const changed = {
      ...snapshot,
      rows: snapshot.rows.map((row) =>
        row.id === 'gameMode'
          ? { ...row, state: 'unsupported' as const }
          : row.id === 'disableUAC'
            ? { ...row, state: 'error' as const }
            : row,
      ),
    };
    expect(presetEntries(catalog, changed, 'all').map((draft) => draft.id)).not.toContain(
      'gameMode',
    );
    expect(presetEntries(catalog, changed, 'all').map((draft) => draft.id)).not.toContain(
      'disableUAC',
    );
    expect(
      presetEntries(catalog, snapshot, 'restore').every((draft) => draft.value === 'restore'),
    ).toBe(true);
  });
  it('不把未检测或自定义读数冒充已生效，已匹配项目不重复写入', () => {
    const item = catalog.settings[0];
    if (!item) throw new Error('缺少目录');
    expect(currentLabel(item)).toBe('未检测');
    expect(currentLabel(item, snapshot.rows[0])).toBe('自定义');
    const matched = {
      ...snapshot,
      rows: snapshot.rows.map((row) => ({
        ...row,
        state: 'configured' as const,
        selectedValue:
          catalog.settings.find((item) => item.id === row.id)?.definition.defaultValue ?? null,
      })),
    };
    expect(presetEntries(catalog, matched, 'all')).toEqual([]);
  });
});
