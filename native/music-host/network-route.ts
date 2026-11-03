import { execFile } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { Agent, Dispatcher1Wrapper, ProxyAgent } from 'undici';
import { z } from 'zod';

const routeSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('direct') }).strict(),
  z.object({ mode: z.literal('proxy'), proxy: z.string().max(4096) }).strict(),
]);
export type MusicRoute = z.infer<typeof routeSchema>;
const cached = new Map<string, { at: number; pending: Promise<MusicRoute> }>();
const agents = new Map<string, Dispatcher1Wrapper>();
let direct: Dispatcher1Wrapper | undefined;
export class MusicNetworkError extends Error {
  readonly code: 'dns' | 'proxy' | 'network' | 'tls';
  constructor(code: 'dns' | 'proxy' | 'network' | 'tls', message: string) {
    super(message);
    this.code = code;
  }
}
/** 浏览器可以使用 PAC，而 Node 环境变量代理无法解析 PAC。仅 Google 音乐请求使用受限系统路由查询。 */
export function musicRoute(url: URL): Promise<MusicRoute> {
  const helper = process.env['ZHENJING_MUSIC_VAULT'];
  if (!helper || !isAbsolute(helper)) return Promise.resolve({ mode: 'direct' });
  const key = url.href;
  const held = cached.get(key);
  if (held && Date.now() - held.at < 30_000) return held.pending;
  if (cached.size >= 128) {
    const first = cached.keys().next().value;
    if (first) cached.delete(first);
  }
  const pending = new Promise<MusicRoute>((resolve, reject) => {
    const env = { ...process.env };
    // Rust 为其他音乐 SDK 注入的显式系统代理不能覆盖 Windows 对此地址的 PAC / 绕过规则。
    if (env['ZHENJING_MUSIC_SYSTEM_PROXY'] === '1') {
      for (const name of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy'])
        delete env[name];
    }
    const child = execFile(
      helper,
      ['--music-route'],
      { timeout: 8000, maxBuffer: 8192, windowsHide: true, env },
      (cause, stdout) => {
        if (cause) {
          reject(
            new MusicNetworkError(
              'proxy',
              'Windows 系统代理或 PAC 解析失败，请检查系统代理设置后重试',
            ),
          );
          return;
        }
        try {
          const route = routeSchema.parse(JSON.parse(stdout) as unknown);
          if (route.mode === 'proxy') {
            const proxy = new URL(route.proxy);
            if (
              !['http:', 'https:'].includes(proxy.protocol) ||
              proxy.username ||
              proxy.password ||
              proxy.pathname !== '/' ||
              proxy.search ||
              proxy.hash
            )
              throw Error('invalid proxy');
          }
          resolve(route);
        } catch {
          reject(
            new MusicNetworkError(
              'proxy',
              '系统返回了不支持的代理，请使用 Windows HTTP/HTTPS 系统代理',
            ),
          );
        }
      },
    );
    child.stdin?.on('error', () => {});
    child.stdin?.end(url.href + '\n');
  }).catch((cause: unknown) => {
    cached.delete(key);
    throw cause;
  });
  cached.set(key, { at: Date.now(), pending });
  return pending;
}
/** Undici 8 与 Node 24 内建 fetch 的 dispatcher 协议不同，显式适配，禁止关闭 TLS 验证。 */
export function proxyDispatcher(proxy: string): Dispatcher1Wrapper {
  const existing = agents.get(proxy);
  if (existing) return existing;
  if (agents.size >= 8) {
    const first = agents.entries().next().value;
    if (first) {
      agents.delete(first[0]);
      void first[1].close().catch(() => {});
    }
  }
  const dispatcher = new Dispatcher1Wrapper(new ProxyAgent(proxy));
  agents.set(proxy, dispatcher);
  return dispatcher;
}
export function directDispatcher(): Dispatcher1Wrapper {
  direct ??= new Dispatcher1Wrapper(new Agent());
  return direct;
}
export async function closeMusicNetwork(): Promise<void> {
  cached.clear();
  await Promise.allSettled([...agents.values()].map((agent) => agent.destroy()));
  await direct?.destroy();
  direct = undefined;
  agents.clear();
}
/** 用户重新授权时重新解析当前网络配置，不让旧代理缓存阻止即时重试。 */
export function clearMusicRoutes(): void {
  cached.clear();
}
