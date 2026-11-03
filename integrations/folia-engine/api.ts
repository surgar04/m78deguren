import { Buffer } from 'buffer';
import { z } from 'zod';
import { installDesktopBridge, type NativeMusicBridge } from './bridge';
import {
  musicTrackSchema,
  musicLyricsSchema,
  musicAudioSchema,
  musicAccountSchema,
  onlineMusicProviderSchema,
  type MusicTrack,
  type OnlineMusicProvider,
} from '../../src/lib/music-contracts';
import type { SongResult } from './upstream/src/types';
import type { ProviderCollection } from './upstream/src/types/onlineMusic';
import { createLoginAttempts } from './login-attempts';
import { musicAuthFailure } from '../../src/lib/music-auth';

// Folia 的歌词解码器使用 Buffer；仅安装浏览器 Buffer，不引入 Node 的进程或文件能力。
Object.assign(globalThis, { Buffer });

/** 上游平台归一化、逐字歌词和匹配算法的窄接入层；UI 只消费经 schema 校验的臻境领域对象。 */
export async function createMusicEngine(request: NativeMusicBridge) {
  installDesktopBridge(request);
  const [
    { omni },
    { getProviderSongMetadata },
    { getPlaybackSourceRef },
    { LyricParserFactory },
    { useOnlineProviderAccountStore },
  ] = await Promise.all([
    import('./upstream/src/services/onlineMusic/omni'),
    import('./upstream/src/services/onlineMusic/songMetadata'),
    import('./upstream/src/utils/appPlaybackGuards'),
    import('./upstream/src/utils/lyrics/LyricParserFactory'),
    import('./upstream/src/stores/useOnlineProviderAccountStore'),
  ]);
  const songs = new Map<string, SongResult>();
  const collections = new Map<string, ProviderCollection>();
  const attempts = createLoginAttempts(async (provider, key) => {
    await omni.cancelLogin(provider, key);
  });
  const image = async (url: string | undefined): Promise<string | null> => {
    if (!url) return null;
    try {
      return z
        .object({ url: z.string() })
        .parse(await request({ operation: 'relay', url, kind: 'image' })).url;
    } catch {
      return null;
    }
  };
  const remember = async (song: SongResult): Promise<MusicTrack> => {
    const source = getPlaybackSourceRef(song);
    if (source.kind !== 'online') throw Error('在线曲目缺少平台身份');
    const provider = onlineMusicProviderSchema.parse(source.providerId);
    const id = String(source.mediaId);
    const key = `${provider}:${id}`;
    const metadata = getProviderSongMetadata(song, provider);
    songs.delete(key);
    songs.set(key, song);
    // 只缓存原始接口对象以保持上游解析语义；队列与 UI 仍由宿主拥有，不在这里复制播放状态。
    while (songs.size > 5000) {
      const oldest = songs.keys().next().value;
      if (oldest) songs.delete(oldest);
    }
    return musicTrackSchema.parse({
      key,
      id,
      provider,
      title: song.name,
      artists: metadata.artists.map((row) => row.name),
      album: metadata.album?.name ?? '',
      durationMs: metadata.durationMs || 0,
      cover: await image(metadata.coverUrl),
      matched: false,
    });
  };
  const find = async (track: MusicTrack): Promise<SongResult> => {
    const held = songs.get(track.key);
    if (held) return held;
    if (track.provider === 'local') throw Error('本地音频应由原生库读取');
    const value = await omni.getSongDetail(track.provider, track.id);
    if (!value) throw Error('平台未返回该歌曲的信息');
    songs.set(track.key, value);
    return value;
  };
  return {
    async refreshCover(
      provider: OnlineMusicProvider,
      id: string,
      kind: 'track' | 'collection' = 'track',
    ) {
      onlineMusicProviderSchema.parse(provider);
      z.string().min(1).max(200).parse(id);
      if (kind === 'collection') {
        const rows = await omni.refreshProviderPlaylists(provider);
        const row = rows.find((item) => String(item.id) === id);
        if (row) collections.set(provider + ':' + id, row);
        return { cover: await image(row?.coverUrl) };
      }
      const song = await omni.getSongDetail(provider, id);
      if (!song) return { cover: null };
      return { cover: (await remember(song)).cover };
    },
    async themes() {
      return (await import('./upstream/src/services/baseThemes')).BASE_DUAL_THEME;
    },
    async search(provider: OnlineMusicProvider, query: string, offset = 0) {
      if (provider === 'qq') {
        const [{ hasUsableQqSession }, { normalizeQqSong }] = await Promise.all([
          import('./upstream/src/services/onlineMusic/qq/qqTransport'),
          import('./upstream/src/services/onlineMusic/qq/qqNormalize'),
        ]);
        if (!hasUsableQqSession()) {
          // 匿名直连会周期性返回 2001；使用本机同源 QQ 适配器的公开搜索，
          // 保留原归一化与 20 条页长。已登录用户仍沿用上游携带会话的搜索，不能降级绕过账户错误。
          const pageSize = 20,
            pageNumber = Math.floor(offset / pageSize) + 1;
          const read = async () =>
            z.object({ status: z.number(), body: z.string() }).parse(
              await request({
                operation: 'api',
                provider: 'qq',
                path: '/search',
                method: 'GET',
                params: {
                  keyword: query.trim().slice(0, 60),
                  type: 'song',
                  page: pageNumber,
                  limit: pageSize,
                },
              }),
            );
          let response = await read();
          // 只重试一次幂等的公开元信息请求；认证拒绝和限流不自动重试。
          if ([500, 502, 503, 504].includes(response.status)) {
            await new Promise<void>((resolve) => setTimeout(resolve, 400));
            response = await read();
          }
          if (response.status !== 200)
            throw Error(`QQ 音乐搜索暂不可用（HTTP ${response.status}），请稍后重试`);
          const result = z
            .object({
              code: z.literal(200),
              items: z.array(z.unknown()).max(1000),
              more: z.boolean(),
            })
            .parse(JSON.parse(response.body) as unknown);
          return {
            hasMore: result.more,
            nextOffset: pageNumber * pageSize,
            items: await Promise.all(result.items.map(normalizeQqSong).map(remember)),
          };
        }
      }
      const page = await omni.searchProviderSongs(
        provider,
        query,
        { limit: 30, offset },
        { session: `zhenjing-${provider}` },
      );
      return {
        hasMore: page.hasMore,
        nextOffset: page.nextOffset,
        items: await Promise.all(page.items.map(remember)),
      };
    },
    async account(provider: OnlineMusicProvider) {
      // 首次校验组件不计入上游账户查询的 60 秒网络时限；本地音频仍可独立播放。
      await request({ operation: 'runtime' });
      await omni.readAccount(provider, 'sync');
      const account = useOnlineProviderAccountStore.getState().accounts[provider];
      if (account?.status === 'error')
        throw Error(account.error || '平台账户状态暂时不可读取，请检查网络或重新连接');
      return musicAccountSchema.parse({
        provider,
        connected: account?.status === 'authenticated',
        nickname: account?.user?.nickname ?? '',
        avatar: await image(account?.user?.avatarUrl),
        premium: (account?.user?.vipType ?? 0) > 0,
      });
    },
    async library(provider: OnlineMusicProvider) {
      const rows = await omni.refreshProviderPlaylists(provider);
      return Promise.all(
        rows.map(async (row) => {
          collections.set(`${provider}:${row.id}`, row);
          return {
            provider,
            id: String(row.id),
            title: row.name,
            cover: await image(row.coverUrl),
            count: row.trackCount ?? null,
          };
        }),
      );
    },
    async playlist(provider: OnlineMusicProvider, id: string, offset = 0) {
      const source = collections.get(`${provider}:${id}`) ?? {
        providerId: provider,
        id,
        name: '',
        type: 'playlist',
      };
      const page = await omni.getCollectionTracks(source, { limit: 50, offset });
      return {
        hasMore: page.hasMore,
        nextOffset: page.nextOffset,
        items: await Promise.all(page.items.map(remember)),
      };
    },
    async loginStart(provider: OnlineMusicProvider, method?: string) {
      const login = await omni.startLogin(provider, method);
      const browser = omni.confirmsLoginInBrowser(provider);
      if (browser && !omni.opensLoginPageItself(provider, login.key))
        await omni.openLoginPage(provider, login.key);
      return {
        key: attempts.register(provider, login.key),
        image: login.imageUrl.startsWith('data:image/')
          ? login.imageUrl
          : ((await image(login.imageUrl)) ?? ''),
        browser,
      };
    },
    async loginCheck(provider: OnlineMusicProvider, key: string) {
      const result = await omni.checkLogin(provider, attempts.resolve(provider, key));
      // 原始 provider 负责账号状态；额外读取只含固定阶段/代码的轻量诊断，不接触登录凭据。
      const progress =
        provider === 'ytm'
          ? z
              .object({
                ok: z.literal(true),
                data: z
                  .object({
                    phase: z.enum([
                      'idle',
                      'opening',
                      'browser',
                      'reading',
                      'verifying',
                      'confirmed',
                      'error',
                      'cancelled',
                    ]),
                    code: z.string().max(64),
                    diagnostics: z.string().max(8192),
                  })
                  .strict(),
              })
              .parse(
                await request({
                  operation: 'provider',
                  provider,
                  action: 'auth_progress',
                  params: {},
                }),
              ).data
          : undefined;
      const code =
        progress?.code || (result.state === 'error' ? result.failure?.mainCode : '') || '';
      const failure = musicAuthFailure(code);
      if (result.state === 'confirmed') {
        attempts.complete(key);
        // 必须使用上游的 sign-in 语义递增账号代次：sync 会加入登录前仍在运行的访客读取，
        // 使新授权在本次进程内仍显示未登录。账号接口随后会合并这次新读取，无需重启。
        void omni.readAccount(provider, 'sign-in');
      }
      return {
        state: result.state,
        message:
          result.state === 'error'
            ? provider === 'ytm'
              ? `${failure.title}。${failure.hint}`
              : (result.message ?? '登录未完成')
            : '',
        ...(progress ? { ...progress, code } : {}),
      };
    },
    async loginMethods(provider: OnlineMusicProvider) {
      const methods = await omni.resolveLoginMethods(provider);
      const { default: i18n } = await import('./upstream/src/i18n/config');
      return methods.map((method) => ({ id: method.id, label: String(i18n.t(method.labelKey)) }));
    },
    loginCancel: (provider: OnlineMusicProvider, key: string) => attempts.cancel(provider, key),
    logout: (provider: OnlineMusicProvider) => omni.signOutAccount(provider),
    async resolve(track: MusicTrack, quality: 'standard' | 'high' | 'lossless' | 'hires' = 'high') {
      if (track.provider === 'local')
        return musicAudioSchema.parse(await request({ operation: 'local-audio', id: track.id }));
      const source = await omni.getAudioSource(await find(track), quality);
      if (!source) throw Error('平台未提供可播放音源，请检查登录、会员和地区可用性');
      const relay = z
        .object({ url: z.string() })
        .parse(await request({ operation: 'relay', url: source.url, kind: 'audio' }));
      return {
        url: relay.url,
        preview: source.preview ?? false,
        quality: source.quality,
        clipStartMs: source.clipStartMs ?? 0,
      };
    },
    async lyrics(track: MusicTrack) {
      if (track.provider === 'local') throw Error('请使用本地歌词读取及在线匹配入口');
      const result = await omni.getLyrics(await find(track), { extensionHooks: false });
      const lines = result.lyrics?.lines ?? [];
      return musicLyricsSchema.parse({
        lines,
        source: omni.getProviderLabel(track.provider),
        isPureMusic: result.isPureMusic,
        wordTimed: lines.some((line) => line.words.length > 1),
      });
    },
    async parseLyrics(content: string, format: string) {
      const { detectTimedLyricFormat, resolveExplicitFileTimedLyricFormat } =
        await import('./upstream/src/utils/lyrics/formatDetection');
      const detected =
        resolveExplicitFileTimedLyricFormat(`lyrics.${format}`) ?? detectTimedLyricFormat(content);
      const data = await LyricParserFactory.parse({
        type: 'local',
        lrcContent: content,
        formatHint: detected,
      });
      const lines = data?.lines ?? [];
      return musicLyricsSchema.parse({
        lines,
        source: '本地歌词',
        isPureMusic: false,
        wordTimed: lines.some((line) => line.words.length > 1),
      });
    },
    async match(track: MusicTrack, provider: OnlineMusicProvider) {
      const [{ calculateMatchScoreDetails }, { buildLyricSearchQuery }] = await Promise.all([
        import('./upstream/src/utils/lyrics/matchScore'),
        import('./upstream/src/utils/lyrics/searchQuery'),
      ]);
      const target = {
        title: track.title,
        artist: track.artists.join(' '),
        album: track.album,
        durationMs: track.durationMs,
      };
      const page = await omni.searchProviderSongs(
        provider,
        buildLyricSearchQuery(target.title, target.artist, target.album),
        { limit: 20, offset: 0 },
      );
      return Promise.all(
        page.items.map(async (song) => ({
          track: await remember(song),
          score: calculateMatchScoreDetails(target, song).score,
        })),
      );
    },
    async palette(cover: string | null) {
      const [{ extractColors }, { buildBuiltinDualTheme }] = await Promise.all([
        import('./upstream/src/utils/colorExtractor'),
        import('./upstream/src/hooks/themeControllerState'),
      ]);
      return buildBuiltinDualTheme({ coverColors: cover ? await extractColors(cover) : [] });
    },
  };
}
