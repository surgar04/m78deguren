import { useState } from 'react';
import { contextSnapshotSchema } from '@/lib/builtin-contracts';
import { useBuiltinQuery } from './builtin-hooks';
import { SystemChangeHistory, SystemChangeReview } from './SystemChangeReview';
import { useSystemChange } from './use-system-change';
import { Feedback } from './Feedback';

const categories = [
  ['all', '全部'],
  ['file', '文件右键'],
  ['folder', '文件夹'],
  ['desktop', '桌面空白'],
  ['drive', '磁盘'],
  ['all-files', '所有文件系统'],
] as const;
export function ContextMenuPanel() {
  const query = useBuiltinQuery({ operation: 'query', tool: 'context' }, contextSnapshotSchema);
  const control = useSystemChange();
  const [tab, setTab] = useState<'menus' | 'computer'>('menus');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const keyword = search.trim().toLocaleLowerCase('zh-CN');
  const entries =
    query.data?.entries.filter(
      (value) =>
        (category === 'all' || value.category === category) &&
        [value.name, value.command, value.source]
          .join(' ')
          .toLocaleLowerCase('zh-CN')
          .includes(keyword),
    ) ?? [];
  return (
    <div className="native-tool-panel">
      <div className="native-tool-actions" role="group" aria-label="管理范围">
        <button
          type="button"
          className={tab === 'menus' ? 'mint-button' : 'native-button'}
          onClick={() => setTab('menus')}
        >
          右键菜单
        </button>
        <button
          type="button"
          className={tab === 'computer' ? 'mint-button' : 'native-button'}
          onClick={() => setTab('computer')}
        >
          此电脑与盘符
        </button>
        <button
          type="button"
          className="native-button"
          disabled={query.isFetching}
          onClick={() => {
            void query.refetch();
          }}
        >
          重新扫描
        </button>
      </div>
      <Feedback pending={query.isPending} error={query.error} />
      <SystemChangeReview control={control} />
      {tab === 'menus' ? (
        <>
          <div className="native-tool-form">
            <label>
              搜索
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="名称、命令、来源"
              />
            </label>
            <label>
              类型
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                {categories.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p>{entries.length} 个条目</p>
          <div className="native-tool-list">
            {entries.map((value) => (
              <div className="native-tool-list-row" key={value.id}>
                <div>
                  <strong>{value.name}</strong>
                  <p>
                    {value.source} · {value.category} · {value.hidden ? '已隐藏' : '显示中'}
                  </p>
                  <p className="native-path">{value.command}</p>
                </div>
                <button
                  className="native-button"
                  type="button"
                  disabled={control.busy}
                  onClick={() =>
                    control.prepare({ kind: 'context-toggle', id: value.id, hidden: !value.hidden })
                  }
                >
                  {value.hidden ? '恢复…' : '隐藏…'}
                </button>
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          <h4>盘符显示</h4>
          <div className="native-tool-list">
            {query.data?.drives.map((value) => (
              <div className="native-tool-list-row" key={value.letter}>
                <strong>
                  {value.letter} {value.name}
                </strong>
                <button
                  className="native-button"
                  type="button"
                  disabled={control.busy}
                  onClick={() =>
                    control.prepare({
                      kind: 'drive-visibility',
                      letter: value.letter,
                      hidden: !value.hidden,
                    })
                  }
                >
                  {value.hidden ? '显示…' : '隐藏…'}
                </button>
              </div>
            ))}
          </div>
          <h4>此电脑命名空间</h4>
          <div className="native-tool-list">
            {query.data?.namespaces.map((value) => (
              <div className="native-tool-list-row" key={value.id}>
                <div>
                  <strong>{value.name}</strong>
                  <p>{value.clsid}</p>
                </div>
                <button
                  className="native-button"
                  type="button"
                  disabled={control.busy}
                  onClick={() =>
                    control.prepare({
                      kind: 'namespace-toggle',
                      id: value.id,
                      hidden: !value.hidden,
                    })
                  }
                >
                  {value.hidden ? '恢复…' : '隐藏…'}
                </button>
              </div>
            ))}
          </div>
        </>
      )}
      <SystemChangeHistory control={control} />
    </div>
  );
}
