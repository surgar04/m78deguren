import './check-environment.ts';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { chromium } from 'playwright-core';
import { setupStatusSchema } from '../src/lib/onboarding-contracts.ts';
import { footprintSchema } from '../src/lib/settings-contracts.ts';

// 只使用 dev.ps1 desktop:first-run:dev 创建的全新档案；不执行安装、分区或账号切换。
process.env.NO_PROXY = '127.0.0.1,localhost';
process.env.no_proxy = process.env.NO_PROXY;
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
try {
  const page = browser
    .contexts()[0]
    ?.pages()
    .find((page) => page.url().includes('#/setup'));
  assert.ok(page, '主窗口必须从原生入口直接打开首次启动页面');
  const invoke = (command: string, request: Record<string, unknown>) =>
    page.evaluate(
      async ({ command, request }) => {
        const bridge = window as unknown as {
          __TAURI_INTERNALS__: {
            invoke: (name: string, args: Record<string, unknown>) => Promise<unknown>;
          };
        };
        return bridge.__TAURI_INTERNALS__.invoke(command, { request });
      },
      { command, request },
    );
  const footprint = footprintSchema.parse(
    await invoke('settings_execute', { operation: 'footprint' }),
  );
  assert.ok(
    resolve(footprint.dataRoot).startsWith(resolve('.cache/verification') + sep + 'first-run-'),
  );
  const initial = setupStatusSchema.parse(
    await invoke('onboarding_execute', { operation: 'status' }),
  );
  assert.equal(initial.progress.complete, false);
  assert.equal(initial.progress.stage, 'storage');
  assert.equal(initial.restrictedMode, true);
  const output = resolve('.cache/verification/onboarding-desktop');
  await mkdir(output, { recursive: true });
  await page.locator('.setup-card').waitFor();
  assert.equal(await page.locator('.dock').count(), 0);
  await page.goto(page.url().split('#')[0] + '#/');
  await page.waitForURL(/#\/setup$/u);
  await page.screenshot({ path: resolve(output, 'storage.png') });
  const originalViewport = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  await page.setViewportSize({ width: 840, height: 640 });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
    '小窗口不应产生横向溢出',
  );
  await page.screenshot({ path: resolve(output, 'storage-compact.png') });
  await page.setViewportSize(originalViewport);
  for (const request of [
    { operation: 'advance', step: 'steam' },
    { operation: 'driver-apply', id: '56c15f2e-a3e1-4602-bffa-9a183b8115da', consent: true },
    {
      operation: 'steam-install',
      token: '56c15f2e-a3e1-4602-bffa-9a183b8115da',
      drive: 'D',
      consent: true,
    },
    { operation: 'storage', script: 'unexpected' },
    { operation: 'migration-prepare', drive: 'D' },
    {
      operation: 'partition-apply',
      token: '56c15f2e-a3e1-4602-bffa-9a183b8115da',
      confirmation: '创建 D 盘',
      backupConfirmed: true,
      consent: true,
    },
  ])
    await assert.rejects(invoke('onboarding_execute', request), '受限/非法操作不应执行');
  const next = async (expected: string) => {
    await page.getByRole('button', { name: '保留当前状态，下一步 →' }).click();
    await page.waitForFunction(
      (expected) => document.querySelector('.setup-heading h2')?.textContent === expected,
      expected,
    );
  };
  await next('应用位置');
  await next('硬件档案');
  await page.locator('.setup-device-list li').first().waitFor({ timeout: 60000 });
  const hardware = JSON.parse(
    await readFile(resolve(footprint.dataRoot, 'onboarding/hardware.json'), 'utf8'),
  ) as unknown;
  assert.ok(Array.isArray(hardware) && hardware.length > 0, '真实硬件档案未保存');
  await page.screenshot({ path: resolve(output, 'hardware.png') });
  await next('显卡驱动');
  await page.getByText('当前为受限验收模式，仅检测硬件，不执行在线驱动扫描或安装。').waitFor();
  await next('游戏运行库');
  await page.locator('.setup-runtime-list li').first().waitFor({ timeout: 45000 });
  await next('Steam 游戏库');
  await page.getByRole('button', { name: '重新搜索并保存游戏库' }).waitFor({ timeout: 45000 });
  await next('背景外观');
  const image = page.locator('.setup-appearance-preview img');
  await image.waitFor();
  assert.equal(
    await image.evaluate(
      (node) => node instanceof HTMLImageElement && node.complete && node.naturalWidth > 0,
    ),
    true,
    '默认壁纸未正常载入',
  );
  await page.screenshot({ path: resolve(output, 'appearance.png') });
  await next('本机身份');
  await page.getByLabel('暂不使用 Steam 身份，以本机用户继续').check();
  await page.getByRole('button', { name: '保存身份并完成准备' }).click();
  await page.getByRole('heading', { name: '欢迎来到臻境。' }).waitFor();
  await page.getByRole('button', { name: '进入工作空间' }).click();
  await page.locator('.dock').waitFor();
  await page.reload();
  await page.locator('.dock').waitFor();
  const result = setupStatusSchema.parse(
    await invoke('onboarding_execute', { operation: 'status' }),
  );
  assert.equal(result.progress.complete, true);
  assert.equal(result.progress.identity, null);
  assert.equal(await page.locator('.avatar-button img').count(), 0);
  await writeFile(
    resolve(output, 'result.json'),
    JSON.stringify(
      {
        passed: true,
        firstScreenWasSetup: true,
        deepLinkGuard: true,
        hardwareStored: true,
        restrictedMutationsRejected: true,
        compactViewport: true,
        guestIdentity: true,
        completedSurvivesReload: true,
        systemChangesExecuted: false,
      },
      null,
      2,
    ),
  );
  console.log(
    '首次启动真实桌面、进度、硬件档案、Steam 检测、默认背景和中性头像验证通过；未执行系统修改。',
  );
} finally {
  await browser.close();
}
