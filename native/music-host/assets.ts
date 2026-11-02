import { createImageLoader } from './images.ts';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { Readable } from 'node:stream';
import { boundedBody, musicUrl, platformFetch } from './network.ts';
import type { createPlatforms } from './providers.ts';

type Entry = { url: string; kind: 'audio' | 'image'; expires: number };
/** 服务只听 IPv4 回环，访问口令只交 Rust；前端看到的是原生协议中的一次性资源身份。 */
export function createAssets(platforms: ReturnType<typeof createPlatforms>, secret: string) {
  const entries = new Map<string, Entry>();
  let server: Server | null = null;
  const images = createImageLoader();
  return {
    register(url: string, kind: 'audio' | 'image') {
      if (!['folia-spotify:', 'folia-ytm:'].some((scheme) => url.startsWith(scheme))) musicUrl(url);
      if (url.length > 16384) throw Error('音乐资源地址过长');
      const existing = [...entries].find(
        ([, item]) => item.url === url && item.kind === kind && item.expires > Date.now(),
      );
      if (existing) return { url: `http://zhenjing-music.localhost/media/${existing[0]}` };
      for (const [key, entry] of entries) if (entry.expires < Date.now()) entries.delete(key);
      if (entries.size >= 6000) {
        const first = entries.keys().next().value;
        if (first) entries.delete(first);
      }
      const id = randomUUID();
      entries.set(id, { url, kind, expires: Date.now() + (kind === 'audio' ? 6 : 24) * 3600_000 });
      return { url: `http://zhenjing-music.localhost/media/${id}` };
    },
    async text(url: string, method: 'GET' | 'POST' = 'GET', body?: string) {
      const target = musicUrl(url);
      if (
        method === 'POST' &&
        !(target.hostname === 'u.y.qq.com' && target.pathname === '/cgi-bin/musicu.fcg')
      )
        throw Error('此音乐资源不允许提交请求');
      if (body && Buffer.byteLength(body) > 1048576) throw Error('歌词请求过大');
      const response = await platformFetch(url, {
        method,
        ...(method === 'POST'
          ? {
              body,
              headers: {
                'content-type': 'application/json',
                referer: 'https://y.qq.com/',
                ...(body && /"ct"\s*:\s*11\b/u.test(body)
                  ? { 'user-agent': 'okhttp/3.14.9', cookie: 'tmeLoginType=-1;' }
                  : {}),
              },
            }
          : {}),
      });
      const text = Buffer.from(await boundedBody(response)).toString('utf8');
      return {
        ok: response.ok,
        status: response.status,
        body: text,
        contentType: response.headers.get('content-type') ?? 'text/plain',
      };
    },
    async start(): Promise<number> {
      server = createServer((request, response) => {
        void (async () => {
          if (
            request.headers.authorization !== `Bearer ${secret}` ||
            !['GET', 'HEAD'].includes(request.method ?? '')
          ) {
            response.writeHead(403).end();
            return;
          }
          const id = request.url?.replace(/^\/media\//, '') ?? '',
            entry = entries.get(id);
          if (!entry || entry.expires < Date.now()) {
            response.writeHead(404).end();
            return;
          }
          const headers = new Headers();
          if (entry.kind === 'audio') {
            const range = request.headers.range ?? 'bytes=0-';
            const match = /^bytes=(\d+)-(\d*)$/.exec(range);
            if (match) {
              const start = Number(match[1]),
                end = match[2] ? Number(match[2]) : start + 2097151;
              headers.set('range', `bytes=${start}-${Math.min(end, start + 2097151)}`);
            } else if (/^bytes=-\d+$/.test(range)) headers.set('range', range);
            else {
              response.writeHead(416).end();
              return;
            }
          }
          if (entry.kind === 'image') {
            const image = await images.load(entry.url);
            response.writeHead(200, {
              'content-type': image.mime,
              'content-length': image.bytes.length,
              'cache-control': 'private,max-age=120',
            });
            response.end(request.method === 'HEAD' ? undefined : image.bytes);
            return;
          }
          const upstream = entry.url.startsWith('folia-')
            ? await platforms.audio(entry.url, headers)
            : await platformFetch(entry.url, { headers });
          if (upstream.status < 200 || upstream.status > 299) {
            await upstream.body?.cancel();
            response.writeHead(upstream.status || 502).end();
            return;
          }
          const type = upstream.headers.get('content-type') ?? '';
          const allowed: Record<string, string> = {
            'content-type': type,
            'cache-control': 'private,max-age=120',
          };
          for (const name of ['content-length', 'content-range', 'accept-ranges']) {
            const value = upstream.headers.get(name);
            if (value) allowed[name] = value;
          }
          response.writeHead(upstream.status, allowed);
          if (request.method === 'HEAD') {
            await upstream.body?.cancel();
            response.end();
            return;
          }
          if (!upstream.body) {
            response.end();
            return;
          }
          const body = upstream.body;
          async function* chunks() {
            const reader = body.getReader();
            try {
              for (;;) {
                const part = await reader.read();
                if (part.done) break;
                yield part.value;
              }
            } finally {
              await reader.cancel().catch(() => {});
              reader.releaseLock();
            }
          }
          const stream = Readable.from(chunks());
          response.once('close', () => stream.destroy());
          stream.once('error', () => response.destroy());
          stream.pipe(response);
        })().catch(() => {
          if (!response.headersSent) response.writeHead(502);
          response.end();
        });
      });
      const owned = server;
      await new Promise<void>((resolve, reject) => {
        owned.once('error', reject);
        owned.listen(0, '127.0.0.1', () => {
          owned.removeListener('error', reject);
          owned.on('error', () => {});
          resolve();
        });
      });
      const address = server.address();
      if (!address || typeof address === 'string') throw Error('音乐流服务没有绑定回环端口');
      return address.port;
    },
    stop() {
      server?.closeAllConnections();
      server?.close();
      entries.clear();
      images.clear();
    },
  };
}
