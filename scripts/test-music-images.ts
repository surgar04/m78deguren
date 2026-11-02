import './check-environment.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createImageLoader, imageCandidates, imageMime } from '../native/music-host/images.ts';
import type { platformFetch } from '../native/music-host/network.ts';

await test('QQ 封面尺寸回退保持同一专辑，HTML 与任意来源不能作为图片', () => {
  const values = imageCandidates('https://y.gtimg.cn/music/photo_new/T002M000album123.jpg');
  assert.match(values[0] ?? '', /R800x800M000album123/u);
  assert.match(values[1] ?? '', /R300x300M000album123/u);
  assert.throws(() => imageCandidates('https://evil.invalid/image'));
  assert.equal(imageMime(Buffer.from('<html>not an image</html>')), null);
});
await test('图片并发合并、失败回退与 LRU 复用', async () => {
  let count = 0;
  const requests: RequestInit[] = [];
  const fetcher: typeof platformFetch = (_input, options = {}) => {
    count++;
    requests.push(options);
    return Promise.resolve(
      count === 1
        ? new Response('not found', { status: 404 })
        : new Response(new Uint8Array([255, 216, 255, 0, 1]), {
            headers: { 'content-type': 'application/octet-stream' },
          }),
    );
  };
  const loader = createImageLoader(fetcher),
    url = 'https://y.gtimg.cn/music/photo_new/T002M000album123.jpg';
  const values = await Promise.all([loader.load(url), loader.load(url)]);
  assert.equal(values[0]?.mime, 'image/jpeg');
  assert.equal(count, 2);
  await loader.load(url);
  assert.equal(count, 2);
  assert.equal(new Headers(requests[0]?.headers).get('referer'), 'https://y.qq.com/');
  loader.clear();
  await loader.load(url);
  assert.equal(count, 3);
});
