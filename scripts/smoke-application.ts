import './check-environment.ts';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import {
  settingsSnapshotSchema,
  nativeSettingsSchema,
  updateStatusSchema,
} from '../src/lib/settings-contracts.ts';
import { homeSnapshotSchema } from '../src/lib/home-contracts.ts';

process.env['NO_PROXY'] = '127.0.0.1,localhost';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
const page = browser
  .contexts()[0]
  ?.pages()
  .find((p) => p.url().includes('127.0.0.1:1420') || p.url().includes('tauri.localhost'));
if (!page) throw new Error('未找到臻境验收窗口');
page.setDefaultTimeout(45000);
const base = page.url().split('#')[0];
const output = resolve('.cache/verification/zhenjing-desktop');
await mkdir(output, { recursive: true });
const invoke = (command: string, request: unknown) =>
  page.evaluate(
    `window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)},{request:${JSON.stringify(request)}}).catch(cause=>{throw new Error(typeof cause==='object'?JSON.stringify(cause):String(cause));})`,
  );
const before = settingsSnapshotSchema.parse(
  await invoke('settings_execute', { operation: 'snapshot' }),
);
assert.equal(resolve(before.dataRoot), resolve('.cache/verification/home-gui-data'));
const uiBefore = await page.evaluate(() => localStorage.getItem('zhenjing.settings.ui'));
try {
  assert.equal(await page.title(), '臻境');
  await page.goto(base + '#/');
  await page.getByRole('heading', { name: /快捷启动/u, level: 2 }).waitFor();
  await page.locator('.settings-startup-logo').waitFor({ state: 'detached' });
  assert.equal(await page.getByRole('button', { name: '项目交流', exact: true }).count(), 0);
  assert.match((await page.locator('.brand img').getAttribute('src')) ?? '', /brand\.svg/u);
  for (const size of [
    { width: 1200, height: 800 },
    { width: 1920, height: 1080 },
    { width: 2560, height: 1440 },
    { width: 760, height: 560 },
  ]) {
    await page.setViewportSize(size);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if (size.width >= 1200)
      assert.ok(
        await page
          .locator('.home-workspace')
          .evaluate((e) => innerWidth - e.getBoundingClientRect().right < 45),
      );
    await page.screenshot({
      path: resolve(output, `home-${size.width}.png`),
      mask: [page.locator('.home-welcome h1')],
      maskColor: '#e2f1ec',
    });
  }
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto(base + '#/settings?tab=general');
  await page.getByRole('switch', { name: '二次确认', exact: true }).waitFor();
  assert.equal(
    await page.getByRole('switch', { name: '二次确认', exact: true }).getAttribute('aria-checked'),
    String(before.config.confirmActions),
  );
  await page.getByRole('combobox', { name: '导航布局', exact: true }).selectOption('top');
  await page.locator('.home-layout[data-nav="top"]').waitFor();
  await page.setViewportSize({ width: 1920, height: 1080 });
  assert.ok(
    await page
      .locator('.home-workspace')
      .evaluate((e) => innerWidth - e.getBoundingClientRect().right < 45),
  );
  await page.getByRole('combobox', { name: '导航布局', exact: true }).selectOption('side');
  await page.locator('.home-layout[data-nav="side"]').waitFor();
  await page.goto(base + '#/settings?tab=about');
  await page.getByRole('heading', { name: '关于臻境', exact: true }).waitFor();
  const preferences = nativeSettingsSchema.parse(
    await invoke('settings_execute', {
      operation: 'patch',
      patch: { kind: 'confirm-actions', value: false },
    }),
  );
  assert.equal(preferences.confirmActions, false);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '关于臻境', exact: true }).waitFor();
  const persisted = settingsSnapshotSchema.parse(
    await invoke('settings_execute', { operation: 'snapshot' }),
  );
  assert.equal(persisted.config.confirmActions, false);
  await page.goto(base + '#/');
  await page.getByRole('heading', { name: /快捷启动/u, level: 2 }).waitFor();
  // 免确认点击仅在隔离单测验证。真实桌面先恢复确认，再检查弹窗，不能改写只读 IPC 接口。
  await invoke('settings_execute', {
    operation: 'patch',
    patch: { kind: 'confirm-actions', value: true },
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: /快捷启动/u, level: 2 }).waitFor();
  await page.locator('.settings-startup-logo').waitFor({ state: 'detached' });
  await page.getByRole('switch', { name: '游戏模式', exact: true }).click();
  assert.equal(await page.getByRole('dialog').count(), 1);
  assert.ok(
    await page
      .getByRole('dialog')
      .getByRole('button', { name: '确认执行', exact: true })
      .isDisabled(),
  );
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '关闭弹窗', exact: true }).click();
  const current = homeSnapshotSchema.parse(await invoke('home_execute', { operation: 'snapshot' }));
  assert.equal(current.runtime.effective, false);
  assert.equal(current.runtime.winKeyBlocked, false);
  const status = updateStatusSchema.parse(
    await invoke('settings_execute', { operation: 'update-status' }),
  );
  assert.equal(current.runtime.suppressedCount, 0);
  assert.equal(current.runtime.recoverableCount, 0);
  const evidence = {
    branding: '臻境',
    removedCommunity: true,
    widths: [1200, 1920, 2560, 760],
    fullWidth: true,
    navigationSwitch: true,
    aboutTabRouting: true,
    confirmationPersistence: true,
    confirmationRestored: true,
    directActionsVerifiedInIsolatedUnitTests: true,
    realUpdateStatus: {
      phase: status.phase,
      message: status.message,
      version: status.currentVersion,
    },
    finalSystemControlsOff: true,
  };
  await writeFile(resolve(output, 'result.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await invoke('settings_execute', {
    operation: 'patch',
    patch: { kind: 'confirm-actions', value: before.config.confirmActions },
  });
  await page.evaluate((value) => {
    if (value === null) localStorage.removeItem('zhenjing.settings.ui');
    else localStorage.setItem('zhenjing.settings.ui', value);
  }, uiBefore);
  await browser.close();
}
