// @vitest-environment node
import { createRequire } from 'node:module';
import { afterEach, expect, it } from 'vitest';
import { z } from 'zod';
import { createAssets, audioRange, AUDIO_CHUNK_BYTES } from '../assets.ts';

// 使用冻结上游的真实 YouTube 分段实现，注入合成下载计划，不访问私人账号。
const require = createRequire(import.meta.url);
type Audio = {
  issue: (id: string, level: string) => Promise<{ url: string }>;
  handle: (request: Request) => Promise<Response>;
  clear: () => void;
};
const module = z
  .object({
    createYtmAudio: z.custom<(options: object) => Audio>((value) => typeof value === 'function'),
  })
  .parse(require('../upstream/electron/ytm/audio.cjs') as unknown);
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const clean of cleanups.splice(0)) clean();
});

it('YouTube 音频经过私有媒体网关后可连续读取、跳转、尾部读取及 HEAD 探测', async () => {
  const clear = Buffer.alloc(3 * 1024 * 1024 + 513);
  for (let index = 0; index < clear.length; index++) clear[index] = index % 251;
  clear.write('OggS');
  const audio = module.createYtmAudio({
    log() {},
    warn() {},
    loadPlan: () =>
      Promise.resolve({
        route: 'fixture',
        mimeType: 'audio/ogg',
        contentLength: clear.length,
        open: () =>
          Promise.resolve({
            stream: new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(clear);
                controller.close();
              },
            }),
            abort() {},
          }),
      }),
  });
  cleanups.push(() => audio.clear());
  const gateway = createAssets(
    {
      request: () => Promise.resolve(null),
      audio: (url, headers) => audio.handle(new Request(url, { headers })),
      shutdown: () => Promise.resolve(),
    },
    'fixture-secret',
  );
  cleanups.push(() => gateway.stop());
  expect(() => gateway.register('folia-spotify://audio/retired', 'audio')).toThrow();
  const source = await audio.issue('0123456789A', 'high');
  const handle = gateway.register(source.url, 'audio');
  const port = await gateway.start();
  const url = `http://127.0.0.1:${port}${new URL(handle.url).pathname}`;
  const read = (range?: string, method = 'GET') =>
    fetch(url, {
      method,
      headers: { authorization: 'Bearer fixture-secret', ...(range ? { range } : {}) },
    });
  const first = await read();
  expect(first.status).toBe(206);
  expect(first.headers.get('content-range')).toBe(
    `bytes 0-${AUDIO_CHUNK_BYTES - 1}/${clear.length}`,
  );
  const parts = [Buffer.from(await first.arrayBuffer())];
  let offset = parts[0]?.length ?? 0;
  expect(offset).toBe(AUDIO_CHUNK_BYTES);
  while (offset < clear.length) {
    const part = Buffer.from(await (await read(`bytes=${offset}-`)).arrayBuffer());
    expect(part.length).toBeGreaterThan(0);
    expect(part.length).toBeLessThanOrEqual(AUDIO_CHUNK_BYTES);
    parts.push(part);
    offset += part.length;
  }
  expect(Buffer.concat(parts).equals(clear)).toBe(true);
  const seek = await read('bytes=17-1024');
  expect(Buffer.from(await seek.arrayBuffer())).toEqual(clear.subarray(17, 1025));
  const tail = await read('bytes=-128');
  expect(Buffer.from(await tail.arrayBuffer())).toEqual(clear.subarray(-128));
  const head = await read('bytes=0-', 'HEAD');
  expect(head.headers.get('content-type')).toBe('audio/ogg');
  expect(await head.text()).toBe('');
  expect((await read('bytes=0-1,4-5')).status).toBe(416);
  expect((await fetch(url)).status).toBe(403);
}, 20000);

it('首包、拖动和尾读均有界，拒绝颠倒范围和超出安全整数的输入', () => {
  expect(audioRange('bytes=0-')).toBe(`bytes=0-${AUDIO_CHUNK_BYTES - 1}`);
  expect(audioRange('bytes=-9999999')).toBe(`bytes=-${AUDIO_CHUNK_BYTES}`);
  for (const input of [
    'bytes=2-1',
    'bytes=9007199254740991-',
    'bytes=0-9007199254740992',
    'bytes=-0',
    'bytes=0-1,3-4',
  ])
    expect(audioRange(input)).toBeNull();
});
