import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import {
  musicRoute,
  proxyDispatcher,
  directDispatcher,
  MusicNetworkError,
} from './network-route.ts';

// 音乐进程只访问选定平台及其媒体 CDN；请求不能变成通用下载器或内网探测代理。
const HOSTS = [
  'qq.com',
  'gtimg.cn',
  'gtimg.com',
  '163.com',
  '126.net',
  'music.126.net',
  'spotify.com',
  'scdn.co',
  'spotifycdn.com',
  'spotifycdn.net',
  'akamaized.net',
  'youtube.com',
  'googlevideo.com',
  'ytimg.com',
  'ggpht.com',
  'googleusercontent.com',
  'google.com',
  'googleapis.com',
  'gstatic.com',
  'github.com',
  'raw.githubusercontent.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
];
function publicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a = 0, b = 0] = address.split('.').map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  const lowered = address.toLowerCase();
  return (
    isIP(address) === 6 &&
    !lowered.startsWith('::') &&
    !lowered.startsWith('fc') &&
    !lowered.startsWith('fd') &&
    !lowered.startsWith('fe8') &&
    !lowered.startsWith('fe9') &&
    !lowered.startsWith('fea') &&
    !lowered.startsWith('feb')
  );
}
export function musicUrl(value: string): URL {
  const url = new URL(value);
  // 平台历史封面/音源仍返回 http，固定平台可升级到 TLS，不允许明文传输登录数据。
  if (url.protocol === 'http:' && !url.port) url.protocol = 'https:';
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443') ||
    url.href.length > 16384 ||
    !HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))
  )
    throw Error('音乐资源地址不在受限平台范围内');
  return url;
}
export async function platformFetch(
  input: string | URL | Request,
  init: RequestInit = {},
): Promise<Response> {
  // youtubei 会传 Request；丢弃其 method/body 将导致已登录接口被错误改成 GET。
  if (input instanceof Request) {
    const original = input.clone();
    init = {
      method: original.method,
      headers: original.headers,
      signal: original.signal,
      redirect: original.redirect,
      ...(!['GET', 'HEAD'].includes(original.method) ? { body: await original.arrayBuffer() } : {}),
      ...init,
    };
  }
  let url = musicUrl(
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
  );
  const deadline = AbortSignal.timeout(45000);
  const signal = init.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
  const redirectPolicy = init.redirect ?? 'follow';
  for (let redirects = 0; redirects < 8; redirects++) {
    signal.throwIfAborted();
    const google = [
      'youtube.com',
      'google.com',
      'googleapis.com',
      'googlevideo.com',
      'ytimg.com',
      'ggpht.com',
      'googleusercontent.com',
      'gstatic.com',
    ].some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
    const route = google ? await musicRoute(url) : { mode: 'direct' as const };
    signal.throwIfAborted();
    // 使用显式代理时由该可信代理解析固定白名单域名；不先强制走本机 DNS，避免代理可用却卡在本机解析。
    if (route.mode === 'direct') {
      const addresses = await resolveAddresses(url.hostname, signal);
      if (!addresses.length || addresses.some((item) => !publicAddress(item.address)))
        throw new MusicNetworkError(
          'dns',
          '音乐平台域名解析到本地或内网地址，请检查 DNS 或代理设置',
        );
    }
    const options = {
      ...init,
      signal,
      redirect: 'manual' as const,
      ...(route.mode === 'proxy'
        ? { dispatcher: proxyDispatcher(route.proxy) }
        : google
          ? { dispatcher: directDispatcher() }
          : {}),
    };
    const response = await fetch(url, options);
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    if (redirectPolicy === 'manual') return response;
    if (redirectPolicy === 'error') {
      await response.body?.cancel();
      throw new MusicNetworkError(
        'network',
        '平台鉴权请求发生重定向，已阻止转发登录信息，请重新授权',
      );
    }
    const next = response.headers.get('location');
    await response.body?.cancel();
    if (!next) throw Error('平台返回无效重定向');
    const target = musicUrl(new URL(next, url).href);
    // 跨主机跳转不转发账户凭据；同平台需要的鉴权应由相应 adapter 主动生成。
    if (target.origin !== url.origin) {
      const headers = new Headers(init.headers);
      headers.delete('authorization');
      headers.delete('cookie');
      headers.delete('x-goog-authuser');
      headers.delete('x-goog-pageid');
      init = { ...init, headers };
    }
    if (response.status === 303) {
      init = { ...init, method: 'GET' };
      delete init.body;
    }
    url = target;
  }
  throw Error('音乐资源重定向次数过多');
}
async function resolveAddresses(host: string, signal: AbortSignal) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: () => void = () => {};
  try {
    signal.throwIfAborted();
    return await Promise.race([
      lookup(host, { all: true }),
      new Promise<never>((_, reject) => {
        abort = () =>
          reject(signal.reason instanceof Error ? signal.reason : new Error('音乐请求已取消'));
        signal.addEventListener('abort', abort, { once: true });
        timer = setTimeout(
          () => reject(new MusicNetworkError('dns', '音乐平台域名解析超时，请检查 DNS 或系统代理')),
          8000,
        );
        timer.unref();
      }),
    ]);
  } catch (cause) {
    throw cause instanceof MusicNetworkError
      ? cause
      : new MusicNetworkError('dns', '无法解析音乐平台域名，请检查 DNS 或系统代理');
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}
export async function boundedBody(
  response: Response,
  limit = 8 * 1024 * 1024,
): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) {
    await response.body?.cancel();
    throw Error('音乐响应超过大小上限');
  }
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw Error('音乐响应超过大小上限');
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}
