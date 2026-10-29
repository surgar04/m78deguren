import { useState } from 'react';
import { z } from 'zod';
import { driverHistorySchema, gpuSnapshotSchema } from '@/lib/builtin-contracts';
import { useBuiltinAction, useBuiltinQuery } from './builtin-hooks';
import { Feedback } from './Feedback';

/** 官网列表不是当前硬件兼容性结论；保留产品支持列表核对步骤，不自动安装驱动。 */
export function DriverHistoryPanel() {
  const gpus = useBuiltinQuery({ operation: 'query', tool: 'gpus' }, gpuSnapshotSchema);
  const history = useBuiltinQuery(
    { operation: 'driver-history', refresh: false },
    driverHistorySchema,
  );
  const refresh = useBuiltinAction(driverHistorySchema);
  const open = useBuiltinAction(z.null());
  const [channel, setChannel] = useState<'desktop' | 'laptop'>('desktop');
  const [search, setSearch] = useState('');
  const data = refresh.data ?? history.data;
  const rows =
    data?.drivers.filter(
      (row) =>
        row.channel === channel &&
        `${row.version} ${row.name} ${row.date}`
          .toLocaleLowerCase()
          .includes(search.toLocaleLowerCase()),
    ) ?? [];
  return (
    <div className="native-tool-panel">
      <div className="native-status-banner">
        <div>
          <strong>当前显卡与驱动</strong>
          {gpus.data?.gpus.map((gpu) => (
            <p key={gpu.id}>
              {gpu.name} · {gpu.driver}
            </p>
          ))}
        </div>
      </div>
      <p className="native-tool-note">
        NVIDIA 官方 Game Ready
        历史列表，桌面与笔记本分开查询。打开官网后请核对支持产品和系统；老旧显卡可能需要专用旧分支。本工具不自动运行驱动安装器。
      </p>
      <div className="native-tool-actions">
        <label>
          设备类型
          <select
            value={channel}
            onChange={(e) => {
              if (e.target.value === 'desktop' || e.target.value === 'laptop')
                setChannel(e.target.value);
            }}
          >
            <option value="desktop">台式机</option>
            <option value="laptop">笔记本</option>
          </select>
        </label>
        <label>
          搜索版本
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="版本、日期或名称"
          />
        </label>
        <button
          type="button"
          className="mint-button"
          disabled={refresh.isPending || history.isFetching}
          onClick={() => refresh.mutate({ operation: 'driver-history', refresh: true })}
        >
          从官网刷新
        </button>
      </div>
      <Feedback
        pending={history.isPending || refresh.isPending}
        error={refresh.error ?? history.error ?? gpus.error ?? open.error}
      />
      {data?.warnings.map((warning, index) => (
        <p className="native-tool-note" key={`${index}:${warning}`}>
          部分渠道未返回：{warning}
        </p>
      ))}
      {data && (
        <p>
          数据获取时间：{new Date(data.updatedAt * 1000).toLocaleString('zh-CN')} · 共 {rows.length}{' '}
          项
        </p>
      )}
      <div className="native-tool-list">
        {rows.map((row) => (
          <article className="native-tool-list-row" key={`${row.channel}:${row.id}`}>
            <div>
              <strong>{row.version}</strong>
              <p>{row.name}</p>
              <small>{row.date}</small>
            </div>
            <button
              type="button"
              className="native-button"
              disabled={open.isPending}
              onClick={() => open.mutate({ operation: 'driver-open', id: row.id })}
            >
              官方详情与下载
            </button>
          </article>
        ))}
      </div>
      {data && !rows.length && <p>没有匹配的驱动记录。</p>}
    </div>
  );
}
