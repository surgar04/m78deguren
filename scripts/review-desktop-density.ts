import './check-environment.ts';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

process.env['NO_PROXY'] = '127.0.0.1,localhost';
const evidence = resolve(import.meta.dirname, '../.cache/verification/desktop-density');
await mkdir(evidence, { recursive: true });
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
try {
  const page = browser
    .contexts()
    .flatMap((context) => context.pages())
    .find(
      (page) => !['screen-test', 'tool-overlay', 'hud'].some((name) => page.url().includes(name)),
    );
  if (!page) throw new Error('没有找到主窗口');
  // 关闭上一次验收留下的测试图样；仅操作应用自身窗口，不修改显示模式。
  await page.evaluate(
    `window.__TAURI_INTERNALS__.invoke('tools_execute',{request:{operation:'screen-close'}})`,
  );
  const errors: string[] = [];
  page.on('pageerror', (cause) => errors.push(cause.message));
  const results: Record<string, unknown> = {};
  for (const size of [
    { width: 1200, height: 800 },
    { width: 1024, height: 720 },
  ]) {
    await page.setViewportSize(size);
    for (const route of ['/tools', '/optimization', '/library', '/hardware', '/settings', '/']) {
      await page.goto(new URL(`/#${route}`, page.url()).href);
      await page.locator('.home-workspace').waitFor();
      if (route === '/tools') await page.locator('.tool-card').first().waitFor();
      if (route === '/optimization') await page.locator('.optimization-category').first().waitFor();
      await page.waitForTimeout(800);
      const name = route === '/' ? 'home' : route.slice(1);
      const layout = await page.evaluate(() => ({
        width: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        icons: [...document.querySelectorAll('.feature-icon')].map((element) => ({
          width: element.getBoundingClientRect().width,
          height: element.getBoundingClientRect().height,
        })),
        heading: document.querySelector('h1')?.getBoundingClientRect().height,
        recentBottom: document.querySelector('.recent-grid')?.getBoundingClientRect().bottom,
        posterBottom: document.querySelector('.recent-featured')?.getBoundingClientRect().bottom,
        libraryTop: document.querySelector('.library-section')?.getBoundingClientRect().top,
      }));
      assert.ok(layout.scrollWidth <= layout.width, `${name} 出现横向溢出`);
      for (const icon of layout.icons)
        assert.ok(icon.width <= 48 && icon.height <= 48, '功能卡图标过大');
      if (typeof layout.recentBottom === 'number' && typeof layout.posterBottom === 'number')
        assert.ok(layout.posterBottom <= layout.recentBottom + 1, '最近游戏封面撑破网格');
      if (typeof layout.posterBottom === 'number' && typeof layout.libraryTop === 'number')
        assert.ok(layout.libraryTop >= layout.posterBottom + 12, '最近游戏与全部游戏区域重叠');
      results[`${name}:${size.width}`] = layout;
      await page.screenshot({ path: resolve(evidence, `${name}-${size.width}.png`) });
    }
  }
  assert.deepEqual(errors, []);
  await writeFile(
    resolve(evidence, 'results.json'),
    JSON.stringify({ passed: true, checkedAt: new Date().toISOString(), results, errors }, null, 2),
  );
  console.log(
    '桌面密度验收通过：1200/1024 两种宽度，六个页面，无横向溢出，图标不超过48px，首页区域不重叠。',
  );
} finally {
  await browser.close();
}
