import { useState } from 'react';
import type { z } from 'zod';
import { nvidiaSnapshotSchema } from '@/lib/builtin-contracts';
import { useBuiltinQuery } from './builtin-hooks';
import { Feedback } from './Feedback';
import { SystemChangeHistory, SystemChangeReview } from './SystemChangeReview';
import { useSystemChange } from './use-system-change';

/** NVIDIA SDK 的枚举名称翻译；最终可写值始终取自当前驱动，常量不代表硬件支持。 */
function valueLabel(id: number, value: number) {
  if (id === 0x10e41df3) {
    if (value === 0) return '由驱动决定';
    if (value === 0xffffff) return '最新模型';
    if (value >= 1 && value <= 15) return `模型 ${String.fromCharCode(64 + value)}`;
  }
  if (id === 0x10afb768)
    return (
      ['性能', '平衡', '质量', '由游戏决定', 'DLAA', '超级性能', '自定义', '保留值'][value] ??
      String(value)
    );
  if (id === 0x1057eb71)
    return (
      ['自适应', '最高性能优先', '驱动控制', '稳定性能优先', '最低功耗优先', '最佳功耗'][value] ??
      String(value)
    );
  if (id === 0x10835002) return value === 0 ? '关闭帧率限制' : `${value} FPS`;
  return `${value} · 0x${value.toString(16).toUpperCase().padStart(8, '0')}`;
}
type Snapshot = z.infer<typeof nvidiaSnapshotSchema>;
function Editor({ snapshot }: { snapshot: Snapshot }) {
  const [draft, setDraft] = useState<Record<string, number | null>>({});
  const [query, setQuery] = useState('');
  const control = useSystemChange();
  const settings = snapshot.settings.filter((row) =>
    `${row.label} ${row.name} ${row.id.toString(16)}`
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase()),
  );
  const submit = () =>
    control.prepare({
      kind: 'nvidia',
      scope: snapshot.scope,
      settings: Object.entries(draft).map(([id, value]) => ({ id: Number(id), value })),
    });
  return (
    <div className="native-tool-panel">
      <p className="native-tool-note">
        {snapshot.scope === 'delta'
          ? '仅修改驱动中的三角洲行动配置。DLSS 模型与模式需要游戏、驱动和 RTX 显卡支持。'
          : '直接读取 NVIDIA 驱动数据库；未支持的配置保留诊断信息。修改会影响后续启动的 3D 应用。'}
      </p>
      {snapshot.scope === 'delta' && (
        <section className="native-tool-confirm">
          <h3>DLSS 状态指示器</h3>
          <p>
            当前全局 NGX 标志：
            {snapshot.indicator === null
              ? '未配置'
              : snapshot.indicator === 1024
                ? '启用'
                : snapshot.indicator === 0
                  ? '关闭'
                  : `自定义值 ${snapshot.indicator}`}
            。逐项预览后修改，可从操作记录恢复原值。
          </p>
          <div className="native-tool-actions">
            <button
              type="button"
              className="native-button"
              disabled={control.busy}
              onClick={() => control.prepare({ kind: 'dlss-indicator', enabled: true })}
            >
              预览启用指示器
            </button>
            <button
              type="button"
              className="native-button"
              disabled={control.busy}
              onClick={() => control.prepare({ kind: 'dlss-indicator', enabled: false })}
            >
              预览关闭指示器
            </button>
          </div>
        </section>
      )}
      <label className="native-tool-search">
        搜索配置
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="名称或设置 ID"
        />
      </label>
      <div className="native-tool-list">
        {settings.map((row) => (
          <div className="native-setting-row" key={row.id}>
            <div>
              <strong>{row.label}</strong>
              <p>
                {row.group} · 0x{row.id.toString(16).toUpperCase()}{' '}
                {row.predefined ? '· 驱动默认' : '· 自定义覆盖'}
              </p>
              {!row.supported && <small>{row.reason}</small>}
            </div>
            {row.supported && (
              <label>
                设置值
                <select
                  aria-label={row.label}
                  value={Object.hasOwn(draft, row.id) ? (draft[row.id] ?? 'reset') : row.current}
                  disabled={control.busy}
                  onChange={(e) =>
                    setDraft((current) => ({
                      ...current,
                      [row.id]: e.target.value === 'reset' ? null : Number(e.target.value),
                    }))
                  }
                >
                  <option value="reset">恢复驱动默认</option>
                  {[...new Set([row.current, ...row.values])].map((value) => (
                    <option key={value} value={value}>
                      {valueLabel(row.id, value)}
                    </option>
                  ))}
                </select>
                {row.id === 0x10835002 && (
                  <input
                    aria-label="自定义最大帧速率"
                    type="number"
                    min={0}
                    max={1000}
                    value={draft[row.id] ?? row.current}
                    onChange={(e) =>
                      setDraft((current) => ({ ...current, [row.id]: Number(e.target.value) }))
                    }
                  />
                )}
              </label>
            )}
          </div>
        ))}
      </div>
      <div className="native-tool-actions">
        <button
          type="button"
          className="mint-button"
          disabled={
            !Object.keys(draft).length ||
            control.busy ||
            Object.values(draft).some(
              (value) =>
                value !== null && (!Number.isInteger(value) || value < 0 || value > 0xffffffff),
            )
          }
          onClick={submit}
        >
          预览 {Object.keys(draft).length} 项修改
        </button>
        <button type="button" className="native-button" onClick={() => setDraft({})}>
          放弃草稿
        </button>
        <button
          type="button"
          className="native-button"
          disabled={control.busy || !snapshot.settings.some((row) => row.supported)}
          onClick={() =>
            control.prepare({
              kind: 'nvidia',
              scope: snapshot.scope,
              settings: snapshot.settings
                .filter((row) => row.supported)
                .map((row) => ({ id: row.id, value: null })),
            })
          }
        >
          预览恢复默认
        </button>
      </div>
      <SystemChangeReview control={control} />
      <SystemChangeHistory control={control} />
    </div>
  );
}
export function NvidiaPanel({ dlss = false }: { dlss?: boolean }) {
  const query = useBuiltinQuery(
    { operation: 'query', tool: dlss ? 'dlss' : 'nvidia' },
    nvidiaSnapshotSchema,
  );
  return (
    <>
      <Feedback pending={query.isPending} error={query.error} />
      {query.data && (
        <Editor
          key={`${query.data.scope}-${query.data.settings.map((row) => `${row.id}:${row.current}:${row.predefined}`).join()}`}
          snapshot={query.data}
        />
      )}
      <button
        type="button"
        className="native-button"
        disabled={query.isFetching}
        onClick={() => {
          void query.refetch();
        }}
      >
        重新读取驱动
      </button>
    </>
  );
}
