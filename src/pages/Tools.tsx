import { lazy, Suspense, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  faMagnifyingGlass,
  faTableCellsLarge,
  faHeart,
  faClock,
  faGear,
  faXmark,
  faCheck,
  faArrowLeft,
} from '@fortawesome/free-solid-svg-icons';
import { WorkspaceLayout } from '@/features/home/components/WorkspaceLayout';
import { Icon } from '@/features/home/components/Icon';
import { useGameWorkspace } from '@/features/home/useGameWorkspace';
import { useToolCatalog } from '@/features/tools/repository';
import { useToolPreferences } from '@/features/tools/store';
import { TOOL_GROUPS, selectTools } from '@/features/tools/catalog';
import { ToolCard } from '@/features/tools/ToolCard';
import type { ToolEntry, ToolFilter } from '@/features/tools/types';
import '@/features/tools/tools.css';
const NativeToolPanel = lazy(() => import('@/features/tools/native/NativeToolPanel'));

const FILTERS = [
  { id: 'all', label: '全部', icon: faTableCellsLarge },
  { id: 'favorites', label: '收藏', icon: faHeart },
  { id: 'recent', label: '最近使用', icon: faClock },
] as const;

/** 工具目录和结果由 Rust 提供；工具详情有独立地址，长表单不再嵌在弹窗中。 */
export default function Tools() {
  const workspace = useGameWorkspace();
  const catalog = useToolCatalog();
  const { favorites, recent, toggleFavorite, recordOpen } = useToolPreferences();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ToolFilter>('all');
  const [managing, setManaging] = useState(false);
  const { toolId: selectedId } = useParams<{ toolId: string }>();
  const navigate = useNavigate();
  // 只保留路由 ID，详情继续从同一目录缓存派生，避免复制一份过期业务记录。
  const selected = catalog.data
    ? [...catalog.data.tools, ...(catalog.data.external ? [catalog.data.external] : [])].find(
        (tool) => tool.id === selectedId,
      )
    : undefined;
  const filtersRef = useRef<HTMLDivElement>(null);
  const changeFavorite = (id: string) => {
    // 收藏视图移除当前卡片前先恢复到筛选按钮，避免焦点随被卸载的按钮丢失。
    if (filter === 'favorites' && favorites.includes(id) && !selected) {
      filtersRef.current?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')?.focus();
    }
    toggleFavorite(id);
  };
  const selectedTools = useMemo(
    () => (catalog.data ? selectTools(catalog.data, { query, filter, favorites, recent }) : []),
    [catalog.data, query, filter, favorites, recent],
  );
  const openTool = (tool: ToolEntry) => {
    recordOpen(tool.id);
    void navigate(`/tools/${tool.id}`);
  };
  const reset = () => {
    setQuery('');
    setFilter('all');
  };

  return (
    <WorkspaceLayout workspace={workspace} active="tools">
      <main id="main-content" className="tools-main" tabIndex={-1}>
        <header className="tools-heading" data-home-enter>
          <div className="tools-title">
            <h1>{selected?.name ?? '工具箱'}</h1>
            <span className="tools-source">
              {catalog.data?.source === 'native' ? '本机工具' : '桌面工具'}
            </span>
          </div>
          <p>{selected?.description ?? '让游戏与日常，都更顺手。'}</p>
          <p className="tools-date">{workspace.query.data?.date}</p>
        </header>
        {!selectedId && (
          <>
            <div className="tools-toolbar" data-home-enter>
              <label className="tools-search glass">
                <Icon icon={faMagnifyingGlass} />
                <input
                  type="search"
                  placeholder="搜索工具..."
                  aria-label="搜索工具"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                {query && (
                  <button type="button" aria-label="清空工具搜索" onClick={() => setQuery('')}>
                    <Icon icon={faXmark} />
                  </button>
                )}
              </label>
              <div
                ref={filtersRef}
                className="tools-filters glass"
                role="group"
                aria-label="工具筛选"
              >
                {FILTERS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={filter === item.id ? 'active' : ''}
                    aria-pressed={filter === item.id}
                    onClick={() => setFilter(item.id)}
                  >
                    <Icon icon={item.icon} />
                    {item.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className={`tools-manage glass ${managing ? 'active' : ''}`}
                aria-pressed={managing}
                onClick={() => setManaging((value) => !value)}
              >
                <Icon icon={managing ? faCheck : faGear} />
                {managing ? '完成管理' : '管理收藏'}
              </button>
            </div>
            {managing && (
              <p className="tools-manage-note" role="status">
                点击星标添加或取消收藏，系统维护与外部工具也可收藏。
              </p>
            )}
            {catalog.isPending ? (
              <p className="tools-empty glass" role="status">
                正在加载工具目录…
              </p>
            ) : catalog.isError ? (
              <div className="tools-empty glass" role="alert">
                <h2>工具目录暂时无法加载</h2>
                <button
                  type="button"
                  className="mint-button"
                  onClick={() => {
                    void catalog.refetch();
                  }}
                >
                  重新加载
                </button>
              </div>
            ) : selectedTools.length === 0 ? (
              <div className="tools-empty glass" role="status">
                <h2>
                  {query
                    ? '没有找到匹配的工具'
                    : filter === 'favorites'
                      ? '还没有收藏工具'
                      : filter === 'recent'
                        ? '还没有最近使用记录'
                        : '工具服务尚未连接'}
                </h2>
                <p>
                  {query
                    ? '试试工具名称或功能关键词。'
                    : filter === 'favorites'
                      ? '点击工具卡片的星标，即可在这里快速找到它。'
                      : filter === 'recent'
                        ? '打开工具详情后，会在这里保留访问记录。'
                        : '请在臻境桌面应用中使用本机工具。'}
                </p>
                {(query || filter !== 'all') && (
                  <button type="button" className="mint-button" onClick={reset}>
                    查看全部工具
                  </button>
                )}
              </div>
            ) : (
              <div className="tools-sections" data-home-enter>
                {(filter === 'recent' ? [{ id: 'recent', label: '最近使用' }] : TOOL_GROUPS).map(
                  (group) => {
                    // 最近使用保留跨分类的访问顺序，不再被分类排序覆盖。
                    const entries =
                      filter === 'recent'
                        ? selectedTools
                        : selectedTools.filter((tool) => tool.category === group.id);
                    if (!entries.length) return null;
                    return (
                      <section
                        key={group.id}
                        className={`tool-section section-${group.id}`}
                        aria-labelledby={`tools-${group.id}`}
                      >
                        <h2 id={`tools-${group.id}`}>{group.label}</h2>
                        <div className="tool-grid">
                          {entries.map((tool) => (
                            <ToolCard
                              key={tool.id}
                              tool={tool}
                              compact={false}
                              favorite={favorites.includes(tool.id)}
                              managing={managing}
                              onFavorite={changeFavorite}
                              onOpen={openTool}
                            />
                          ))}
                        </div>
                      </section>
                    );
                  },
                )}
              </div>
            )}
            {catalog.data && (
              <footer className="tools-footer" aria-live="polite">
                {filter === 'all' && !query
                  ? `共 ${catalog.data.tools.length} 项内置工具 · 外部工具单独浏览`
                  : `找到 ${selectedTools.length} 项工具`}
              </footer>
            )}
          </>
        )}
        {selected && (
          <section className="tools-detail glass" aria-label={`${selected.name}工具界面`}>
            <div className="tools-detail-header">
              <button
                type="button"
                className="native-button"
                onClick={() => {
                  void navigate('/tools');
                }}
              >
                <Icon icon={faArrowLeft} />
                返回工具箱
              </button>
              <button
                type="button"
                className="native-button"
                aria-pressed={favorites.includes(selected.id)}
                onClick={() => changeFavorite(selected.id)}
              >
                <Icon icon={faHeart} />
                {favorites.includes(selected.id) ? '取消收藏' : '收藏工具'}
              </button>
            </div>
            <Suspense fallback={<p role="status">正在打开工具…</p>}>
              <NativeToolPanel id={selected.id} />
            </Suspense>
          </section>
        )}
        {selectedId && !selected && (
          <div className="tools-empty glass">
            <p>{catalog.isPending ? '正在读取工具目录…' : '工具不存在或目录暂时不可用。'}</p>
            <button
              type="button"
              className="mint-button"
              onClick={() => {
                void navigate('/tools');
              }}
            >
              返回工具箱
            </button>
          </div>
        )}
      </main>
    </WorkspaceLayout>
  );
}
