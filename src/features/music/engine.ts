import { z } from 'zod';
import { executeMusic } from '@/lib/desktop';
import type { MusicRequest } from '@/lib/music-contracts';

type Bridge = (request: MusicRequest) => Promise<unknown>;
let loaded: Promise<Record<string, unknown>> | null = null;
/** 只有音乐页面或正在播放的会话加载平台适配器，首页不下载该模块。 */
async function engine() {
  loaded ??= (async () => {
    // 完整同源 URL 避免 Vite 开发服务器给 public 中的预编译模块追加 ?import 并拒绝加载。
    const path = new URL('/music-engine/api.js', window.location.origin).href;
    const imported: unknown = await import(/* @vite-ignore */ path);
    const factory = z
      .object({
        createMusicEngine: z.custom<(bridge: Bridge) => Promise<unknown>>(
          (value) => typeof value === 'function',
        ),
      })
      .parse(imported);
    return z
      .record(z.string(), z.unknown())
      .parse(await factory.createMusicEngine((request) => executeMusic(request, z.unknown())));
  })().catch((cause: unknown) => {
    loaded = null;
    throw cause;
  });
  return loaded;
}
export async function musicEngine<T>(
  operation: string,
  args: unknown[],
  schema: z.ZodType<T>,
): Promise<T> {
  const instance = await engine();
  const method: unknown = instance[operation];
  if (typeof method !== 'function') throw Error('音乐引擎接口不可用，请重新安装完整版本');
  const result: unknown = await Reflect.apply(method, instance, args);
  return schema.parse(result);
}
