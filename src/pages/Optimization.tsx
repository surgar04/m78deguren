import { useMemo, useState } from 'react';
import {
  faMagnifyingGlass,
  faDisplay,
  faCircleInfo,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';
import { faClock } from '@fortawesome/free-regular-svg-icons';
import { WorkspaceLayout } from '@/features/home/components/WorkspaceLayout';
import { Icon } from '@/features/home/components/Icon';
import { useGameWorkspace } from '@/features/home/useGameWorkspace';
import {
  useOptimizationCatalog,
  useOptimizationSnapshot,
} from '@/features/optimization/repository';
import { searchOptimization, presetEntries } from '@/features/optimization/model';
import {
  OptimizationCategoryCard,
  OptimizationCommonCard,
} from '@/features/optimization/OptimizationCards';
import {
  OptimizationDialogs,
  OptimizationSettingList,
  type OptimizationDialog,
} from '@/features/optimization/OptimizationDialogs';
import { useOptimizationPreferences } from '@/features/optimization/store';
import { errorMessage } from '@/lib/desktop';
import '@/features/optimization/optimization.css';
import '@/features/optimization/optimizer-native.css';

/** 页面只组合产品目录、Query 扫描快照及用户草稿；不保存配置状态的第二份副本。 */
export default function Optimization() {
  const workspace = useGameWorkspace(),
    catalog = useOptimizationCatalog(),
    snapshot = useOptimizationSnapshot();
  const [query, setQuery] = useState(''),
    [dialog, setDialog] = useState<OptimizationDialog | null>(null),
    [notice, setNotice] = useState('');
  const drafts = useOptimizationPreferences((state) => state.drafts),
    replaceDrafts = useOptimizationPreferences((state) => state.replaceDrafts);
  const result = useMemo(
    () =>
      catalog.data ? searchOptimization(catalog.data, query) : { categories: [], settings: [] },
    [catalog.data, query],
  );
  const rows = useMemo(
    () => new Map(snapshot.data?.rows.map((row) => [row.id, row])),
    [snapshot.data],
  );
  const common =
    catalog.data?.settings.filter((setting) => catalog.data?.featuredIds.includes(setting.id)) ??
    [];
  const ready = Boolean(snapshot.data) && !snapshot.isFetching && !snapshot.isError;
  function selectPreset(mode: 'safe' | 'enhanced' | 'all' | 'restore') {
    if (!catalog.data || !snapshot.data || !ready) {
      setNotice('请先完成实际配置扫描。');
      return;
    }
    const entries = presetEntries(catalog.data, snapshot.data, mode);
    if (!entries.length) {
      setNotice('当前没有需要调整的适用配置。');
      return;
    }
    replaceDrafts(entries);
    setNotice('预设仅生成待应用清单，尚未修改系统。');
    setDialog({ kind: 'review' });
  }
  return (
    <WorkspaceLayout workspace={workspace} active="optimization">
      <main id="main-content" className="optimization-main" tabIndex={-1}>
        <header className="optimization-heading" data-home-enter>
          <div className="optimization-title">
            <h1>系统优化</h1>
            <span className="optimization-source">
              {catalog.data ? '本机配置 · 201 项' : '未连接'}
            </span>
          </div>
          <p>按需调整，让系统更合心意。</p>
          <p className="optimization-date">
            {new Intl.DateTimeFormat('zh-CN', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              weekday: 'long',
            }).format(new Date())}
          </p>
        </header>
        <div className="optimization-toolbar" data-home-enter>
          <label className="optimization-search glass">
            <Icon icon={faMagnifyingGlass} />
            <input
              type="search"
              aria-label="搜索系统设置"
              placeholder="搜索名称、功能或配置标识…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query && (
              <button type="button" aria-label="清空系统设置搜索" onClick={() => setQuery('')}>
                <Icon icon={faXmark} />
              </button>
            )}
          </label>
          <button
            type="button"
            className="optimization-detect"
            disabled={snapshot.isFetching || catalog.isPending}
            onClick={() => {
              void snapshot.refetch();
            }}
          >
            <Icon icon={faDisplay} />
            {snapshot.isFetching ? '正在扫描配置…' : '检测当前配置'}
          </button>
          <button
            type="button"
            className="optimization-history glass"
            disabled={!catalog.data}
            onClick={() => setDialog({ kind: 'history' })}
          >
            <Icon icon={faClock} />
            修改记录
          </button>
        </div>
        {catalog.isPending ? (
          <p className="optimization-empty glass" role="status">
            正在连接 Rust 优化服务…
          </p>
        ) : catalog.error ? (
          <div className="optimization-empty glass" role="alert">
            <h2>优化目录暂不可用</h2>
            <p>{errorMessage(catalog.error)}</p>
            <button
              type="button"
              className="mint-button"
              onClick={() => {
                void catalog.refetch();
              }}
            >
              重新连接
            </button>
          </div>
        ) : (
          <>
            <section className="optimization-native-summary glass" aria-label="实际配置概览">
              {snapshot.data ? (
                <>
                  <div>
                    <strong>
                      Windows 构建 {snapshot.data.osBuild} · {snapshot.data.rows.length} 项
                    </strong>
                    <small>
                      最近扫描 {new Date(snapshot.data.checkedAt).toLocaleString('zh-CN')}{' '}
                      {snapshot.isFetching ? '· 正在刷新' : ''}
                    </small>
                  </div>
                  <div className="optimization-scan-counts">
                    <span>
                      目标匹配{' '}
                      {snapshot.data.rows.filter((row) => row.state === 'configured').length}
                    </span>
                    <span>
                      预设匹配 {snapshot.data.rows.filter((row) => row.state === 'baseline').length}
                    </span>
                    <span>
                      不适用{' '}
                      {snapshot.data.rows.filter((row) => row.state === 'unsupported').length}
                    </span>
                    <span>
                      读取失败 {snapshot.data.rows.filter((row) => row.state === 'error').length}
                    </span>
                  </div>
                </>
              ) : (
                <p role="status">
                  {snapshot.isFetching
                    ? '正在读取本机实际配置；不会自动执行优化。'
                    : '尚未取得本机配置。'}
                </p>
              )}
              {snapshot.error && (
                <p role="alert">
                  {errorMessage(snapshot.error)}。现有读数为上次扫描结果，请重新扫描。
                </p>
              )}
            </section>
            <div className="optimization-preset-toolbar" aria-label="批量配置预设">
              <button
                type="button"
                className="mint-button"
                disabled={!ready}
                onClick={() => selectPreset('safe')}
              >
                安全优化
              </button>
              <button
                type="button"
                className="optimization-secondary"
                disabled={!ready}
                onClick={() => selectPreset('enhanced')}
              >
                增强优化
              </button>
              <button
                type="button"
                className="optimization-secondary"
                disabled={!ready}
                onClick={() => selectPreset('all')}
              >
                全部优化
              </button>
              <button
                type="button"
                className="optimization-secondary"
                disabled={!ready}
                onClick={() => selectPreset('restore')}
              >
                批量恢复
              </button>
              <button
                type="button"
                className="optimization-secondary"
                onClick={() => setDialog({ kind: 'review' })}
              >
                待应用（{drafts.length}）
              </button>
              <p>
                预设将替换待应用清单；先审阅并逐项确认，再执行。批量恢复使用参考预设；精确撤销请查看修改记录。
              </p>
            </div>
            {notice && (
              <p role="status" className="optimization-notice">
                {notice} 当前待应用 {drafts.length} 项。
              </p>
            )}
            <div className="optimization-content" data-home-enter>
              {query.trim() ? (
                <section>
                  <h2>搜索结果 · {result.settings.length} 项</h2>
                  <OptimizationSettingList
                    settings={result.settings}
                    {...(snapshot.data ? { snapshot: snapshot.data } : {})}
                    onOpen={(id) => setDialog({ kind: 'setting', id })}
                  />
                  {!result.settings.length && (
                    <p className="optimization-empty glass">
                      没有找到匹配的配置，试试功能名称、分类或标识。
                    </p>
                  )}
                </section>
              ) : (
                <>
                  <section
                    className="optimization-categories"
                    aria-labelledby="optimization-categories-title"
                  >
                    <h2 id="optimization-categories-title">优化分类</h2>
                    <div className="optimization-grid">
                      {result.categories.map((category) => (
                        <OptimizationCategoryCard
                          key={category.id}
                          category={category}
                          onOpen={(id) => setDialog({ kind: 'category', id })}
                        />
                      ))}
                    </div>
                  </section>
                  <section
                    className="optimization-common"
                    aria-labelledby="optimization-common-title"
                  >
                    <h2 id="optimization-common-title">常用设置</h2>
                    <div className="optimization-common-panel glass">
                      {common.map((setting) => {
                        const row = rows.get(setting.id);
                        return (
                          <OptimizationCommonCard
                            key={setting.id}
                            setting={setting}
                            {...(row ? { row } : {})}
                            onOpen={(id) => setDialog({ kind: 'setting', id })}
                          />
                        );
                      })}
                    </div>
                  </section>
                </>
              )}
            </div>
          </>
        )}
        <footer className="optimization-footer">
          <Icon icon={faCircleInfo} />
          <span>
            配置匹配不等于系统已采用或性能提升。修改前核对风险，备份与日志均保存在应用数据目录。
          </span>
        </footer>
        {dialog && catalog.data && (
          <OptimizationDialogs
            dialog={dialog}
            catalog={catalog.data}
            {...(snapshot.data ? { snapshot: snapshot.data } : {})}
            onClose={() => setDialog(null)}
            onChange={setDialog}
          />
        )}
      </main>
    </WorkspaceLayout>
  );
}
