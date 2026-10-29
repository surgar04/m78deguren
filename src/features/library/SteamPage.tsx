import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import {
  faRotateRight,
  faPlay,
  faMagnifyingGlass,
  faTableCellsLarge,
  faList,
  faArrowUpRightFromSquare,
  faFolderOpen,
  faDownload,
  faTrashCan,
  faClock,
  faUsers,
  faHardDrive,
  faCloudArrowDown,
  faRotateLeft,
} from '@fortawesome/free-solid-svg-icons';
import { faSteam } from '@fortawesome/free-brands-svg-icons';
import { WorkspaceLayout } from '@/features/home/components/WorkspaceLayout';
import { Modal } from '@/features/home/components/Modal';
import { Icon } from '@/features/home/components/Icon';
import { useGameWorkspace } from '@/features/home/useGameWorkspace';
import { useHomePreferences } from '@/features/home/store';
import { useCatalogView } from './view-store';
import { useSteam, useSteamAction, useSteamBackups } from './repository';
import { SteamCard } from './SteamCard';
import { SteamAccountCard } from './SteamAccountCard';
import {
  PAGE_SIZE,
  selectSteamGames,
  bytesText,
  playtimeText,
  playedText,
  type SteamFilter,
  type SteamSort,
} from './steam-model';
import {
  steamSnapshotSchema,
  steamBackupSchema,
  type SteamGame,
  type SteamAccount,
  type SteamBackup,
  type SteamRequest,
} from '@/lib/steam-contracts';
import { errorMessage, isDesktop } from '@/lib/desktop';
import './library.css';
import './steam.css';
import { LibraryNavigation } from './LibraryNavigation';
import './other-games.css';

type View = 'games' | 'accounts' | 'disks';
type Confirmation =
  | { kind: 'switch' | 'remove'; account: SteamAccount }
  | { kind: 'install' | 'uninstall'; game: SteamGame }
  | { kind: 'restore'; backup: SteamBackup }
  | { kind: 'public-sync' };
/** 业务状态只来自原生 Steam Query；Zustand 仅保存收藏和视图偏好。分页派生，不复制后端列表。 */
export default function SteamPage() {
  const workspace = useGameWorkspace(),
    query = useSteam(),
    data = query.data;
  const favorites = useHomePreferences((state) => state.favorites),
    toggleFavorite = useHomePreferences((state) => state.toggleFavorite);
  const { view, setView } = useCatalogView();
  const [tab, setTab] = useState<View>('games');
  const [params, setParams] = useSearchParams();
  const search = (params.get('search') ?? '').slice(0, 256);
  const setSearch = (value: string) => setParams(value ? { search: value } : {}, { replace: true });
  const [filter, setFilter] = useState<SteamFilter>('all'),
    [sort, setSort] = useState<SteamSort>('recent'),
    [library, setLibrary] = useState('');
  // 翻页上限与筛选签名绑定：条件变更自然回到首屏，不在 effect 中派生 setState。
  const [paging, setPaging] = useState({ key: '', count: PAGE_SIZE });
  const [detailsId, setDetailsId] = useState<number | null>(null),
    [confirmation, setConfirmation] = useState<Confirmation | null>(null),
    [consent, setConsent] = useState(false),
    [notice, setNotice] = useState(''),
    [history, setHistory] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [confirmedRevision, setConfirmedRevision] = useState('');
  const details = data?.games.find((game) => game.appId === detailsId) ?? null;
  const simple = useSteamAction(z.null()),
    refresh = useSteamAction(steamSnapshotSchema),
    accountAction = useSteamAction(steamBackupSchema);
  const backups = useSteamBackups(history);
  const busy = simple.isPending || refresh.isPending || accountAction.isPending;
  const games = selectSteamGames(data?.games ?? [], search, filter, sort, favorites, library);
  const pageKey = JSON.stringify([search, filter, sort, library]);
  const requested = paging.key === pageKey ? paging.count : PAGE_SIZE;
  const pageIndex = Math.min(
    Math.max(0, Math.ceil(games.length / PAGE_SIZE) - 1),
    Math.max(0, Math.floor(requested / PAGE_SIZE) - 1),
  );
  const count = (pageIndex + 1) * PAGE_SIZE;
  const visible = games.slice(pageIndex * PAGE_SIZE, count);
  const current = data?.accounts.find((account) => account.id === data.currentAccount);
  const fail = (cause: unknown) => setNotice(errorMessage(cause));
  const openConfirmation = (value: Confirmation) => {
    setConfirmedRevision(data?.revision ?? '');
    setApiKey('');
    setConsent(false);
    setNotice('');
    setConfirmation(value);
  };
  const execute = (request: SteamRequest) =>
    simple.mutate(request, {
      onError: fail,
      onSuccess: () =>
        setNotice('请求已交给 Steam；实际启动、下载或卸载状态请以客户端为准，可稍后刷新。'),
    });
  const launch = (game: SteamGame) =>
    game.installed
      ? execute({ operation: 'launch', kind: 'run', appId: game.appId, consent: true })
      : openConfirmation({ kind: 'install', game });
  const confirm = () => {
    if (!confirmation || !consent) return;
    if (confirmation.kind === 'switch' || confirmation.kind === 'remove') {
      if (!data) return;
      accountAction.mutate(
        {
          operation: 'account',
          kind: confirmation.kind,
          id: confirmation.account.id,
          revision: confirmedRevision,
          consent: true,
        },
        {
          onError: fail,
          onSuccess: (receipt) => {
            setConfirmation(null);
            setNotice(receipt.message);
          },
        },
      );
    } else if (confirmation.kind === 'restore') {
      accountAction.mutate(
        { operation: 'restore', id: confirmation.backup.id, consent: true },
        {
          onError: fail,
          onSuccess: (receipt) => {
            setConfirmation(null);
            setNotice(receipt.message);
          },
        },
      );
    } else if (confirmation.kind === 'public-sync') {
      refresh.mutate(
        { operation: 'public-sync', consent: true, apiKey: apiKey.trim() || null },
        {
          onError: (cause) => {
            setApiKey('');
            refresh.reset();
            fail(cause);
          },
          onSuccess: () => {
            setConfirmation(null);
            refresh.reset();
            setApiKey('');
            setNotice('已同步该账号接口可见的游戏库。');
          },
        },
      );
    } else if (confirmation.kind === 'install' || confirmation.kind === 'uninstall') {
      simple.mutate(
        {
          operation: 'launch',
          kind: confirmation.kind,
          appId: confirmation.game.appId,
          consent: true,
        },
        {
          onError: fail,
          onSuccess: () => {
            setConfirmation(null);
            setDetailsId(null);
            setNotice('已提交 Steam 请求，请在客户端确认目标游戏与安装位置；列表将在刷新后更新。');
          },
        },
      );
    }
  };
  const title =
    confirmation?.kind === 'switch'
      ? '切换本机账号'
      : confirmation?.kind === 'remove'
        ? '移除本机账号记录'
        : confirmation?.kind === 'restore'
          ? '恢复本地账号备份'
          : confirmation?.kind === 'public-sync'
            ? '同步公开游戏库'
            : confirmation?.kind === 'uninstall'
              ? '启动 Steam 卸载流程'
              : '发送游戏安装请求';
  return (
    <WorkspaceLayout workspace={workspace} active="library">
      <main id="main-content" className="catalog-main steam-main" tabIndex={-1}>
        <header className="catalog-heading" data-home-enter>
          <h1>
            游戏库 <span className="steam-live-badge">真实 Steam 数据</span>
          </h1>
          <p>你的游戏，随时出发。</p>
          <p className="catalog-date">
            {new Date().toLocaleDateString('zh-CN', { dateStyle: 'full' })}
          </p>
          <div className="catalog-actions">
            <button
              type="button"
              className="catalog-add"
              disabled={!data?.installed || busy}
              onClick={() =>
                execute({ operation: 'launch', kind: 'client', appId: null, consent: true })
              }
            >
              <Icon icon={faSteam} />
              {data?.running ? '打开 Steam' : '启动 Steam'}
            </button>
            <button
              type="button"
              className="catalog-scan glass"
              disabled={!isDesktop() || busy || query.isFetching}
              onClick={() =>
                refresh.mutate(
                  { operation: 'snapshot', refresh: true },
                  { onError: fail, onSuccess: () => setNotice('Steam 数据已刷新。') },
                )
              }
            >
              <Icon icon={faRotateRight} />
              {query.isFetching || refresh.isPending ? '读取中…' : '刷新数据'}
            </button>
          </div>
        </header>
        <LibraryNavigation />
        {!isDesktop() ? (
          <p className="steam-message">
            需要在 Windows 桌面端读取 Steam；网页不会显示模拟账号或游戏。
          </p>
        ) : query.isPending ? (
          <p className="steam-message" role="status">
            正在读取本机 Steam 配置与游戏清单…
          </p>
        ) : null}
        {query.error && (
          <p className="steam-error" role="alert">
            {errorMessage(query.error)}
            {data ? ' · 当前保留上次读取结果' : ''}
          </p>
        )}
        {notice && (
          <p className="steam-message" role="status">
            {notice}
          </p>
        )}
        {data && !data.installed && (
          <section className="steam-message glass">
            <h2>没有检测到 Steam</h2>
            <p>
              请先安装 Steam 客户端。检测会读取注册表、运行进程及常见安装目录，不会自动安装客户端。
            </p>
          </section>
        )}
        {data?.installed && (
          <>
            <section className="steam-status glass" aria-label="Steam 客户端状态">
              <div>
                <Icon icon={faSteam} />
                <strong>{data.running ? 'Steam 正在运行' : 'Steam 未运行'}</strong>
                <span>
                  {current
                    ? `当前/最近账号：${current.name || current.accountName}`
                    : '尚无本地已保存账号'}
                </span>
              </div>
              <p>{data.path}</p>
              <small>读取时间：{new Date(data.capturedAt).toLocaleTimeString('zh-CN')}</small>
            </section>
            {data.warnings.length > 0 && (
              <details className="steam-warnings">
                <summary>读取诊断（{data.warnings.length}）</summary>
                {data.warnings.slice(0, 100).map((warning, index) => (
                  <p key={index}>{warning}</p>
                ))}
              </details>
            )}
            <nav className="steam-tabs glass" aria-label="游戏库栏目">
              {(
                [
                  { id: 'games', label: '游戏', icon: faSteam },
                  { id: 'accounts', label: '本机账号', icon: faUsers },
                  { id: 'disks', label: '存储空间', icon: faHardDrive },
                ] as const
              ).map((item) => (
                <button
                  type="button"
                  key={item.id}
                  aria-current={tab === item.id ? 'page' : undefined}
                  className={tab === item.id ? 'active' : ''}
                  onClick={() => setTab(item.id)}
                >
                  <Icon icon={item.icon} />
                  {item.label}
                  {item.id === 'games'
                    ? ` ${data.games.length}`
                    : item.id === 'accounts'
                      ? ` ${data.accounts.length}`
                      : ''}
                </button>
              ))}
            </nav>
            {tab === 'games' && (
              <>
                <div className="steam-inventory-note">
                  <p>
                    {data.inventoryComplete
                      ? '已同步当前账号公开可见的库存；本机其他安装仍单独保留。'
                      : '当前为本机安装清单和当前/最近账号的游玩缓存，可能不完整；不会将本地安装等同于当前账号拥有。'}
                  </p>
                  <button
                    type="button"
                    disabled={!current || busy}
                    onClick={() => openConfirmation({ kind: 'public-sync' })}
                  >
                    <Icon icon={faCloudArrowDown} />
                    同步公开游戏库
                  </button>
                </div>
                <div className="steam-toolbar">
                  <label className="catalog-search">
                    <Icon icon={faMagnifyingGlass} />
                    <input
                      aria-label="搜索 Steam 游戏"
                      type="search"
                      placeholder="搜索游戏名称或 App ID…"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                    />
                  </label>
                  <select
                    aria-label="游戏状态"
                    value={filter}
                    onChange={(event) => {
                      const parsed = z
                        .enum(['all', 'installed', 'uninstalled', 'owned', 'favorites'])
                        .safeParse(event.target.value);
                      if (parsed.success) setFilter(parsed.data);
                    }}
                  >
                    <option value="all">全部 {data.games.length}</option>
                    <option value="installed">
                      已安装 {data.games.filter((g) => g.installed).length}
                    </option>
                    <option value="uninstalled">未安装</option>
                    <option value="owned">已确认拥有</option>
                    <option value="favorites">收藏</option>
                  </select>
                  <select
                    aria-label="所在游戏库"
                    value={library}
                    onChange={(event) => setLibrary(event.target.value)}
                  >
                    <option value="">全部游戏库</option>
                    {data.libraries.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.path}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="游戏排序"
                    value={sort}
                    onChange={(event) => {
                      const parsed = z
                        .enum(['recent', 'name', 'playtime', 'size'])
                        .safeParse(event.target.value);
                      if (parsed.success) setSort(parsed.data);
                    }}
                  >
                    <option value="recent">最近游玩</option>
                    <option value="name">游戏名称</option>
                    <option value="playtime">游玩时长</option>
                    <option value="size">磁盘占用</option>
                  </select>
                  <div className="steam-view">
                    <button
                      type="button"
                      aria-label="网格视图"
                      aria-pressed={view === 'grid'}
                      onClick={() => setView('grid')}
                    >
                      <Icon icon={faTableCellsLarge} />
                    </button>
                    <button
                      type="button"
                      aria-label="列表视图"
                      aria-pressed={view === 'list'}
                      onClick={() => setView('list')}
                    >
                      <Icon icon={faList} />
                    </button>
                  </div>
                </div>
                <section aria-label="真实 Steam 游戏列表" className="catalog-results">
                  <div className={`catalog-grid ${view === 'list' ? 'catalog-list' : ''}`}>
                    {visible.map((game) => (
                      <SteamCard
                        key={game.appId}
                        game={game}
                        favorite={favorites.includes(`steam:${game.appId}`)}
                        onFavorite={() => toggleFavorite(`steam:${game.appId}`)}
                        onDetails={() => setDetailsId(game.appId)}
                        onLaunch={() => launch(game)}
                        disabled={busy}
                      />
                    ))}
                  </div>
                  {games.length === 0 && (
                    <div className="catalog-empty">
                      <Icon icon={faMagnifyingGlass} />
                      <h2>{data.games.length ? '没有匹配的游戏' : '尚未发现游戏记录'}</h2>
                      <p>调整筛选条件、登录 Steam 后刷新，或同步该账号公开可见的游戏列表。</p>
                    </div>
                  )}
                  <div className="steam-pagination">
                    <p role="status">
                      第 {games.length ? pageIndex + 1 : 0} / {Math.ceil(games.length / PAGE_SIZE)}{' '}
                      页 · 共 {games.length} 款游戏
                    </p>
                    {pageIndex > 0 && (
                      <button
                        type="button"
                        onClick={() => setPaging({ key: pageKey, count: count - PAGE_SIZE })}
                      >
                        上一页
                      </button>
                    )}
                    {count < games.length && (
                      <button
                        type="button"
                        onClick={() => setPaging({ key: pageKey, count: count + PAGE_SIZE })}
                      >
                        下一页（{PAGE_SIZE}）
                      </button>
                    )}
                  </div>
                </section>
              </>
            )}
            {tab === 'accounts' && (
              <section className="steam-accounts">
                <div className="steam-section-heading">
                  <h2>本机保存的账号</h2>
                  <button type="button" onClick={() => setHistory(true)}>
                    <Icon icon={faRotateLeft} />
                    操作记录与恢复
                  </button>
                </div>
                <p className="steam-subtle">
                  来自 loginusers.vdf，仅管理本机记录。不会读取密码，不会绕过 Steam
                  Guard；切换或移除前会正常退出 Steam。
                </p>
                {data.accounts.map((account) => (
                  <SteamAccountCard
                    key={account.id}
                    account={account}
                    current={account.id === data.currentAccount}
                    busy={busy}
                    onSwitch={() => openConfirmation({ kind: 'switch', account })}
                    onRemove={() => openConfirmation({ kind: 'remove', account })}
                  />
                ))}
                {!data.accounts.length && (
                  <p className="steam-message">本机没有已保存的账号，请在 Steam 客户端登录。</p>
                )}
              </section>
            )}
            {tab === 'disks' && (
              <section className="steam-disks">
                {data.libraries.map((entry) => (
                  <article className="glass steam-disk" key={entry.id}>
                    <h2>
                      <Icon icon={faHardDrive} />
                      {entry.path}
                    </h2>
                    <p>{entry.available ? `${entry.games} 款清单游戏` : '目录离线或不可访问'}</p>
                    <dl>
                      <div>
                        <dt>磁盘总容量</dt>
                        <dd>{bytesText(entry.totalBytes)}</dd>
                      </div>
                      <div>
                        <dt>磁盘可用空间</dt>
                        <dd>{bytesText(entry.freeBytes)}</dd>
                      </div>
                      <div>
                        <dt>Steam 清单占用</dt>
                        <dd>{bytesText(entry.steamBytes)}</dd>
                      </div>
                    </dl>
                    {entry.totalBytes !== null &&
                      entry.freeBytes !== null &&
                      entry.totalBytes > 0 && (
                        <progress
                          aria-label="磁盘整体使用率"
                          max={entry.totalBytes}
                          value={Math.max(0, entry.totalBytes - entry.freeBytes)}
                        />
                      )}
                    <p className="steam-subtle">
                      容量与可用空间是所在磁盘的整体值；Steam
                      占用来自安装清单，不递归扫描游戏文件。多个库位于同一磁盘时容量相同。
                    </p>
                  </article>
                ))}
              </section>
            )}
          </>
        )}
        {details && (
          <Modal
            title={details.name}
            onClose={() => {
              if (!busy) setDetailsId(null);
            }}
          >
            <div className="steam-details">
              <dl>
                <div>
                  <dt>App ID</dt>
                  <dd>{details.appId}</dd>
                </div>
                <div>
                  <dt>安装状态</dt>
                  <dd>
                    {details.installed
                      ? details.installComplete
                        ? '已安装'
                        : '安装未完成'
                      : '未安装'}
                  </dd>
                </div>
                <div>
                  <dt>当前账号库存</dt>
                  <dd>
                    {details.owned === true
                      ? '公开游戏库已确认'
                      : details.owned === false
                        ? '未出现在公开列表'
                        : '本地缓存无法确认所有权'}
                  </dd>
                </div>
                <div>
                  <dt>
                    <Icon icon={faClock} />
                    游玩时长
                  </dt>
                  <dd>{playtimeText(details.playtimeMinutes)}</dd>
                </div>
                <div>
                  <dt>最近游玩</dt>
                  <dd>{playedText(details.lastPlayed)}</dd>
                </div>
                <div>
                  <dt>占用空间</dt>
                  <dd>{bytesText(details.sizeBytes)}</dd>
                </div>
                <div>
                  <dt>安装位置</dt>
                  <dd>{details.installPath ?? '未安装'}</dd>
                </div>
              </dl>
              <div className="steam-detail-actions">
                <button
                  type="button"
                  className="mint-button"
                  disabled={busy}
                  onClick={() => launch(details)}
                >
                  <Icon icon={details.installed ? faPlay : faDownload} />
                  {details.installed ? '启动游戏' : '安装游戏'}
                </button>
                <button
                  type="button"
                  disabled={busy || !details.installed}
                  onClick={() =>
                    execute({ operation: 'open', kind: 'folder', appId: details.appId })
                  }
                >
                  <Icon icon={faFolderOpen} />
                  打开安装目录
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    execute({ operation: 'open', kind: 'store', appId: details.appId })
                  }
                >
                  <Icon icon={faArrowUpRightFromSquare} />
                  打开商店
                </button>
                {details.installed && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => openConfirmation({ kind: 'uninstall', game: details })}
                  >
                    <Icon icon={faTrashCan} />
                    卸载游戏
                  </button>
                )}
              </div>
            </div>
          </Modal>
        )}
        {confirmation && (
          <Modal
            title={title}
            onClose={() => {
              if (!busy) {
                setApiKey('');
                setConfirmation(null);
              }
            }}
          >
            <div className="steam-confirm">
              {confirmation.kind === 'public-sync' && (
                <label className="steam-api-key">
                  Steam Web API Key（可选，仅本次使用）
                  <input
                    type="password"
                    autoComplete="off"
                    value={apiKey}
                    disabled={busy}
                    maxLength={32}
                    placeholder="公开入口需登录时，可使用自己的官方 API Key"
                    onChange={(event) => setApiKey(event.target.value)}
                  />
                </label>
              )}
              <p>
                {confirmation.kind === 'switch' || confirmation.kind === 'remove'
                  ? `目标：${confirmation.account.name || confirmation.account.accountName}（${confirmation.account.accountName}）`
                  : confirmation.kind === 'install' || confirmation.kind === 'uninstall'
                    ? `目标：${confirmation.game.name} · App ${confirmation.game.appId}`
                    : confirmation.kind === 'restore'
                      ? `备份时间：${new Date(confirmation.backup.createdAt).toLocaleString('zh-CN')}`
                      : '仅将当前/最近账号的 Steam ID 和你本次输入的可选 Web API Key 发给 Valve 官方接口。Key 不落盘，用后清除；不读取 Steam 密码、登录令牌或 Steam Guard。'}
              </p>
              <p>
                {confirmation.kind === 'switch'
                  ? '会正常退出并重启 Steam，修改本机登录选择和 AutoLoginUser。请先保存游戏进度、暂停下载。Steam 仍可能要求密码或 Steam Guard；不会强制结束客户端。'
                  : confirmation.kind === 'remove'
                    ? '仅移除本机账号选择记录和对应自动登录设置，不删除云端 Steam 账号、游戏、存档或共享登录令牌。会正常退出 Steam 并保持关闭；修改前保存 应用备份。'
                    : confirmation.kind === 'restore'
                      ? '会正常退出 Steam。仅在配置与备份指纹仍匹配时恢复，避免覆盖后来新增的账号；恢复后 Steam 保持关闭。'
                      : confirmation.kind === 'public-sync'
                        ? '私密账号、隐藏游戏详情或 Steam 接口不可用时会明确报错并保留本地数据，不伪造空库存。'
                        : confirmation.kind === 'uninstall'
                          ? '将打开 Steam 官方卸载流程，由你在客户端最终确认。臻境不会直接删除游戏文件，卸载后的游戏文件恢复不由臻境保证。'
                          : '将发送安装请求，由你在 Steam 客户端确认安装位置、磁盘空间和下载任务；不会由臻境静默安装。'}
              </p>
              <label>
                <input
                  type="checkbox"
                  checked={consent}
                  disabled={busy}
                  onChange={(event) => setConsent(event.target.checked)}
                />
                我已了解并确认上述操作
              </label>
              <button
                type="button"
                className="mint-button"
                disabled={
                  !consent ||
                  busy ||
                  (confirmation.kind === 'public-sync' &&
                    apiKey.trim() !== '' &&
                    !/^[a-fA-F0-9]{32}$/u.test(apiKey.trim()))
                }
                onClick={confirm}
              >
                {busy ? '正在执行，请勿关闭…' : '确认执行'}
              </button>
              {notice && (
                <p role="alert" className="steam-error">
                  {notice}
                </p>
              )}
            </div>
          </Modal>
        )}
        {history && (
          <Modal
            title="本地账号操作记录与恢复"
            wide
            onClose={() => {
              if (!busy) setHistory(false);
            }}
          >
            <div className="steam-backups">
              {backups.isPending ? (
                <p>正在读取 应用备份…</p>
              ) : backups.error ? (
                <p role="alert">{errorMessage(backups.error)}</p>
              ) : !backups.data?.length ? (
                <p>尚无账号操作记录。</p>
              ) : (
                backups.data.map((backup) => (
                  <article key={backup.id}>
                    <strong>
                      {backup.kind === 'switch' ? '切换账号' : '移除本机记录'} ·{' '}
                      {new Date(backup.createdAt).toLocaleString('zh-CN')}
                    </strong>
                    <p>{backup.message}</p>
                    <small>{backup.state}</small>
                    <button
                      type="button"
                      disabled={busy || backup.state !== 'completed'}
                      onClick={() => {
                        setHistory(false);
                        openConfirmation({ kind: 'restore', backup });
                      }}
                    >
                      恢复备份
                    </button>
                  </article>
                ))
              )}
            </div>
          </Modal>
        )}
      </main>
    </WorkspaceLayout>
  );
}
