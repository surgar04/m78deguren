import { PageHeader } from '@/components/PageHeader';
import { MusicCover as Cover } from './MusicCover';
import { MusicNowPlaying, MusicControls, MusicEffects } from './MusicPlayback';
import { MusicLogin as Login } from './MusicLogin';
import { DesktopLyricsControls } from './desktop-lyrics/DesktopLyricsControls';
import { minute, providerLabel } from './model';
import { lazy, Suspense, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  faMusic,
  faMagnifyingGlass,
  faExpand,
  faFolderPlus,
  faHeart,
  faRotateRight,
  faWandMagicSparkles,
  faHeadphones,
  faVolumeHigh,
} from '@fortawesome/free-solid-svg-icons';
import { WorkspaceLayout } from '@/features/home/components/WorkspaceLayout';
import { Icon } from '@/features/home/components/Icon';
import { Modal } from '@/features/home/components/Modal';
import { useGameWorkspace } from '@/features/home/useGameWorkspace';
import { executeMusic, errorMessage, isDesktop } from '@/lib/desktop';
import {
  musicCollectionSchema,
  musicLocalLibrarySchema,
  musicPageSchema,
  musicMatchSchema,
  musicThemeSchema,
  onlineMusicProviderSchema,
  type MusicCollection,
  type MusicTrack,
  type OnlineMusicProvider,
} from '@/lib/music-contracts';
import { musicEngine } from './engine';
import { musicPlayer, useMusicTrack, useMusicPlaying } from './player';
import { useMusicPreferences, MUSIC_PROVIDERS, ONLINE_MUSIC_PROVIDERS } from './preferences';
import { useLocalMusic, useMusicAccount } from './repository';
import './music.css';
import './music-layout.css';

const Immersive = lazy(() =>
  import('./ImmersivePlayer').then((module) => ({ default: module.ImmersivePlayer })),
);
const ONLINE_TABS = [
  ['search', '在线搜索'],
  ['collections', '我的歌单'],
] as const;
const LOCAL_TABS = [
  ['local', '本地音乐'],
  ['favorites', '本地收藏'],
] as const;
function Match({
  track,
  provider,
  onClose,
}: {
  track: MusicTrack;
  provider: OnlineMusicProvider;
  onClose: () => void;
}) {
  const cache = useQueryClient();
  const [selectedProvider, setSelectedProvider] = useState(provider);
  const query = useQuery({
    queryKey: ['music', 'match', track.key, selectedProvider],
    queryFn: () => musicEngine('match', [track, selectedProvider], musicMatchSchema),
    retry: false,
  });
  const action = useMutation({
    mutationFn: async (candidate: MusicTrack) => {
      if (track.provider === 'local') {
        const library = await executeMusic(
          { operation: 'local-match', id: track.id, track: candidate },
          musicLocalLibrarySchema,
        );
        const updated = library.tracks.find((item) => item.key === track.key);
        if (updated) musicPlayer.applyMetadata(updated);
        await cache.invalidateQueries({ queryKey: ['music', 'local'] });
      }
      if (musicPlayer.snapshot().track?.key === track.key)
        await musicPlayer.matchedLyrics(candidate);
      onClose();
    },
  });
  return (
    <Modal title="在线匹配与补全" onClose={onClose} wide>
      <p>
        为「{track.title}」匹配 {providerLabel(selectedProvider)}{' '}
        的元信息、封面与同步歌词。不会修改原始音乐文件，匹配结果可还原。
      </p>
      <label>
        匹配平台{' '}
        <select
          aria-label="匹配平台"
          value={selectedProvider}
          onChange={(event) => {
            const selected = onlineMusicProviderSchema.parse(event.target.value);
            setSelectedProvider(selected);
            useMusicPreferences.getState().patch({ matchProvider: selected });
          }}
        >
          {ONLINE_MUSIC_PROVIDERS.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <p className="music-help">
        按原项目的标题、歌手、专辑及时长评分。请选择正确版本；现场、翻唱和重制版可能有时间偏差。
      </p>
      {query.isPending && <p role="status">正在搜索匹配版本…</p>}
      {(query.error || action.error) && (
        <p role="alert">{errorMessage(query.error ?? action.error)}</p>
      )}
      {query.data
        ?.slice()
        .sort((a, b) => b.score - a.score)
        .map((row) => (
          <button
            className="music-match-row"
            type="button"
            key={row.track.key}
            disabled={action.isPending}
            onClick={() => action.mutate(row.track)}
          >
            <Cover track={row.track} />
            <span>
              <b>{row.track.title}</b>
              <small>
                {row.track.artists.join(' / ')} · {row.track.album}
              </small>
            </span>
            <strong>{row.score}%</strong>
            <span>应用补全</span>
          </button>
        ))}
      {query.data?.length === 0 && <p>未找到匹配版本，可切换平台后重试或导入本地歌词。</p>}
    </Modal>
  );
}
function ThemeEditor({ onClose }: { onClose: () => void }) {
  const preferences = useMusicPreferences();
  const [input, setInput] = useState(
      preferences.customTheme ? JSON.stringify(preferences.customTheme, null, 2) : '',
    ),
    [error, setError] = useState('');
  const load = async () => {
    try {
      const pair = await musicEngine(
        'themes',
        [],
        z.object({ light: musicThemeSchema, dark: musicThemeSchema }),
      );
      setInput(JSON.stringify(preferences.daylight ? pair.light : pair.dark, null, 2));
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };
  return (
    <Modal title="自定义演绎主题" onClose={onClose} wide>
      <p>主题使用 Folia 原始字段，支持四种主色、字体、动效强度、逐字关键字色和主题图标。</p>
      <button
        type="button"
        onClick={() => {
          void load();
        }}
      >
        载入原版默认主题
      </button>
      <textarea
        className="music-theme-json"
        value={input}
        onChange={(event) => setInput(event.target.value)}
        aria-label="主题 JSON"
        spellCheck={false}
      />
      <button
        type="button"
        className="mint-button"
        onClick={() => {
          try {
            const value: unknown = JSON.parse(input);
            const theme = musicThemeSchema.parse(value);
            preferences.patch({ customTheme: theme, themeSource: 'custom' });
            onClose();
          } catch {
            setError('主题 JSON 或字段无效，请检查颜色、字体与动效值。');
          }
        }}
      >
        应用主题
      </button>
      {error && <p role="alert">{error}</p>}
    </Modal>
  );
}

/** 普通界面只显示真实曲库与播放器；沉浸开关不持久化，重启不会自动进入动画。 */
export default function MusicPage() {
  const workspace = useGameWorkspace(),
    cache = useQueryClient(),
    preferences = useMusicPreferences(),
    track = useMusicTrack(),
    playing = useMusicPlaying();
  const playback = { track, playing };
  const [tab, setTab] = useState<'search' | 'collections' | 'local' | 'favorites'>(
      preferences.provider === 'local' ? 'local' : 'search',
    ),
    [text, setText] = useState(''),
    [search, setSearch] = useState('');
  const [visibleCount, setVisibleCount] = useState(200);
  const [collection, setCollection] = useState<MusicCollection | null>(null),
    [login, setLogin] = useState(false),
    [match, setMatch] = useState<MusicTrack | null>(null),
    [immersive, setImmersive] = useState(false),
    [themeOpen, setThemeOpen] = useState(false),
    [effectsOpen, setEffectsOpen] = useState(false);
  // 窄工作区默认将空间让给曲库；辅助面板可展开，歌词匹配等功能不会因换列而丢失。
  const [supportOpen, setSupportOpen] = useState(false);
  const account = useMusicAccount(preferences.provider),
    local = useLocalMusic();
  const onlineProvider = preferences.provider === 'local' ? null : preferences.provider;
  const songQueryKey = [
    'music',
    'songs',
    preferences.provider,
    tab,
    search,
    collection?.id,
  ] as const;
  const online = useInfiniteQuery({
    queryKey: songQueryKey,
    enabled:
      isDesktop() &&
      !!onlineProvider &&
      ((tab === 'search' && !!search) || (tab === 'collections' && !!collection)),
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      musicEngine(
        tab === 'collections' ? 'playlist' : 'search',
        [
          onlineMusicProviderSchema.parse(onlineProvider),
          tab === 'collections' ? collection?.id : search,
          pageParam,
        ],
        musicPageSchema,
      ),
    getNextPageParam: (page) => (page.hasMore ? page.nextOffset : undefined),
    retry: false,
  });
  const collections = useQuery({
    queryKey: ['music', 'collections', preferences.provider],
    enabled: isDesktop() && !!onlineProvider && tab === 'collections',
    queryFn: () =>
      musicEngine(
        'library',
        [onlineMusicProviderSchema.parse(onlineProvider)],
        z.array(musicCollectionSchema),
      ),
    retry: false,
  });
  const native = useMutation({
    mutationFn: (folder: boolean) =>
      executeMusic({ operation: 'local-import', folder }, musicLocalLibrarySchema),
    onSuccess: (data) => cache.setQueryData(['music', 'local'], data),
  });
  const remove = useMutation({
    mutationFn: (track: MusicTrack) =>
      executeMusic({ operation: 'local-remove', id: track.id }, musicLocalLibrarySchema),
    onSuccess: (data) => cache.setQueryData(['music', 'local'], data),
  });
  const restore = useMutation({
    mutationFn: (track: MusicTrack) =>
      executeMusic(
        { operation: 'local-match', id: track.id, track: null },
        musicLocalLibrarySchema,
      ),
    onSuccess: (data) => cache.setQueryData(['music', 'local'], data),
  });
  const disconnect = useMutation({
    mutationFn: () =>
      musicEngine('logout', [onlineMusicProviderSchema.parse(onlineProvider)], z.unknown()),
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: ['music', 'account'] });
      void cache.invalidateQueries({ queryKey: ['music', 'collections'] });
    },
  });
  const onlineTracks = online.data?.pages.flatMap((page) => page.items) ?? [];
  const tracks =
    tab === 'local' || tab === 'favorites'
      ? (local.data?.tracks ?? []).filter(
          (track) =>
            (tab !== 'favorites' || preferences.favorites.includes(track.key)) &&
            (!text ||
              `${track.title} ${track.artists.join(' ')} ${track.album}`
                .toLowerCase()
                .includes(text.toLowerCase())),
        )
      : onlineTracks.filter(
          (track) =>
            tab !== 'collections' ||
            !text ||
            `${track.title} ${track.artists.join(' ')} ${track.album}`
              .toLowerCase()
              .includes(text.toLowerCase()),
        );
  const unique = [...new Map(tracks.map((track) => [track.key, track])).values()];
  const favorite = (track: MusicTrack) =>
    preferences.patch({
      favorites: preferences.favorites.includes(track.key)
        ? preferences.favorites.filter((key) => key !== track.key)
        : [...preferences.favorites, track.key],
    });
  const failure =
    (tab === 'search' || collection ? online.error : null) ??
    (tab === 'collections' ? collections.error : null) ??
    (tab === 'local' || tab === 'favorites'
      ? (native.error ?? local.error ?? remove.error ?? restore.error)
      : null) ??
    (onlineProvider ? disconnect.error : null);
  const filteredCollections = (collections.data ?? []).filter((row) =>
    row.title.toLowerCase().includes(text.toLowerCase()),
  );
  return (
    <WorkspaceLayout workspace={workspace} active="music">
      <main className="music-main" id="main-content" tabIndex={-1}>
        <PageHeader
          title="音乐"
          description="把喜欢的声音，留在此刻。"
          actions={
            <>
              <button
                type="button"
                className="glass music-support-toggle"
                aria-expanded={supportOpen}
                aria-controls="music-support-panel"
                onClick={() => setSupportOpen((open) => !open)}
              >
                {supportOpen ? '收起当前播放' : '当前播放'}
              </button>
              <DesktopLyricsControls />
              <button type="button" className="glass" onClick={() => setEffectsOpen(true)}>
                <Icon icon={faWandMagicSparkles} />
                演绎设置
              </button>
              <button
                type="button"
                className="glass"
                onClick={() => {
                  void cache.invalidateQueries({ queryKey: ['music'] });
                }}
                aria-label="刷新音乐数据"
              >
                <Icon icon={faRotateRight} />
              </button>
              <button
                type="button"
                className="mint-button"
                disabled={!playback.track}
                onClick={() => setImmersive(true)}
              >
                <Icon icon={faExpand} />
                沉浸演绎
              </button>
            </>
          }
        />
        {!isDesktop() && (
          <p className="music-notice">请在臻境桌面应用中使用真实曲库、平台登录及本地播放。</p>
        )}
        <section className="music-workbench" data-support={supportOpen} data-home-enter>
          <aside className="music-browser glass">
            <div className="music-library-top">
              <div className="music-platforms" aria-label="音乐平台">
                {MUSIC_PROVIDERS.map(([id, label]) => (
                  <button
                    type="button"
                    key={id}
                    className={preferences.provider === id ? 'active' : ''}
                    onClick={() => {
                      preferences.patch({ provider: id });
                      if (id !== 'local') preferences.patch({ matchProvider: id });
                      setTab(id === 'local' ? 'local' : 'search');
                      setLogin(false);
                      setVisibleCount(200);
                      setCollection(null);
                      setText('');
                      setSearch('');
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="music-account">
                <span>
                  <Icon icon={faHeadphones} />
                  {preferences.provider === 'local'
                    ? `本地曲库 · ${local.data?.tracks.length ?? 0} 首歌曲`
                    : account.isPending
                      ? '正在准备音乐服务…'
                      : account.data?.connected
                        ? account.data.nickname
                        : `${providerLabel(preferences.provider)} · 未连接`}
                </span>
                {onlineProvider &&
                  (account.data?.connected ? (
                    <button
                      type="button"
                      onClick={() => disconnect.mutate()}
                      disabled={disconnect.isPending}
                    >
                      退出
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={account.isPending}
                      onClick={() => setLogin(true)}
                    >
                      连接账号
                    </button>
                  ))}
              </div>
            </div>
            {onlineProvider && account.error && (
              <p className="music-help">{errorMessage(account.error)}</p>
            )}
            <div className="music-library-filters">
              <div className="music-tabs" role="tablist" aria-label="曲库来源">
                {(onlineProvider ? ONLINE_TABS : LOCAL_TABS).map(([id, label]) => (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab === id}
                    className={tab === id ? 'active' : ''}
                    key={id}
                    onClick={() => {
                      setTab(id);
                      setCollection(null);
                      setText('');
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <form
                className="music-search"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (tab === 'search') {
                    const keyword = text.trim();
                    // 同一个关键词再次提交也能重试，并回到第一页，不依赖 setState 是否改变。
                    if (keyword === search) {
                      if (!online.isFetching)
                        void cache.resetQueries({ queryKey: songQueryKey, exact: true });
                    } else setSearch(keyword);
                  }
                }}
              >
                <Icon icon={faMagnifyingGlass} />
                <input
                  value={text}
                  maxLength={200}
                  onChange={(event) => setText(event.target.value)}
                  placeholder={
                    tab === 'collections'
                      ? collection
                        ? '筛选已加载的歌曲、歌手…'
                        : '筛选我的歌单…'
                      : tab === 'local' || tab === 'favorites'
                        ? '筛选本地歌曲、歌手、专辑…'
                        : '搜索歌曲、歌手或专辑…'
                  }
                  aria-label="搜索音乐"
                />
                {tab === 'search' && (
                  <button type="submit" disabled={!text.trim()}>
                    搜索
                  </button>
                )}
              </form>
            </div>
            {(tab === 'local' || tab === 'favorites') && (
              <div className="music-import-actions">
                <button
                  className="mint-button"
                  type="button"
                  disabled={native.isPending}
                  onClick={() => native.mutate(false)}
                >
                  <Icon icon={faFolderPlus} />
                  添加歌曲
                </button>
                <button
                  type="button"
                  disabled={native.isPending}
                  onClick={() => native.mutate(true)}
                >
                  导入文件夹
                </button>
                <small>
                  {native.isPending
                    ? '正在读取音频元信息…'
                    : `${local.data?.tracks.length ?? 0} 首 · 原始文件保留`}
                </small>
              </div>
            )}
            {(tab === 'local' || tab === 'favorites') && local.data?.message && (
              <p className="music-notice" role="status">
                {local.data.message}
              </p>
            )}
            <div className="music-browser-body">
              {collection && (
                <button
                  type="button"
                  className="music-back"
                  onClick={() => {
                    setCollection(null);
                    setText('');
                  }}
                >
                  ← 全部歌单 / {collection.title}
                </button>
              )}
              {failure && (
                <p className="music-notice" role="alert">
                  {errorMessage(failure)}
                </p>
              )}
              {tab === 'collections' && !collection ? (
                <div className="music-collections">
                  {filteredCollections.map((row) => (
                    <button
                      key={`${row.provider}:${row.id}`}
                      type="button"
                      onClick={() => {
                        setCollection(row);
                        setText('');
                      }}
                    >
                      <Cover
                        track={{
                          title: row.title,
                          cover: row.cover,
                          id: row.id,
                          provider: row.provider,
                        }}
                        kind="collection"
                      />
                      <b>{row.title}</b>
                      <small>{row.count === null ? '查看歌曲' : `${row.count} 首`}</small>
                    </button>
                  ))}
                  {!filteredCollections.length && (
                    <div className="music-empty">
                      <Icon icon={faMusic} />
                      <h2>
                        {collections.isFetching
                          ? '正在读取歌单…'
                          : text
                            ? '没有找到匹配的歌单'
                            : '还没有可显示的歌单'}
                      </h2>
                      <p>
                        {text ? '试试其他关键词。' : '连接平台账号后刷新，读取你的真实收藏和歌单。'}
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <div className="music-track-list" aria-label="歌曲列表">
                    {unique.slice(0, visibleCount).map((track, index) => (
                      <div
                        className={`music-track ${playback.track?.key === track.key ? 'current' : ''}`}
                        key={track.key}
                      >
                        <button
                          className="music-track-start"
                          type="button"
                          onClick={() => {
                            void musicPlayer.play(track, unique);
                          }}
                          aria-label={`播放 ${track.title}`}
                        >
                          <span>
                            {playback.track?.key === track.key && playback.playing ? (
                              <Icon icon={faVolumeHigh} />
                            ) : (
                              String(index + 1).padStart(2, '0')
                            )}
                          </span>
                          <Cover track={track} />
                          <span>
                            <b>{track.title}</b>
                            <small>
                              {track.artists.join(' / ') || '未知歌手'} ·{' '}
                              {track.album || '未知专辑'}
                              {track.matched ? ' · 已补全' : ''}
                            </small>
                          </span>
                        </button>
                        <span className="music-track-duration">
                          {minute(track.durationMs / 1000)}
                        </span>
                        {track.provider === 'local' && (
                          <button
                            type="button"
                            className="music-row-action"
                            onClick={() => setMatch(track)}
                            aria-label={`补全 ${track.title}`}
                            title="在线补全"
                          >
                            <Icon icon={faWandMagicSparkles} />
                          </button>
                        )}
                        {track.provider === 'local' && (
                          <button
                            type="button"
                            className={`music-row-action ${preferences.favorites.includes(track.key) ? 'saved' : ''}`}
                            onClick={() => favorite(track)}
                            aria-label={`收藏 ${track.title}`}
                            aria-pressed={preferences.favorites.includes(track.key)}
                          >
                            <Icon icon={faHeart} />
                          </button>
                        )}
                        {track.provider === 'local' && (
                          <details className="music-row-menu">
                            <summary aria-label={`${track.title} 更多操作`}>···</summary>
                            <div>
                              <button
                                type="button"
                                onClick={() => {
                                  void executeMusic(
                                    { operation: 'local-reveal', id: track.id },
                                    z.null(),
                                  ).catch((cause) => workspace.notify(errorMessage(cause)));
                                }}
                              >
                                定位原文件
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  void musicPlayer.loadLyrics(track, undefined, true);
                                }}
                              >
                                导入歌词
                              </button>
                              {track.matched && (
                                <button type="button" onClick={() => restore.mutate(track)}>
                                  还原元信息
                                </button>
                              )}
                              <button type="button" onClick={() => remove.mutate(track)}>
                                从库中移除
                              </button>
                            </div>
                          </details>
                        )}
                      </div>
                    ))}
                  </div>
                  {!unique.length && (
                    <div className="music-empty">
                      <Icon icon={faMusic} />
                      <h2>
                        {(onlineProvider ? online.isFetching : local.isPending || native.isPending)
                          ? '正在读取音乐…'
                          : tab === 'search'
                            ? '从一首喜欢的歌开始'
                            : text
                              ? '没有找到匹配的歌曲'
                              : '这里还没有音乐'}
                      </h2>
                      <p>
                        {tab === 'search'
                          ? '搜索平台曲库，或添加本地音乐。平台登录与会员权益由各平台管理。'
                          : !onlineProvider
                            ? text
                              ? '尝试其他关键词，筛选本地歌曲、歌手或专辑。'
                              : tab === 'favorites'
                                ? '在本地歌曲旁点亮收藏，喜欢的音乐会出现在这里。'
                                : '添加歌曲或导入文件夹；原件保持不变，可匹配封面和歌词。'
                            : text
                              ? '尝试其他关键词；平台歌单仅筛选当前已加载的歌曲，可继续加载更多。'
                              : '连接平台账号后读取真实歌单。'}
                      </p>
                    </div>
                  )}
                  {unique.length > visibleCount && (
                    <button
                      type="button"
                      className="music-load-more"
                      onClick={() => setVisibleCount((value) => value + 200)}
                    >
                      显示更多 · 已显示 {visibleCount} / {unique.length}
                    </button>
                  )}
                  {online.hasNextPage && tab !== 'local' && tab !== 'favorites' && (
                    <button
                      className="music-load-more"
                      type="button"
                      disabled={online.isFetchingNextPage}
                      onClick={() => {
                        void online.fetchNextPage();
                      }}
                    >
                      {online.isFetchingNextPage ? '加载中…' : '加载更多'}
                    </button>
                  )}
                </>
              )}
            </div>
          </aside>
          <MusicNowPlaying onMatch={setMatch} onSettings={() => setEffectsOpen(true)} />
        </section>
        <MusicControls />
        {login && onlineProvider && (
          <Login provider={onlineProvider} onClose={() => setLogin(false)} />
        )}
        {match && (
          <Match
            track={match}
            provider={preferences.matchProvider}
            onClose={() => setMatch(null)}
          />
        )}
        {effectsOpen && (
          <Modal
            title="播放与演绎设置"
            wide
            className="music-effects-dialog"
            onClose={() => setEffectsOpen(false)}
          >
            <MusicEffects
              onTheme={() => {
                setEffectsOpen(false);
                setThemeOpen(true);
              }}
            />
          </Modal>
        )}
        {themeOpen && <ThemeEditor onClose={() => setThemeOpen(false)} />}
        {immersive && playback.track && (
          <Suspense fallback={<div className="music-immersive-message">正在打开沉浸演绎…</div>}>
            <Immersive onExit={() => setImmersive(false)} />
          </Suspense>
        )}
        <footer className="music-attribution">
          歌词演绎引擎 Folia · AGPL-3.0 ·{' '}
          <a href="https://github.com/chthollyphile/folia-major" target="_blank" rel="noreferrer">
            上游源码与许可
          </a>
        </footer>
      </main>
    </WorkspaceLayout>
  );
}
