import './check-environment.ts';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { verifyHud } from './hud-native-smoke.ts';
process.env['NO_PROXY'] = '127.0.0.1,localhost';
process.env['no_proxy'] = '127.0.0.1,localhost';
const output = resolve('.cache/verification/hud-desktop');
await mkdir(output, { recursive: true });
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
try {
  const context = browser.contexts()[0];
  const page = context
    ?.pages()
    .find(
      (p) =>
        !['#/hud', '#/sensor-monitor', '#/screen-test', '#/tool-overlay'].some((route) =>
          p.url().includes(route),
        ),
    );
  if (!context || !page) throw Error('隔离的桌面验证窗口未启动');
  const result = await verifyHud(page, context, output);
  await page.goto(page.url().split('#')[0] + '#/tools/overlay-panel');
  await page.getByRole('heading', { name: '一个 HUD，随场景而动。' }).waitFor();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: resolve(output, 'hud-settings.png') });
  await writeFile(
    resolve(output, 'result.json'),
    JSON.stringify({ passed: true, ...result }, null, 2),
  );
  console.log('HUD 真实窗口、共享读数、模式切换、缩放透明度和窗口权限验证通过。');
} finally {
  await browser.close();
}
