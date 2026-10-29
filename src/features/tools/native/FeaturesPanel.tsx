import { useMemo, useState } from 'react';
import { z } from 'zod';
import { featuresSnapshotSchema, systemChangeSchema } from '@/lib/builtin-contracts';
import { useBuiltinAction, useBuiltinQuery } from './builtin-hooks';
import { Feedback } from './Feedback';
import { SystemChangeHistory, SystemChangeReview } from './SystemChangeReview';
import { useSystemChange } from './use-system-change';

/** 隐藏功能始终显示 ID、优先级和存储；不根据名称猜测某项实验一定存在于当前系统。 */
export function FeaturesPanel() {
  const [store, setStore] = useState<0 | 1>(1);
  const query = useBuiltinQuery(
    { operation: 'query', tool: store === 1 ? 'features-runtime' : 'features-boot' },
    featuresSnapshotSchema,
  );
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(50);
  const [id, setId] = useState('');
  const [priority, setPriority] = useState(8);
  const [state, setState] = useState(2);
  const [variant, setVariant] = useState(0);
  const [payloadKind, setPayloadKind] = useState(0);
  const [payload, setPayload] = useState(0);
  const control = useSystemChange();
  const dictionary = useBuiltinAction(z.object({ count: z.number().int() }));
  const rows = useMemo(() => {
    const text = search.trim().toLocaleLowerCase();
    const names = query.data?.dictionary ?? {};
    const existing = query.data?.features ?? [];
    const rows: Array<{
      id: number;
      priority: number | null;
      state: number | null;
      variant: number | null;
      payloadKind: number | null;
      payload: number | null;
      wexp: boolean;
    }> = existing.filter((row) =>
      `${row.id} ${names[row.id] ?? ''}`.toLocaleLowerCase().includes(text),
    );
    if (text) {
      const known = new Set(existing.map((row) => row.id));
      for (const [key, name] of Object.entries(names)) {
        const id = Number(key);
        if (!known.has(id) && `${id} ${name}`.toLocaleLowerCase().includes(text))
          rows.push({
            id,
            priority: null,
            state: null,
            variant: null,
            payloadKind: null,
            payload: null,
            wexp: false,
          });
      }
    }
    return rows;
  }, [query.data, search]);
  const change = {
    kind: 'feature',
    store,
    id: Number(id),
    priority,
    state,
    variant,
    payloadKind,
    payload,
    reset: false,
  } as const;
  const valid = systemChangeSchema.safeParse(change);
  return (
    <div className="native-tool-panel">
      <p className="native-tool-note">
        Windows 实验功能开关。Runtime 立即应用；Boot
        写入启动覆盖，重启后生效。功能是否实际出现取决于当前系统版本及相关组件。
      </p>
      <div className="native-tool-actions">
        {(
          [
            { value: 1, label: 'Runtime 运行时' },
            { value: 0, label: 'Boot 启动配置' },
          ] as const
        ).map((item) => (
          <button
            key={item.value}
            type="button"
            className={store === item.value ? 'mint-button' : 'native-button'}
            onClick={() => {
              setStore(item.value);
              setLimit(50);
            }}
          >
            {item.label}
          </button>
        ))}
        <button
          type="button"
          className="native-button"
          disabled={query.isFetching}
          onClick={() => {
            void query.refetch();
          }}
        >
          刷新实际配置
        </button>
      </div>
      <Feedback
        pending={query.isPending || dictionary.isPending}
        error={query.error ?? dictionary.error}
      />
      <div className="native-tool-actions">
        <p>名称字典 {Object.keys(query.data?.dictionary ?? {}).length} 项</p>
        <button
          type="button"
          className="native-button"
          disabled={dictionary.isPending}
          onClick={() => dictionary.mutate({ operation: 'feature-dictionary-update' })}
        >
          更新 ViVe 官方名称字典
        </button>
      </div>
      <p className="native-tool-note">
        字典来自 ViVe 项目，只提供 ID 名称，不能证明当前系统存在或支持该功能。
      </p>
      <label className="native-tool-search">
        搜索功能 ID 或名称
        <input
          type="search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setLimit(50);
          }}
        />
      </label>
      <p>
        当前配置 {query.data?.features.length ?? '—'} 项，匹配 {rows.length} 项。
      </p>
      <div className="native-tool-list">
        {rows.slice(0, limit).map((row) => (
          <button
            key={`${row.id}:${row.priority}`}
            type="button"
            className="native-feature-row"
            onClick={() => {
              setId(String(row.id));
              setPriority(
                row.priority === null || [0, 1, 3, 9, 15].includes(row.priority) ? 8 : row.priority,
              );
              setState(Math.min(2, row.state ?? 0));
              setVariant(row.variant ?? 0);
              setPayloadKind(row.payloadKind ?? 0);
              setPayload(row.payload ?? 0);
            }}
          >
            <strong>
              {row.id} · {query.data?.dictionary[row.id] ?? '未收录名称'}
            </strong>
            <span>
              {row.state === null
                ? '仅有字典记录，当前系统未枚举状态'
                : `${['默认', '禁用', '启用'][row.state] ?? '未知'} · 优先级 ${row.priority} · 变体 ${row.variant}`}
              {row.wexp ? ' · WEXP' : ''}
            </span>
          </button>
        ))}
      </div>
      {rows.length > limit && (
        <button
          type="button"
          className="native-button"
          onClick={() => setLimit((value) => value + 100)}
        >
          再显示 100 项
        </button>
      )}
      <section className="native-device-card">
        <h4>编辑选定功能</h4>
        <div className="native-tool-form">
          <label>
            功能 ID
            <input
              type="number"
              min={1}
              max={0xffffffff}
              value={id}
              onChange={(e) => setId(e.target.value)}
            />
          </label>
          <label>
            可写优先级
            <select value={priority} onChange={(e) => setPriority(Number(e.target.value))}>
              {[2, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14].map((value) => (
                <option key={value} value={value}>
                  {value}
                  {value === 8 ? ' · User' : ''}
                </option>
              ))}
            </select>
          </label>
          <label>
            启用状态
            <select value={state} onChange={(e) => setState(Number(e.target.value))}>
              <option value={0}>默认</option>
              <option value={1}>禁用</option>
              <option value={2}>启用</option>
            </select>
          </label>
          <label>
            变体（0–63）
            <input
              type="number"
              min={0}
              max={63}
              value={variant}
              onChange={(e) => setVariant(Number(e.target.value))}
            />
          </label>
          <label>
            载荷类型（0–3）
            <input
              type="number"
              min={0}
              max={3}
              value={payloadKind}
              onChange={(e) => setPayloadKind(Number(e.target.value))}
            />
          </label>
          <label>
            载荷值
            <input
              type="number"
              min={0}
              max={0xffffffff}
              value={payload}
              onChange={(e) => setPayload(Number(e.target.value))}
            />
          </label>
        </div>
        <div className="native-tool-actions">
          <button
            type="button"
            className="mint-button"
            disabled={!valid.success || control.busy}
            onClick={() => {
              if (valid.success) control.prepare(valid.data);
            }}
          >
            预览设置
          </button>
          <button
            type="button"
            className="native-button"
            disabled={!valid.success || control.busy}
            onClick={() => {
              if (valid.success) control.prepare({ ...change, reset: true });
            }}
          >
            预览重置覆盖
          </button>
        </div>
      </section>
      <SystemChangeReview control={control} />
      <SystemChangeHistory control={control} />
    </div>
  );
}
