import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { Worker, SHARE_ENV } from 'node:worker_threads';
import { z } from 'zod';
import type { createVault } from './vault.ts';
import { boundedBody } from './network.ts';

const require = createRequire(import.meta.url);
// 端点由固定上游 transport 声明。拒绝上传、任意脚本、任意服务器地址及未列出的操作。
const NETEASE = new Set([
  'search',
  'cloudsearch',
  'song/detail',
  'song/url/v1',
  'song/url',
  'lyric',
  'lyric/new',
  'check/music',
  'login/qr/key',
  'login/qr/create',
  'login/qr/check',
  'login/status',
  'login/refresh',
  'logout',
  'user/detail',
  'user/playlist',
  'user/subcount',
  'user/cloud',
  'user/record',
  'playlist/detail',
  'playlist/track/all',
  'playlist/create',
  'playlist/tracks',
  'playlist/subscribe',
  'playlist/subscribers',
  'album',
  'album/sub',
  'album/sublist',
  'artist/album',
  'artist/songs',
  'artists',
  'artist/desc',
  'recommend/songs',
  'recommend/resource',
  'personal_fm',
  'like',
  'likelist',
  'top/song',
  'top/album',
  'toplist',
  'top/list',
  'personalized',
  'record/recent/song',
  'record/recent/playlist',
  'scrobble',
  'homepage/block/page',
]);
for (const route of ['register/anonimous', 'user/account', 'scrobble/v1', 'song/copyright/rcmd'])
  NETEASE.add(route);
// 与固定版本 transport 对齐：云盘歌词、合唱区间和收藏详情也参与元信息及演绎，不能只开放搜索接口。
for (const route of [
  'album/detail/dynamic',
  'album/new',
  'artist/detail',
  'artist/top/song',
  'cloud/lyric/get',
  'history/recommend/songs',
  'history/recommend/songs/detail',
  'personal/fm/mode',
  'playlist/detail/dynamic',
  'recommend/category/configs',
  'recommend/category/set',
  'recommend/category/songs',
  'recommend/songs/dislike',
  'simi/song',
  'song/chorus',
  'top/playlist',
  'user/cloud/detail',
  'fm_trash',
])
  NETEASE.add(route);
const NETEASE_HOST_OPTIONS = new Set([
  'crypto',
  'ua',
  'proxy',
  'realIP',
  'randomCNIP',
  'e_r',
  'domain',
  'checkToken',
  'headers',
  'timeout',
]);
const QQ = new Set([
  'login/qr/key',
  'login/qr/create',
  'login/qr/check',
  'login/qr/cancel',
  'login/status',
  'login/channels',
  'login/refresh',
  'logout',
  'user/detail',
  'user/playlist',
  'user/albums',
  'user/liked-songs',
  'user/playlist-detail',
  'user/guess-you-like',
  'user/daily-songs',
  'recommend/playlists',
  'user/playlist/tracks',
  'user/playlist/subscribe',
  'user/subscription-status',
  'user/song/like',
  'user/album/subscribe',
  'user/vip',
  'user/cloud',
  'user/playlist/create',
  'recommend/new-songs',
  'recommend/new-albums',
  'recommend/toplists',
  'recommend/toplist',
  'recommend/categories',
  'recommend/category-playlists',
  'recommend/radar',
  'radio/list',
  'radio/tracks',
  'song/similar',
  'getMusicPlay',
  'getSongListDetail',
  'getSongInfo',
  'getAlbumInfo',
  'getSingerAlbum',
  'getSingerHotsong',
  'search',
]);
type Vault = ReturnType<typeof createVault>;
export function createProviderApi(vault: Vault) {
  const neteaseSecret = randomBytes(32).toString('hex');
  let netease: Promise<{ port: number }> | undefined;
  let qq: ((request: Request, env: { QQ_SESSION_SECRET: string }) => Promise<Response>) | undefined;
  const secret = () => {
    const held = vault.store.get('qq.sealed-secret');
    if (typeof held === 'string' && held.length >= 32) return held;
    const generated = randomBytes(48).toString('base64');
    vault.store.set('qq.sealed-secret', generated);
    return generated;
  };
  return async (
    provider: 'netease' | 'qq',
    path: string,
    method: string,
    input: Record<string, unknown>,
    forwarded: Record<string, string> = {},
  ) => {
    const endpoint = path.replace(/^\//, '');
    const route =
      provider === 'qq' &&
      /^(getMusicPlay|getSongListDetail|getSongInfo)\/[a-zA-Z0-9_-]+(?:\/\d+)?$/.test(endpoint)
        ? (endpoint.split('/')[0] ?? '')
        : endpoint;
    if (!(provider === 'netease' ? NETEASE : QQ).has(route)) throw Error('音乐 API 端点未开放');
    if (provider === 'netease') {
      // SDK 会把这些字段解释成网络选项。页面不能改写目标域名、代理或请求头，避免带会话请求被导向外站。
      if (Object.keys(input).some((key) => NETEASE_HOST_OPTIONS.has(key)))
        throw Error('音乐网络选项只能由宿主配置');
      for (const key of ['id', 'uid']) {
        const value = input[key];
        if (
          value !== undefined &&
          !(
            (typeof value === 'string' || typeof value === 'number') &&
            /^\d{1,20}$/u.test(String(value))
          )
        )
          throw Error('音乐资源身份必须是数字');
      }
    }
    if (provider === 'qq') {
      if (!qq) {
        const module: unknown = require('@yakult-green-tea/qq-music-api/serverless');
        qq = z
          .object({
            handleRequest: z.custom<
              (request: Request, env: { QQ_SESSION_SECRET: string }) => Promise<Response>
            >((value) => typeof value === 'function'),
          })
          .parse(module).handleRequest;
      }
      const url = new URL(`https://music.internal/${endpoint}`);
      const headers = new Headers({ 'content-type': 'application/json' });
      const session = forwarded['x-qq-session'];
      if (session && session.length < 65536) headers.set('X-QQ-Session', session);
      if (method === 'GET')
        for (const [key, value] of Object.entries(input))
          if (value !== undefined && value !== null)
            url.searchParams.set(key, typeof value === 'string' ? value : JSON.stringify(value));
      const response = await qq(
        new Request(url, {
          method,
          headers,
          ...(method === 'POST' ? { body: JSON.stringify(input) } : {}),
        }),
        { QQ_SESSION_SECRET: secret() },
      );
      return {
        status: response.status,
        body: Buffer.from(await boundedBody(response)).toString('utf8'),
        contentType: 'application/json',
      };
    }
    if (!netease) {
      // 直接迁入原项目完整 worker：保留 xeapi 密钥、匿名凭据刷新、扫码身份与网络重试，避免阉割版管线。
      const module: unknown = require('./upstream/electron/netease/neteaseApiHost.cjs');
      const factory = z
        .object({
          createNeteaseApiHost: z.custom<
            (options: object) => { start: (options: { host: string }) => Promise<unknown> }
          >((v) => typeof v === 'function'),
        })
        .parse(module);
      const host = factory.createNeteaseApiHost({
        createWorker: () => {
          const worker = new Worker(new URL('./netease-worker.ts', import.meta.url), {
            env: SHARE_ENV,
            workerData: { secret: neteaseSecret },
            stdout: true,
            stderr: true,
            resourceLimits: { maxOldGenerationSizeMb: 128 },
          });
          worker.stdout?.resume();
          worker.stderr?.resume();
          return worker;
        },
        onWorkerError: () => {
          netease = undefined;
        },
        onExit: () => {
          netease = undefined;
        },
      });
      netease = host
        .start({ host: '127.0.0.1' })
        .then((value) => z.object({ port: z.number().int().min(1).max(65535) }).parse(value))
        .catch((cause: unknown) => {
          netease = undefined;
          throw cause;
        });
    }
    const { port } = await netease;
    const params = {
      ...input,
      cookie: vault.store.get('netease.cookie') ?? vault.store.get('netease.anonymous') ?? '',
    };
    const target = new URL(`http://127.0.0.1:${port}/${endpoint}`);
    for (const [key, value] of Object.entries(params))
      if (value !== null && value !== undefined)
        target.searchParams.set(key, typeof value === 'string' ? value : JSON.stringify(value));
    const response = await fetch(target, {
      method,
      headers: { 'X-Zhenjing-Music': neteaseSecret },
      signal: AbortSignal.timeout(60000),
      redirect: 'error',
    });
    const raw = Buffer.from(await boundedBody(response)).toString('utf8');
    const body = z.record(z.string(), z.unknown()).parse(JSON.parse(raw) as unknown);
    if (
      typeof body.cookie === 'string' &&
      body.cookie &&
      (body.code === 803 ||
        endpoint === 'register/anonimous' ||
        (endpoint === 'login/refresh' && Number(body.code) === 200))
    ) {
      vault.store.set(
        endpoint === 'register/anonimous' ? 'netease.anonymous' : 'netease.cookie',
        body.cookie,
      );
      // 渲染器只保留占位身份，实际 cookie 留在受保护的音乐进程。
    }
    // 即便上游未来在其他端点附带 cookie，也不能把明文会话作为普通 API 数据交给渲染器。
    if (typeof body.cookie === 'string') body.cookie = body.cookie ? 'zhenjing-owned-session' : '';
    if (endpoint === 'logout' && Number(body.code) === 200) vault.store.delete('netease.cookie');
    return { status: response.status, body: JSON.stringify(body), contentType: 'application/json' };
  };
}
