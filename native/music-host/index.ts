import { randomBytes, randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { mkdirSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { z } from 'zod';
import { createVault } from './vault.ts';
import { createPlatforms, type HostCall } from './providers.ts';
import { createProviderApi } from './provider-api.ts';
import { createAssets } from './assets.ts';
import { inspectLocalFile } from './local-metadata.ts';
import { closeMusicNetwork } from './network-route.ts';

// 标准输出只承载有界协议帧。第三方库的控制台输出不混入 RPC，也不记录 Cookie 或令牌。
for (const key of ['log', 'debug', 'info', 'warn', 'error'] as const) console[key] = () => {};
const emit = (message: object) => {
  const encoded = JSON.stringify(message);
  if (Buffer.byteLength(encoded) > 12 * 1024 ** 2) throw Error('音乐响应超过协议上限');
  process.stdout.write(encoded + '\n');
};
const root = process.env.ZHENJING_MUSIC_DATA ?? '',
  helper = process.env.ZHENJING_MUSIC_VAULT ?? '';
if (
  !isAbsolute(root) ||
  !isAbsolute(helper) ||
  (process.env.ZHENJING_RESTRICT_WRITES_TO_D === '1' && !resolve(root).startsWith('D:\\'))
)
  throw Error('音乐进程的数据位置无效');
mkdirSync(root, { recursive: true });
const vault = createVault(root, helper);
const pending = new Map<
  string,
  {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
const call: HostCall = (action, payload) =>
  new Promise((resolve, reject) => {
    if (pending.size >= 8 || Buffer.byteLength(payload) > 4 * 1024 ** 2) {
      reject(Error('音乐桌面请求超过上限'));
      return;
    }
    const id = randomUUID(),
      timer = setTimeout(
        () => {
          pending.delete(id);
          reject(Error('音乐桌面请求超时'));
          // 冷启动隔离 WebView2 需要创建独立档案，预算应覆盖原生就绪等待与脚本执行。
          // 打开授权网页仍沿用较短时限；外层原生 RPC 继续保留 90 秒总上限。
        },
        action === 'sandbox' ? 60000 : 30000,
      );
    pending.set(id, { resolve, reject, timer });
    emit({ type: 'host-call', id, action, payload });
  });
const platforms = createPlatforms(root, vault, call, (phase, code) =>
    emit({ type: 'diagnostic', event: 'auth.phase', phase, code }),
  ),
  api = createProviderApi(vault);
const secret = randomBytes(32).toString('hex'),
  assets = createAssets(platforms, secret);
const port = await assets.start();
emit({ type: 'ready', version: 1, port, secret });
const requestSchema = z
  .object({
    id: z.uuid(),
    operation: z.string().max(32),
    provider: z.enum(['netease', 'qq', 'ytm', 'spotify']).optional(),
    action: z.string().max(80).optional(),
    path: z.string().max(32768).optional(),
    method: z.enum(['GET', 'POST']).optional(),
    params: z.record(z.string(), z.json()).optional(),
    headers: z.record(z.string(), z.string()).optional(),
    body: z.string().max(1048576).optional(),
    url: z.string().max(16384).optional(),
    kind: z.enum(['audio', 'image', 'text']).optional(),
  })
  .strict();
const hostReplySchema = z.object({
  type: z.literal('host-reply'),
  id: z.uuid(),
  ok: z.boolean(),
  value: z.unknown().optional(),
});
let running = 0;
async function execute(input: unknown): Promise<void> {
  const hostReply = hostReplySchema.safeParse(input);
  if (hostReply.success) {
    const held = pending.get(hostReply.data.id);
    if (!held) return;
    pending.delete(hostReply.data.id);
    clearTimeout(held.timer);
    if (hostReply.data.ok) held.resolve(hostReply.data.value);
    else held.reject(Error('音乐桌面操作未完成'));
    return;
  }
  const request = requestSchema.parse(input);
  if (running >= 16) {
    emit({ type: 'result', id: request.id, ok: false, error: '音乐请求较多，请稍后重试' });
    return;
  }
  running++;
  try {
    let value: unknown;
    if (request.operation === 'runtime')
      value = { available: true, platforms: ['qq', 'netease', 'ytm', 'spotify'] };
    else if (
      request.operation === 'provider' &&
      (request.provider === 'ytm' || request.provider === 'spotify') &&
      request.action
    )
      value = await platforms.request(request.provider, request.action, request.params ?? {});
    else if (
      request.operation === 'api' &&
      (request.provider === 'qq' || request.provider === 'netease') &&
      request.path &&
      request.method
    )
      value = await api(
        request.provider,
        request.path,
        request.method,
        request.params ?? {},
        request.headers ?? {},
      );
    else if (request.operation === 'relay' && request.url && request.kind)
      value =
        request.kind === 'text'
          ? await assets.text(request.url, request.method, request.body)
          : assets.register(request.url, request.kind);
    else if (request.operation === 'inspect' && request.path && isAbsolute(request.path))
      value = await inspectLocalFile(request.path);
    else throw Error('音乐请求未开放或参数无效');
    emit({ type: 'result', id: request.id, ok: true, value });
  } catch (cause) {
    emit({ type: 'diagnostic', event: 'host.request_failed', code: 'request-failed' });
    const message = cause instanceof Error ? cause.message : '音乐服务请求失败';
    emit({
      type: 'result',
      id: request.id,
      ok: false,
      error: /cookie|token|authorization|password/i.test(message)
        ? '平台的登录状态或授权不可用，请重新登录'
        : message.slice(0, 1000),
    });
  } finally {
    running--;
  }
}
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on('line', (line) => {
  if (Buffer.byteLength(line) > 5 * 1024 ** 2) {
    process.exitCode = 2;
    lines.close();
    return;
  }
  try {
    void execute(JSON.parse(line) as unknown).catch(() => {
      process.exitCode = 2;
      lines.close();
    });
  } catch {
    process.exitCode = 2;
    lines.close();
  }
});
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  assets.stop();
  for (const value of pending.values()) {
    clearTimeout(value.timer);
    value.reject(Error('音乐进程已关闭'));
  }
  pending.clear();
  await Promise.race([platforms.shutdown(), new Promise((resolve) => setTimeout(resolve, 3000))]);
  await closeMusicNetwork();
  process.exit();
}
lines.on('close', () => {
  void shutdown();
});
process.once('SIGTERM', () => {
  void shutdown();
});
// 未处理异常只传固定原因代码；不把异常对象/堆栈中的平台响应混入标准输出协议。
process.once('uncaughtException', () => {
  emit({ type: 'diagnostic', event: 'host.error', code: 'uncaught-exception' });
  process.exitCode = 1;
  void shutdown();
});
process.once('unhandledRejection', () => {
  emit({ type: 'diagnostic', event: 'host.error', code: 'unhandled-rejection' });
  process.exitCode = 1;
  void shutdown();
});
