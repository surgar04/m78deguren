import { useMemo, useState } from 'react';
import { z } from 'zod';
import { appsSnapshotSchema } from '@/lib/builtin-contracts';
import { useBuiltinAction, useBuiltinQuery } from './builtin-hooks';
import { SystemChangeReview } from './SystemChangeReview';
import { useSystemChange } from './use-system-change';
import { Feedback } from './Feedback';
import { bytes } from './format';

/** 应用列表来自卸载注册表；卸载只启动应用自己的卸载器，不伪造完成或擅自清理残留。 */
export function AppsPanel() {
  const query = useBuiltinQuery({ operation: 'query', tool: 'apps' }, appsSnapshotSchema);
  const open = useBuiltinAction(z.null());
  const control = useSystemChange();
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('name');
  const [page, setPage] = useState(0);
  const items = useMemo(() => {
    const keyword = search.normalize('NFKC').trim().toLocaleLowerCase('zh-CN');
    return [...(query.data?.apps ?? [])]
      .filter((app) =>
        [app.name, app.publisher, app.version]
          .join(' ')
          .toLocaleLowerCase('zh-CN')
          .includes(keyword),
      )
      .sort((a, b) =>
        sort === 'size'
          ? b.bytes - a.bytes
          : sort === 'date'
            ? b.installedOn.localeCompare(a.installedOn)
            : a.name.localeCompare(b.name, 'zh-CN'),
      );
  }, [query.data, search, sort]);
  const count = 30;
  const offset = Math.min(page, Math.max(0, Math.ceil(items.length / count) - 1)) * count;
  return (
    <div className="native-tool-panel">
      <div className="native-tool-form">
        <label>
          搜索应用
          <input
            type="search"
            placeholder="名称、发布者或版本"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
          />
        </label>
        <label>
          排序
          <select
            value={sort}
            onChange={(e) => {
              setSort(e.target.value);
              setPage(0);
            }}
          >
            <option value="name">名称</option>
            <option value="size">占用空间</option>
            <option value="date">安装日期</option>
          </select>
        </label>
      </div>
      <div className="native-tool-actions">
        <span>
          {items.length} 个应用 · 注册表声明占用{' '}
          {bytes(items.reduce((sum, app) => sum + app.bytes, 0))}
        </span>
        <button
          className="native-button"
          type="button"
          disabled={query.isFetching}
          onClick={() => {
            void query.refetch();
          }}
        >
          重新扫描
        </button>
      </div>
      <Feedback pending={query.isPending} error={query.error ?? open.error} />
      <SystemChangeReview control={control} />
      <div className="native-tool-list">
        {items.slice(offset, offset + count).map((app) => (
          <article key={app.id} className="native-tool-list-row">
            <div>
              <h4>{app.name}</h4>
              <p>
                {app.publisher || '发布者未提供'} · {app.version || '版本未提供'} ·{' '}
                {app.bytes ? bytes(app.bytes) : '大小未提供'}
              </p>
              <p>{app.installedOn ? `安装日期 ${app.installedOn}` : ''}</p>
            </div>
            <div className="native-tool-actions">
              <button
                className="native-button"
                type="button"
                disabled={open.isPending}
                onClick={() => open.mutate({ operation: 'app-file', id: app.id, reveal: false })}
              >
                打开
              </button>
              <button
                className="native-button"
                type="button"
                disabled={!app.location || open.isPending}
                onClick={() => open.mutate({ operation: 'app-file', id: app.id, reveal: true })}
              >
                位置
              </button>
              <button
                className="native-button"
                type="button"
                disabled={!app.uninstallable || control.busy}
                onClick={() => control.prepare({ kind: 'app-uninstall', id: app.id })}
              >
                卸载…
              </button>
            </div>
          </article>
        ))}
      </div>
      {!query.isPending && !items.length && <p>没有找到匹配的已注册应用。</p>}
      {items.length > count && (
        <div className="native-tool-actions">
          <button
            className="native-button"
            type="button"
            disabled={offset === 0}
            onClick={() => setPage((value) => Math.max(0, value - 1))}
          >
            上一页
          </button>
          <span>
            {Math.floor(offset / count) + 1} / {Math.ceil(items.length / count)}
          </span>
          <button
            className="native-button"
            type="button"
            disabled={offset + count >= items.length}
            onClick={() => setPage((value) => value + 1)}
          >
            下一页
          </button>
        </div>
      )}
    </div>
  );
}
