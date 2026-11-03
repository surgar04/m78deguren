import './check-environment.ts';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { z } from 'zod';

// 合成音频仅存在独立验收目录，不会混入用户曲库或生产数据。
const root = resolve('.cache/verification', `music-host-${randomUUID()}`);
await mkdir(join(root, 'tmp'), { recursive: true });
const wave = Buffer.alloc(44 + 16000 * 2);
wave.write('RIFF');
wave.writeUInt32LE(wave.length - 8, 4);
wave.write('WAVEfmt ', 8);
wave.writeUInt32LE(16, 16);
wave.writeUInt16LE(1, 20);
wave.writeUInt16LE(1, 22);
wave.writeUInt32LE(16000, 24);
wave.writeUInt32LE(32000, 28);
wave.writeUInt16LE(2, 32);
wave.writeUInt16LE(16, 34);
wave.write('data', 36);
wave.writeUInt32LE(wave.length - 44, 40);
const audio = join(root, 'verification.wav');
await writeFile(audio, wave);
const child = spawn(
  resolve('src-tauri/resources/music-host/node.exe'),
  ['--max-old-space-size=256', resolve('src-tauri/resources/music-host/index.ts')],
  {
    cwd: root,
    env: {
      ...process.env,
      ZHENJING_MUSIC_DATA: root,
      ZHENJING_MUSIC_VAULT: resolve(
        'src-tauri/resources/hardware-monitor/runtime/ZhenjingMonitor.exe',
      ),
      TEMP: join(root, 'tmp'),
      TMP: join(root, 'tmp'),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  },
);
const messages = createInterface({ input: child.stdout });
const waiting = new Map<
  string,
  { resolve: (value: unknown) => void; reject: (cause: Error) => void; label: string }
>();
let readyResolve: ((value: unknown) => void) | undefined;
const ready = new Promise<unknown>((resolve) => {
  readyResolve = resolve;
});
messages.on('line', (line) => {
  const message = z.record(z.string(), z.unknown()).parse(JSON.parse(line) as unknown);
  if (message.type === 'ready') readyResolve?.(message);
  else if (message.type === 'result' && typeof message.id === 'string') {
    const item = waiting.get(message.id);
    waiting.delete(message.id);
    if (message.ok === true) item?.resolve(message.value);
    else item?.reject(Error(`音乐子进程拒绝验收请求：${item.label}`));
  } else if (message.type === 'host-call')
    child.stdin.write(JSON.stringify({ type: 'host-reply', id: message.id, ok: false }) + '\n');
});
async function request(operation: Record<string, unknown>) {
  const id = randomUUID();
  // 只记录操作名称，不输出请求载荷、地址、授权回复或原生宿主的任意错误文本。
  const label = [operation.operation, operation.provider, operation.action]
    .filter((value) => typeof value === 'string' && /^[a-z_-]{1,80}$/u.test(value))
    .join('/');
  const value = new Promise<unknown>((resolve, reject) =>
    waiting.set(id, { resolve, reject, label }),
  );
  child.stdin.write(JSON.stringify({ ...operation, id }) + '\n');
  return Promise.race([
    value,
    new Promise<never>((_, reject) => {
      const timer = setTimeout(() => reject(Error('音乐验收请求超时')), 90000);
      timer.unref();
    }),
  ]);
}
try {
  // 在真实发布目录加载原生插件，验证 ABI 与私有 CRT；不创建会话、不读取账户或连接 Spotify。
  const nativeRequire = createRequire(resolve('src-tauri/resources/music-host/index.ts'));
  z.object({
    createSession: z.custom<(...args: unknown[]) => unknown>(
      (value) => typeof value === 'function',
    ),
  }).parse(nativeRequire('@lox-audioserver/node-librespot') as unknown);
  console.log('Spotify native playback module loaded; no account/session was opened.');
  const state = z.object({ port: z.number(), secret: z.string() }).parse(await ready);
  assert.equal(
    (await fetch(`http://127.0.0.1:${state.port}/media/${randomUUID()}`)).status,
    403,
    '私有流服务必须拒绝无口令读取',
  );
  const runtime = z
    .object({ available: z.boolean(), platforms: z.array(z.string()) })
    .parse(await request({ operation: 'runtime' }));
  assert.equal(runtime.available, true);
  assert.equal(runtime.platforms.length, 4);
  // 使用截图中实际出错的 QQ 曲目及网易云真实搜索结果，验证发布组件中的封面链路，而非只测 URL 拼接。
  const netease = z.object({ body: z.string() }).parse(
    await request({
      operation: 'api',
      provider: 'netease',
      path: '/cloudsearch',
      method: 'GET',
      params: { keywords: '晴天', limit: 1 },
    }),
  );
  const neteaseCover = z
    .object({
      result: z.object({ songs: z.array(z.object({ al: z.object({ picUrl: z.string() }) })) }),
    })
    .parse(JSON.parse(netease.body) as unknown).result.songs[0]?.al.picUrl;
  assert.ok(neteaseCover, '网易云实际搜索应返回封面');
  for (const cover of [
    'https://y.gtimg.cn/music/photo_new/T002M000001sULrB0k3P9u.jpg',
    neteaseCover,
  ]) {
    const media = z
      .object({ url: z.string() })
      .parse(await request({ operation: 'relay', kind: 'image', url: cover }));
    const response = await fetch(`http://127.0.0.1:${state.port}${new URL(media.url).pathname}`, {
      headers: { authorization: `Bearer ${state.secret}` },
    });
    assert.equal(response.status, 200, '真实音乐封面应可读取');
    assert.match(response.headers.get('content-type') ?? '', /^image\/(jpeg|png|webp|gif|avif)$/u);
    const bytes = await response.arrayBuffer();
    assert.ok(bytes.byteLength > 100 && bytes.byteLength <= 4 * 1024 * 1024);
  }
  await assert.rejects(
    request({ operation: 'relay', kind: 'text', url: 'https://127.0.0.1/private' }),
  );
  await assert.rejects(
    request({
      operation: 'api',
      provider: 'netease',
      path: '/arbitrary/endpoint',
      method: 'GET',
      params: {},
    }),
  );
  const metadata = z
    .object({ title: z.string(), durationMs: z.number(), artists: z.array(z.string()) })
    .parse(await request({ operation: 'inspect', path: audio }));
  assert.equal(metadata.durationMs, 1000);
  assert.equal(metadata.title, 'verification');
  for (const params of [
    { domain: 'https://example.invalid' },
    { proxy: 'http://127.0.0.1:1' },
    { id: '../../logout' },
  ]) {
    await assert.rejects(
      request({ operation: 'api', provider: 'netease', path: '/album', method: 'GET', params }),
    );
  }
  const channels = z.object({ status: z.number(), body: z.string() }).parse(
    await request({
      operation: 'api',
      provider: 'qq',
      path: '/login/channels',
      method: 'GET',
      params: {},
    }),
  );
  assert.equal(channels.status, 200, 'QQ 服务端适配器应提供真实登录方式');
  assert.ok(JSON.parse(channels.body), '登录方式必须是有效 JSON');
  for (const provider of ['spotify', 'ytm']) {
    const status = z
      .object({ ok: z.boolean(), data: z.unknown().optional() })
      .parse(
        await request({ operation: 'provider', provider, action: 'login_status', params: {} }),
      );
    assert.equal(status.ok, true, `${provider} 应能读取真实的未登录状态`);
  }
  await writeFile(
    join(root, 'result.json'),
    JSON.stringify(
      {
        passed: true,
        checks: [
          'private-stream-auth',
          'spotify-native-addon-load',
          'four-platform-runtime',
          'qq-large-cover-resize-and-real-netease-cover',
          'relay-private-rejection',
          'endpoint-allowlist',
          'actual-wave-metadata',
          'qq-serverless-channels',
          'spotify-signed-out',
          'ytm-signed-out',
        ],
      },
      null,
      2,
    ),
  );
  console.log(`音乐子进程验收通过：${root}`);
} finally {
  child.stdin.end();
  const exit = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  await Promise.race([exit, new Promise<void>((resolve) => setTimeout(resolve, 5000))]);
  if (child.exitCode === null) child.kill();
  messages.close();
}
