import { createRequire } from 'node:module';
import { join } from 'node:path';
import { z } from 'zod';
import type { createVault } from './vault.ts';
import { platformFetch } from './network.ts';

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
      if (provider === 'ytm' && !browserUserAgent) {
        const { Utils } = await import('youtubei.js');
        browserUserAgent ??= Utils.getRandomUserAgent('desktop');
      }
      return get(provider).request(operation, params);
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
    },
  };
}
