import { Buffer } from 'node:buffer';
import { boundedBody, musicUrl, platformFetch } from './network.ts';

/** QQ 原图接口与缩略图并非始终具有相同可用性；候选只改变同一专辑的尺寸，不跨到任意来源。 */
export function imageCandidates(value: string): string[] {
  const url = musicUrl(value);
  const match = /^\/music\/photo_new\/T002(?:R\d+x\d+)?M000([a-zA-Z0-9]+)\.jpg$/u.exec(
    url.pathname,
  );
  if (url.hostname !== 'y.gtimg.cn' || !match) return [url.href];
  return [
    ...new Set([
      `https://y.gtimg.cn/music/photo_new/T002R800x800M000${match[1]}.jpg`,
      `https://y.gtimg.cn/music/photo_new/T002R300x300M000${match[1]}.jpg`,
      url.href,
    ]),
  ];
}
export function imageMime(bytes: Buffer): string | null {
  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return 'image/png';
  if (/^GIF8[79]a$/u.test(bytes.toString('ascii', 0, 6))) return 'image/gif';
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP')
    return 'image/webp';
  if (
    bytes.toString('ascii', 4, 8) === 'ftyp' &&
    /avif|avis/u.test(bytes.toString('ascii', 8, Math.min(40, bytes.length)))
  )
    return 'image/avif';
  return null;
}
/** 有界 LRU 与并发合并减少封面在曲库、播放条、详情中重复下载；失败不缓存，后续刷新可恢复。 */
export function createImageLoader(fetcher: typeof platformFetch = platformFetch) {
  type Image = { bytes: Buffer; mime: string; expires: number };
  const cache = new Map<string, Image>(),
    pending = new Map<string, Promise<Image>>();
  let size = 0;
  return {
    async load(value: string): Promise<Image> {
      const key = musicUrl(value).href,
        held = cache.get(key);
      if (held && held.expires > Date.now()) {
        cache.delete(key);
        cache.set(key, held);
        return held;
      }
      if (held) {
        size -= held.bytes.length;
        cache.delete(key);
      }
      const inFlight = pending.get(key);
      if (inFlight) return inFlight;
      const task = (async () => {
        for (const candidate of imageCandidates(value)) {
          try {
            const host = new URL(candidate).hostname;
            const headers = new Headers({
              accept: 'image/avif,image/webp,image/*;q=0.8',
              'user-agent': 'Mozilla/5.0',
            });
            if (
              host.endsWith('.qq.com') ||
              host.endsWith('.gtimg.cn') ||
              host.endsWith('.gtimg.com')
            )
              headers.set('referer', 'https://y.qq.com/');
            if (host.endsWith('.126.net')) headers.set('referer', 'https://music.163.com/');
            const response = await fetcher(candidate, {
              headers,
              signal: AbortSignal.timeout(15000),
            });
            if (!response.ok) {
              await response.body?.cancel();
              continue;
            }
            const bytes = Buffer.from(await boundedBody(response, 4 * 1024 * 1024)),
              mime = imageMime(bytes);
            if (!mime) continue;
            const result = { bytes, mime, expires: Date.now() + 15 * 60_000 };
            cache.set(key, result);
            size += bytes.length;
            while (size > 16 * 1024 * 1024 || cache.size > 96) {
              const first = cache.keys().next().value;
              if (!first) break;
              size -= cache.get(first)?.bytes.length ?? 0;
              cache.delete(first);
            }
            return result;
          } catch {
            /* 单一 CDN 失败允许尝试同资源的下一尺寸；不记录含签名的资源地址。 */
          }
        }
        throw Error('平台封面暂时不可用');
      })();
      pending.set(key, task);
      try {
        return await task;
      } finally {
        pending.delete(key);
      }
    },
    clear() {
      cache.clear();
      size = 0;
    },
  };
}
