import './check-environment.ts';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import type * as React from 'react';
import type * as ReactDom from 'react-dom/client';

// 隔离浏览器档案、截图与媒体夹具均在 D 盘；不修改日常应用偏好，不操作系统设置。
const root = resolve('.cache/verification/wallpaper-media');
await mkdir(root, { recursive: true });
const context = await chromium.launchPersistentContext(resolve(root, 'browser-profile'), {
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: [`--disk-cache-dir=${resolve(root, 'browser-cache')}`, '--disable-component-update'],
  viewport: { width: 1200, height: 800 },
});
const results: Record<string, unknown> = {};
try {
  context.setDefaultTimeout(120_000);
  await context.addInitScript(() => {
    localStorage.setItem(
      'zhenjing.settings.ui',
      JSON.stringify({
        state: { language: 'zh-CN', splashEnabled: false },
        version: 1,
      }),
    );
  });
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto('http://127.0.0.1:1420/#/settings', {
    waitUntil: 'domcontentloaded',
    timeout: 120_000,
  });
  await page.getByRole('heading', { name: '外观与体验', exact: true }).waitFor();
  await page.getByText('视频：MP4 / WebM，最长 15 秒，最大 512 MiB；静音循环播放。').waitFor();
  for (const size of [
    { width: 1200, height: 800 },
    { width: 760, height: 560 },
  ]) {
    await page.setViewportSize(size);
    const metrics = await page.evaluate(async () => {
      const preview = document.querySelector('.settings-wallpaper-frame .settings-background');
      const background = getComputedStyle(
        document.querySelector('.home-wallpaper') ?? document.body,
      ).backgroundImage;
      const url = '/assets/settings/default-wallpaper.png';
      const image = new Image();
      image.src = url;
      await image.decode();
      return {
        width: innerWidth,
        height: innerHeight,
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
        background,
        preview: preview ? { width: preview.clientWidth, height: preview.clientHeight } : null,
        image: [image.naturalWidth, image.naturalHeight],
      };
    });
    await page.screenshot({ path: resolve(root, `settings-${size.width}.png`) });
    assert.ok(
      metrics.scrollWidth <= size.width && metrics.scrollHeight <= size.height + 3,
      JSON.stringify(metrics),
    );
    assert.match(metrics.background, /default-wallpaper\.png/u);
    assert.deepEqual(metrics.image, [1728, 1080]);
    results[`viewport${size.width}`] = metrics;
    await page.screenshot({ path: resolve(root, `settings-${size.width}.png`) });
  }
  await page.getByRole('combobox', { name: '壁纸', exact: true }).selectOption('none');
  assert.equal(await page.locator('.home-layout').getAttribute('data-background'), 'none');
  await page.getByRole('button', { name: '恢复默认背景', exact: true }).click();
  assert.equal(await page.locator('.home-layout').getAttribute('data-background'), 'preset');
  assert.match(
    await page
      .locator('.home-layout > .home-wallpaper')
      .evaluate((node) => getComputedStyle(node).backgroundImage),
    /default-wallpaper\.png/u,
  );
  results['restoreDefaultBackground'] = true;
  // 用真实浏览器编码两种视频，无需安装 ffmpeg。长视频必须被 Rust 导入层拒绝。
  for (const [name, mime, milliseconds] of [
    ['short.mp4', 'video/mp4;codecs=avc1.42001E', 1800],
    ['short.webm', 'video/webm;codecs=vp8', 1800],
    ['long.webm', 'video/webm;codecs=vp8', 16_200],
  ] as const) {
    const data = await page.evaluate(
      async ({ mime, milliseconds }) => {
        if (!MediaRecorder.isTypeSupported(mime)) throw new Error(`编码器不可用：${mime}`);
        const canvas = document.createElement('canvas');
        canvas.width = 320;
        canvas.height = 180;
        const drawing = canvas.getContext('2d');
        if (!drawing) throw new Error('画布不可用');
        const stream = canvas.captureStream(10);
        const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 100_000 });
        const parts: Blob[] = [];
        const timer = setInterval(() => {
          drawing.fillStyle = `hsl(${performance.now() % 360} 60% 70%)`;
          drawing.fillRect(0, 0, 320, 180);
        }, 100);
        try {
          recorder.ondataavailable = (event) => {
            if (event.data.size) parts.push(event.data);
          };
          const stopped = new Promise<void>((resolve, reject) => {
            recorder.onstop = () => resolve();
            recorder.onerror = () => reject(new Error('编码失败'));
          });
          recorder.start();
          await new Promise((resolve) => setTimeout(resolve, milliseconds));
          recorder.stop();
          await stopped;
          const bytes = new Uint8Array(await new Blob(parts).arrayBuffer());
          return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));
        } finally {
          clearInterval(timer);
          stream.getTracks().forEach((track) => track.stop());
        }
      },
      { mime, milliseconds },
    );
    await writeFile(resolve(root, name), Buffer.from(data, 'base64'));
    results[name] = (await readFile(resolve(root, name))).length;
  }
  // 使用开发服务器已经加载的同一份 React，挂载真实背景组件，验证实际解码与循环。
  await page.evaluate(async () => {
    const resources = performance.getEntriesByType('resource').map((entry) => entry.name);
    const reactUrl = resources.find((url) => /\/react\.js\?/u.test(url));
    const domUrl = resources.find((url) => /\/react-dom_client\.js\?/u.test(url));
    if (!reactUrl || !domUrl) throw new Error('找不到当前页面的 React 运行时');
    const { default: react } = (await import(reactUrl)) as { default: typeof React };
    const { default: dom } = (await import(domUrl)) as {
      default: typeof ReactDom;
    };
    const componentUrl = '/src/features/settings/BackgroundVideo.tsx';
    const { BackgroundVideo } = (await import(componentUrl)) as {
      BackgroundVideo: React.ComponentType<{ url: string; reduce: boolean }>;
    };
    for (const name of ['short.mp4', 'short.webm', 'long.webm']) {
      const host = document.createElement('div');
      host.dataset['wallpaperTest'] = name;
      document.body.append(host);
      dom.createRoot(host).render(
        react.createElement(BackgroundVideo, {
          url: `/.cache/verification/wallpaper-media/${name}`,
          reduce: false,
        }),
      );
    }
  });
  for (const name of ['short.mp4', 'short.webm']) {
    const selector = `[data-wallpaper-test="${name}"] video`;
    await page.waitForFunction((selector) => {
      const video = document.querySelector(selector);
      return video instanceof HTMLVideoElement && video.currentTime > 0.3 && !video.paused;
    }, selector);
    const video = page.locator(selector);
    const playback = await video.evaluate((node) => {
      if (!(node instanceof HTMLVideoElement)) throw new Error('不是视频元素');
      const value = { duration: node.duration, muted: node.muted, loop: node.loop };
      node.currentTime = node.duration - 0.1;
      return value;
    });
    assert.ok(playback.duration > 0 && playback.duration <= 15 && playback.muted && playback.loop);
    await page.waitForFunction((selector) => {
      const video = document.querySelector(selector);
      return video instanceof HTMLVideoElement && video.currentTime < 0.5 && !video.paused;
    }, selector);
    results[`playback:${name}`] = playback;
  }
  await page.locator('[data-wallpaper-test="long.webm"]').getByRole('alert').waitFor();
  assert.equal(await page.locator('[data-wallpaper-test="long.webm"] video').count(), 0);
  results['longVideoBlockedBeforePlayback'] = true;
  await writeFile(resolve(root, 'browser-result.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally {
  await context.close();
}
