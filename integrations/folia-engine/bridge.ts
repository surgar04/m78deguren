import { z } from 'zod';
import type { MusicRequest } from '../../src/lib/music-contracts';
import { providerPayload } from './provider-payload';

export type NativeMusicBridge = (request: MusicRequest) => Promise<unknown>;
let desktopRequest: NativeMusicBridge | null = null;

/** 原生宿主故障采用 Folia 的结构化错误返回，避免被误报为“需要桌面版 YouTube”。 */
export async function requestProvider(
  request: NativeMusicBridge,
  provider: 'ytm' | 'spotify',
  action: string,
  params: Record<string, unknown> = {},
): Promise<unknown> {
  const payload = providerPayload(params);
  try {
    return await request({ operation: 'provider', provider, action, params: payload });
  } catch {
    return {
      ok: false,
      error: {
        code: 'network',
        message: `${provider === 'ytm' ? 'YouTube Music' : 'Spotify'} 音乐服务连接未完成，请重试；如持续失败，请检查网络代理和音乐组件完整性。无需安装该平台的桌面客户端。`,
      },
    };
  }
}
const relay = z.object({
  ok: z.boolean(),
  status: z.number(),
  body: z.string(),
  bodyBase64: z.string().optional(),
  contentType: z.string().optional(),
});

/** 只提供所选四个平台需要的桌面接口；不暴露文件系统、Shell、任意 IPC 或 Electron 运行时。 */
export function installDesktopBridge(request: NativeMusicBridge): void {
  desktopRequest = request;
  const providerRequest = async (
    provider: 'ytm' | 'spotify',
    action: string,
    params: Record<string, unknown> = {},
  ) => requestProvider(request, provider, action, params);
  Object.assign(window, {
    electron: {
      platform: 'win32',
      getNeteasePort: async () => {
        await request({ operation: 'runtime' });
        return 1;
      },
      getQqPort: async () => {
        await request({ operation: 'runtime' });
        return 1;
      },
      getNeteaseApiStatus: async () => {
        await request({ operation: 'runtime' });
        return { status: 'running', port: 1 };
      },
      getQqApiStatus: async () => {
        await request({ operation: 'runtime' });
        return { status: 'running', port: 1 };
      },
      restartNeteaseApi: async () => {
        await request({ operation: 'runtime' });
        return { status: 'running', port: 1 };
      },
      restartQqApi: async () => {
        await request({ operation: 'runtime' });
        return { status: 'running', port: 1 };
      },
      ytmRequest: (action: string, params: Record<string, unknown>) =>
        providerRequest('ytm', action, params),
      spotifyRequest: (action: string, params: Record<string, unknown>) =>
        providerRequest('spotify', action, params),
      fetchLyricProxy: async (url: string, init?: { method?: string; body?: string }) => {
        const value = relay.parse(
          await request({
            operation: 'relay',
            url,
            kind: 'text',
            ...(init?.method === 'POST' ? { method: 'POST' as const } : {}),
            ...(typeof init?.body === 'string' ? { body: init.body } : {}),
          }),
        );
        return {
          ok: value.ok,
          status: value.status,
          statusText: '',
          bodyText: value.body,
          headers: { 'content-type': value.contentType ?? 'text/plain' },
        };
      },
    },
  });
}
/** QQ 的公开 musicu 调用原来依赖 Electron 补 CORS；现在走同一受限 Rust 网关。 */
export function musicPlatformFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
  const url = new URL(String(input));
  if (url.hostname !== 'u.y.qq.com') return fetch(input, init);
  if (!desktopRequest) return Promise.reject(Error('音乐桌面桥未连接'));
  const request = desktopRequest;
  return new Promise<Response>((resolve, reject) => {
    const abort = () => reject(new DOMException('音乐请求已取消', 'AbortError'));
    if (init.signal?.aborted) {
      abort();
      return;
    }
    init.signal?.addEventListener('abort', abort, { once: true });
    void request({
      operation: 'relay',
      url: url.href,
      kind: 'text',
      method: init.method === 'POST' ? 'POST' : 'GET',
      ...(typeof init.body === 'string' ? { body: init.body } : {}),
    }).then(
      (value) => {
        init.signal?.removeEventListener('abort', abort);
        if (init.signal?.aborted) {
          abort();
          return;
        }
        try {
          const response = relay.parse(value);
          resolve(
            new Response(response.body, {
              status: response.status,
              headers: { 'content-type': response.contentType ?? 'application/json' },
            }),
          );
        } catch (cause) {
          reject(cause instanceof Error ? cause : Error('音乐响应无效'));
        }
      },
      (cause) => {
        init.signal?.removeEventListener('abort', abort);
        reject(cause instanceof Error ? cause : Error('音乐请求失败'));
      },
    );
  });
}
