import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

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
      ...(!['GET', 'HEAD'].includes(original.method) ? { body: await original.arrayBuffer() } : {}),
      ...init,
    };
  }
  let url = musicUrl(
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
  );
  const deadline = AbortSignal.timeout(45000);
  const signal = init.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
  for (let redirects = 0; redirects < 8; redirects++) {
    const addresses = await lookup(url.hostname, { all: true });
    if (!addresses.length || addresses.some((item) => !publicAddress(item.address)))
      throw Error('音乐资源不能指向本地或内网');
    const response = await fetch(url, { ...init, signal, redirect: 'manual' });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const next = response.headers.get('location');
    await response.body?.cancel();
    if (!next) throw Error('平台返回无效重定向');
    const target = musicUrl(new URL(next, url).href);
    // 跨主机跳转不转发账户凭据；同平台需要的鉴权应由相应 adapter 主动生成。
    if (target.origin !== url.origin) {
      const headers = new Headers(init.headers);
      headers.delete('authorization');
      headers.delete('cookie');
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
