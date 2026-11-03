import { createRequire } from 'node:module';
import { join } from 'node:path';
import { z } from 'zod';
import type { createVault } from './vault.ts';
import { platformFetch } from './network.ts';
import { createYtmAuth } from './ytm-auth.ts';
import { MusicNetworkError, clearMusicRoutes } from './network-route.ts';

const require = createRequire(import.meta.url);
type Platform = 'ytm' | 'spotify';
type Bridge = {
  request: (operation: string, params: Record<string, unknown>) => Promise<unknown>;
  handleAudioRequest: (request: Request) => Promise<Response>;
  shutdown?: () => Promise<void>;
};
const bridgeShape = z
  .object({
    request: z.custom<Bridge['request']>((value) => typeof value === 'function'),
    handleAudioRequest: z.custom<Bridge['handleAudioRequest']>(
      (value) => typeof value === 'function',
    ),
    shutdown: z
      .custom<NonNullable<Bridge['shutdown']>>((value) => typeof value === 'function')
      .optional(),
  })
  .passthrough();
export type HostCall = (action: 'open' | 'sandbox', payload: string) => Promise<unknown>;

/** 复用 Folia 的账户、分页、音源和歌词桥。只在该平台第一次被访问时加载其库和原生模块。 */
export function createPlatforms(
  root: string,
  vault: ReturnType<typeof createVault>,
  call: HostCall,
) {
  const bridges = new Map<Platform, Bridge>();
  const auth = createYtmAuth(root);
  let browserUserAgent: string | undefined;
  const get = (provider: Platform): Bridge => {
    const held = bridges.get(provider);
    if (held) return held;
    const shared = {
      store: vault.store,
      safeStorage: vault.safeStorage,
      fetch: platformFetch,
      language: () => 'zh-CN',
      log: () => {},
      warn: () => {},
    };
    let candidate: unknown;
    if (provider === 'spotify') {
      const source: unknown = require('./upstream/electron/spotify/spotifyApiBridge.cjs');
      const factory = z
        .object({
          createSpotifyApiBridge: z.custom<(options: object) => unknown>(
            (value) => typeof value === 'function',
          ),
        })
        .parse(source);
      candidate = factory.createSpotifyApiBridge({
        ...shared,
        openExternal: (url: string) => call('open', url),
        audioDirectory: () => join(root, 'cache/spotify'),
      });
    } else {
      const source: unknown = require('./upstream/electron/ytm/ytmApiBridge.cjs');
      const factory = z
        .object({
          createYtmApiBridge: z.custom<(options: object) => unknown>(
            (value) => typeof value === 'function',
          ),
        })
        .parse(source);
      candidate = factory.createYtmApiBridge({
        ...shared,
        browserSignIn: auth.browser,
        // 保留上游内部告警的含义，不保存其异常对象或可能包含凭据的原始文本。
        warn: (message: unknown) => {
          if (
            typeof message === 'string' &&
            message.startsWith('[Ytm] Web sign-in could not be stored')
          )
            auth.storageFailure();
        },
        fetch: async (input: string | URL | Request, init?: RequestInit) => {
          const verifying = auth.snapshot().phase === 'verifying';
          // 仅在验证账号的只读请求中重试一次临时网络/5xx，单次 15 秒，留在上游 45 秒总预算内。
          for (let attempt = 0; ; attempt++) {
            try {
              const signal = verifying ? AbortSignal.timeout(15000) : undefined;
              const response = await platformFetch(input, {
                ...init,
                ...(signal
                  ? { signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal }
                  : {}),
              });
              if (response.status === 429) auth.network('rate-limited');
              if (verifying && attempt === 0 && response.status >= 500) {
                await response.body?.cancel();
                continue;
              }
              return response;
            } catch (cause) {
              const code =
                cause instanceof MusicNetworkError
                  ? cause.code
                  : /CERT|TLS|SSL/i.test(
                        String(
                          z.object({ cause: z.object({ code: z.string() }) }).safeParse(cause).data
                            ?.cause.code ?? '',
                        ),
                      )
                    ? 'tls'
                    : 'network';
              auth.network(code);
              if (!verifying || attempt > 0 || code === 'tls' || code === 'proxy') throw cause;
            }
          }
        },
        evaluate: (source: string) => call('sandbox', source),
        signInFolder: () => join(root, 'browser-sign-in'),
        // 独立 Node 没有 Electron 的 process.versions.chrome，不能把 Chrome/undefined 存进登录会话。
        browserName: () => {
          if (!browserUserAgent) throw Error('YouTube 浏览器身份尚未准备');
          return browserUserAgent;
        },
      });
    }
    const bridge = bridgeShape.parse(candidate);
    bridges.set(provider, bridge);
    return bridge;
  };
  return {
    request: async (provider: Platform, operation: string, params: Record<string, unknown>) => {
      if (provider === 'ytm' && operation === 'auth_progress')
        return { ok: true, data: auth.snapshot() };
      if (provider === 'ytm' && !browserUserAgent) {
        const { Utils } = await import('youtubei.js');
        browserUserAgent ??= Utils.getRandomUserAgent('desktop');
      }
      const bridge = get(provider);
      if (provider === 'ytm' && operation === 'web_login_start') {
        auth.begin();
        clearMusicRoutes();
        browserUserAgent = (await auth.browserIdentity()) ?? browserUserAgent;
        try {
          // 先验证 DPAPI 可用，避免网页授权后才发现本机无法安全保存会话。
          const probe = vault.safeStorage.encryptString('zhenjing-auth-preflight');
          if (vault.safeStorage.decryptString(probe) !== 'zhenjing-auth-preflight')
            throw Error('unavailable');
        } catch {
          const result = {
            ok: false,
            error: {
              code: 'unavailable',
              message: '当前 Windows 用户无法安全保护登录会话，请修复应用安装或用户权限后重试。',
              reason: 'session-not-saved',
            },
          };
          auth.note(result);
          return result;
        }
      }
      if (provider === 'ytm' && operation === 'web_login_cancel') auth.cancel();
      let result = await bridge.request(operation, params);
      if (
        provider === 'ytm' &&
        (operation === 'web_login_check' || operation === 'web_login_start')
      ) {
        if (
          operation === 'web_login_check' &&
          auth.storageFailed &&
          z
            .object({ ok: z.literal(true), data: z.object({ state: z.literal('confirmed') }) })
            .safeParse(result).success
        ) {
          await bridge.request('logout', {});
          result = {
            ok: true,
            data: {
              state: 'error',
              code: 'unavailable',
              reason: 'session-not-saved',
              message:
                '账号已验证，但登录会话无法安全保存。已撤销本次连接，请检查数据目录权限和磁盘空间后重试。',
            },
          };
        }
        if (
          operation === 'web_login_check' ||
          z.object({ ok: z.literal(false) }).safeParse(result).success
        )
          auth.note(result);
      }
      return result;
    },
    audio: (url: string, headers: Headers) =>
      get(url.startsWith('folia-spotify:') ? 'spotify' : 'ytm').handleAudioRequest(
        new Request(url, { headers }),
      ),
    async shutdown() {
      await Promise.allSettled(
        [...bridges.values()].map(async (bridge) => {
          await bridge.shutdown?.();
        }),
      );
      await auth.flushed();
    },
  };
}
