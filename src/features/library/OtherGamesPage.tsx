import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import {
  faGamepad,
  faMagnifyingGlass,
  faRotateRight,
  faFolderOpen,
  faPlay,
  faStop,
  faSliders,
  faCompass,
  faWifi,
} from '@fortawesome/free-solid-svg-icons';
import { WorkspaceLayout } from '@/features/home/components/WorkspaceLayout';
import { Icon } from '@/features/home/components/Icon';
import { useGameWorkspace } from '@/features/home/useGameWorkspace';
import {
  otherGamesSchema,
  REGION_LABELS,
  regionSchema,
  type OtherGame,
} from '@/lib/launcher-contracts';
import { errorMessage, isDesktop } from '@/lib/desktop';
import {
  useOtherGames,
  useOtherAction,
  useGameProfiles,
  useLaunchIcon,
} from '@/features/quick-launch/repository';
import { LibraryNavigation } from './LibraryNavigation';
import './library.css';
import './steam.css';
import './other-games.css';
function GameCard({
  game,
  onLaunch,
  onFolder,
  onRegion,
  busy,
}: {
  game: OtherGame;
  onLaunch: () => void;
  onFolder: () => void;
  onRegion: (region: OtherGame['region']) => void;
  busy: boolean;
}) {
  const icon = useLaunchIcon(game.id);
  const navigate = useNavigate();
  const [details, setDetails] = useState(false);
  return (
    <article className={`other-game-card glass ${game.available ? '' : 'unavailable'}`}>
      <div className="other-game-top">
        <div className="other-game-art">
          {icon.data ? <img src={icon.data} alt="" /> : <Icon icon={faGamepad} />}
        </div>
        <span className={`game-region region-${game.region}`}>{REGION_LABELS[game.region]}</span>
      </div>
      <h2>{game.name}</h2>
      <p className="other-game-source">
        {game.steamAppId ? '通过 Steam 启动' : game.launcher ? '通过官方启动器启动' : '游戏客户端'}
        {game.version ? ` · ${game.version}` : ''}
      </p>
      <p className="other-game-path" title={game.path}>
        {game.path}
      </p>
      <div className="other-game-buttons">
        <button
          type="button"
          className="other-launch"
          disabled={busy || !game.available}
          onClick={onLaunch}
        >
          <Icon icon={faPlay} />
          {game.available ? '启动游戏' : '路径不可用'}
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={`打开 ${game.name} 目录`}
          onClick={onFolder}
        >
          <Icon icon={faFolderOpen} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={`${game.name} 区服详情`}
          aria-expanded={details}
          onClick={() => setDetails(!details)}
        >
          <Icon icon={faSliders} />
        </button>
      </div>
      {game.region === 'cn' && game.available && (
        <button
          type="button"
          className="native-button"
          disabled={busy}
          onClick={() => {
            void navigate(`/tools/game-acceleration?game=${encodeURIComponent(game.id)}`);
          }}
        >
          <Icon icon={faWifi} /> 国服加速准备
        </button>
      )}
      {details && (
        <div className="other-game-evidence">
          <p>
            识别依据：
            {game.evidence.join('；') || '共用客户端，暂无足够区服证据，请按实际安装确认。'}
          </p>
          <label>
            确认当前安装区服
            <select
              aria-label={`${game.name} 区服`}
              disabled={busy}
              value={game.region}
              onChange={(event) => {
                const parsed = regionSchema.safeParse(event.target.value);
                if (parsed.success) onRegion(parsed.data);
              }}
            >
              {regionSchema.options.map((region) => (
                <option key={region} value={region}>
                  {REGION_LABELS[region]}
                </option>
              ))}
            </select>
          </label>
          {game.launcher && <p>启动器：{game.launcher}</p>}
        </div>
      )}
    </article>
  );
}
export default function OtherGamesPage() {
  const workspace = useGameWorkspace(),
    query = useOtherGames(),
    profiles = useGameProfiles(),
    launch = useOtherAction(z.null()),
    action = useOtherAction(otherGamesSchema),
    simple = useOtherAction(z.null());
  const [search, setSearch] = useState(''),
    [region, setRegion] = useState('all'),
    [family, setFamily] = useState('all'),
    [notice, setNotice] = useState('');
  const data = query.data,
    busy = !!data?.running || action.isPending;
  const games = (data?.games ?? []).filter(
    (game) =>
      game.available &&
      (family === 'all' || game.family === family) &&
      (region === 'all' ||
        (region === 'global'
          ? ['global', 'jp', 'kr', 'tw'].includes(game.region)
          : game.region === region)) &&
      [game.name, game.path, REGION_LABELS[game.region]]
        .join(' ')
        .toLocaleLowerCase()
        .includes(search.trim().toLocaleLowerCase()),
  );
  const fail = (cause: unknown) => setNotice(errorMessage(cause));
  return (
    <WorkspaceLayout workspace={workspace} active="library">
      <main id="main-content" className="catalog-main steam-main other-games-main" tabIndex={-1}>
        <header className="catalog-heading" data-home-enter>
          <h1>
            游戏库 <span className="steam-live-badge">本地游戏发现</span>
          </h1>
          <p>发现你的游戏，一键回到热爱。</p>
          <p className="catalog-date">
            {new Date().toLocaleDateString('zh-CN', { dateStyle: 'full' })}
          </p>
        </header>
        <LibraryNavigation />
        <div className="other-games-toolbar glass">
          <label className="other-search">
            <Icon icon={faMagnifyingGlass} />
            <input
              value={search}
              maxLength={256}
              placeholder="搜索游戏或安装路径…"
              aria-label="搜索其他游戏"
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <select aria-label="游戏分类" value={family} onChange={(e) => setFamily(e.target.value)}>
            <option value="all">全部游戏</option>
            {profiles.data?.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
          <select aria-label="筛选区服" value={region} onChange={(e) => setRegion(e.target.value)}>
            <option value="all">全部区服</option>
            <option value="cn">国服</option>
            <option value="global">国际服</option>
            <option value="unknown">待确认</option>
          </select>
          <button
            type="button"
            disabled={!isDesktop() || busy}
            onClick={() => action.mutate({ operation: 'scan', deep: false }, { onError: fail })}
          >
            <Icon icon={faRotateRight} />
            快速搜索
          </button>
          <button
            type="button"
            className="other-launch"
            disabled={!isDesktop() || busy}
            onClick={() => action.mutate({ operation: 'scan', deep: true }, { onError: fail })}
          >
            <Icon icon={faCompass} />
            深度搜索
          </button>
        </div>
        <div className="other-scan-status" role="status">
          <span>
            {data?.running
              ? `正在搜索 · 已检查 ${data.visited.toLocaleString()} 个位置`
              : data?.message || '仅读取本机安装信息，找到哪个就显示哪个。'}
          </span>
          {data?.running ? (
            <button
              type="button"
              disabled={simple.isPending}
              onClick={() => simple.mutate({ operation: 'cancel' }, { onError: fail })}
            >
              <Icon icon={faStop} />
              停止搜索
            </button>
          ) : (
            <button
              type="button"
              disabled={!isDesktop() || action.isPending}
              onClick={() =>
                action.mutate(
                  { operation: 'choose-root' },
                  { onError: fail, onSuccess: () => setNotice('目录已加入，请点击快速搜索。') },
                )
              }
            >
              <Icon icon={faFolderOpen} />
              指定搜索目录
            </button>
          )}
        </div>
        {!isDesktop() && (
          <p className="steam-message">请在桌面端搜索真实安装。网页不会显示模拟游戏。</p>
        )}
        {(notice || query.error || action.error || launch.error || simple.error) && (
          <p className="steam-error" role="alert">
            {notice || errorMessage(query.error ?? action.error ?? launch.error ?? simple.error)}
          </p>
        )}
        <div className="other-games-grid">
          {games.map((game) => (
            <GameCard
              key={game.id}
              game={game}
              busy={launch.isPending || busy}
              onLaunch={() =>
                launch.mutate(
                  { operation: 'launch', id: game.id },
                  {
                    onError: fail,
                    onSuccess: () =>
                      setNotice('启动请求已提交；需要更新或登录时请在官方启动器完成。'),
                  },
                )
              }
              onFolder={() =>
                simple.mutate({ operation: 'open-folder', id: game.id }, { onError: fail })
              }
              onRegion={(region) =>
                action.mutate({ operation: 'region', id: game.id, region }, { onError: fail })
              }
            />
          ))}
        </div>
        {games.length === 0 && !data?.running && (
          <div className="other-empty glass">
            <Icon icon={faGamepad} />
            <h2>{data?.games.length ? '没有匹配的游戏' : '这里等待你的下一次冒险'}</h2>
            <p>
              先搜索安装记录与启动器配置，再按需深度扫描固定磁盘；不在常见目录时可指定搜索位置。
            </p>
            <p>
              支持{' '}
              {profiles.data?.map((profile) => profile.name).join('、') || '八款游戏及对应区服'}。
            </p>
          </div>
        )}
        <footer className="other-games-footer">
          <span>显示 {games.length} 个安装实例 · 自动同步首页快捷启动</span>
          <span>
            {data?.scannedAt
              ? `上次搜索 ${new Date(data.scannedAt).toLocaleString('zh-CN')}`
              : '尚未搜索'}
            {data?.skipped ? ` · ${data.skipped} 个位置不可访问或已跳过` : ''}
          </span>
        </footer>
        {data?.warnings.map((warning, index) => (
          <p className="settings-note" key={`${index}-${warning}`}>
            {warning}
          </p>
        ))}
      </main>
    </WorkspaceLayout>
  );
}
