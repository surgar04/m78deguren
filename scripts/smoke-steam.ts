import './check-environment.ts';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import type { z } from 'zod';
import {
  steamSnapshotSchema,
  steamRequestSchema,
  type SteamRequest,
} from '../src/lib/steam-contracts.ts';
import { settingsSnapshotSchema } from '../src/lib/settings-contracts.ts';

// 仅读取真实 Steam：不启动客户端/游戏、不调用安装/卸载、不修改账号或注册表。
async function connect() {
  const started = Date.now();
  for (;;) {
    try {
      return await chromium.connectOverCDP('http://127.0.0.1:9223', { timeout: 5000 });
    } catch (cause) {
      if (Date.now() - started > 90000) throw cause;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}
const output = resolve('.cache/verification/steam-desktop');
await mkdir(output, { recursive: true });
const browser = await connect();
const errors: string[] = [];
try {
  const page = browser
    .contexts()[0]
    ?.pages()
    .find((page) => page.url().includes('tauri.localhost'));
  if (!page) throw new Error('未找到独立 Steam 验收窗口');
  page.setDefaultTimeout(120000);
  page.on('pageerror', (cause) => errors.push(cause.message));
  const native = async <T>(request: SteamRequest, schema: z.ZodType<T>) =>
    schema.parse(
      await page.evaluate(
        `window.__TAURI_INTERNALS__.invoke('steam_execute',{request:${JSON.stringify(steamRequestSchema.parse(request))}})`,
      ),
    );
  const settings = settingsSnapshotSchema.parse(
    await page.evaluate(
      "window.__TAURI_INTERNALS__.invoke('settings_execute',{request:{operation:'snapshot'}})",
    ),
  );
  assert.equal(
    resolve(settings.dataRoot),
    resolve('.cache/verification/steam-gui-data'),
    '拒绝在日常档案执行桌面验收',
  );
  await page.goto('http://tauri.localhost/#/library', { waitUntil: 'domcontentloaded' });
  // 同 URL 的 hash 导航不会重新挂载 React；显式刷新保证重复验收不继承上次搜索/筛选。
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: /^游戏库/u, level: 1 }).waitFor();
  const data = await native({ operation: 'snapshot', refresh: true }, steamSnapshotSchema);
  assert.ok(data.installed);
  assert.ok(data.games.length > 0);
  await page.locator('.steam-card').first().waitFor();
  assert.ok((await page.locator('.steam-card').count()) <= 24);
  if (data.games.length > 24) {
    await page.getByRole('button', { name: '下一页（24）', exact: true }).click();
    assert.equal(await page.locator('.steam-card').count(), Math.min(24, data.games.length - 24));
    await page.getByRole('button', { name: '上一页', exact: true }).click();
  }
  assert.equal(await page.getByText('演示数据', { exact: true }).count(), 0);
  const game = data.games[0];
  if (!game) throw new Error('需要本机至少一条游戏缓存进行验收');
  await page.getByRole('searchbox', { name: '搜索 Steam 游戏' }).fill(String(game.appId));
  await page.getByRole('article', { name: game.name, exact: true }).waitFor();
  await page.getByRole('button', { name: `查看${game.name}详情`, exact: true }).click();
  let dialog = page.getByRole('dialog').last();
  await dialog.getByRole('button', { name: '打开商店', exact: true }).waitFor();
  if (game.installed) {
    await dialog.getByRole('button', { name: '卸载游戏', exact: true }).click();
    dialog = page.getByRole('dialog').last();
    assert.ok(await dialog.getByRole('button', { name: '确认执行', exact: true }).isDisabled());
    await dialog.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  }
  await page
    .getByRole('dialog')
    .last()
    .getByRole('button', { name: '关闭弹窗', exact: true })
    .click();
  const installedGame = data.games.find((candidate) => candidate.installed);
  if (installedGame && installedGame.appId !== game.appId) {
    await page
      .getByRole('searchbox', { name: '搜索 Steam 游戏' })
      .fill(String(installedGame.appId));
    await page.getByRole('button', { name: `查看${installedGame.name}详情`, exact: true }).click();
    await page
      .getByRole('dialog')
      .last()
      .getByRole('button', { name: '卸载游戏', exact: true })
      .click();
    dialog = page.getByRole('dialog').last();
    assert.ok(await dialog.getByRole('button', { name: '确认执行', exact: true }).isDisabled());
    await dialog.getByRole('button', { name: '关闭弹窗', exact: true }).click();
    await page
      .getByRole('dialog')
      .last()
      .getByRole('button', { name: '关闭弹窗', exact: true })
      .click();
  }
  const uninstalledGame = data.games.find((candidate) => !candidate.installed);
  if (uninstalledGame) {
    await page
      .getByRole('searchbox', { name: '搜索 Steam 游戏' })
      .fill(String(uninstalledGame.appId));
    // 卡片操作在悬停/键盘聚焦后显示，按真实使用方式进入可操作状态。
    await page.getByRole('article', { name: uninstalledGame.name, exact: true }).hover();
    await page
      .getByRole('button', { name: `查看${uninstalledGame.name}详情`, exact: true })
      .focus();
    await page.getByRole('button', { name: `安装：${uninstalledGame.name}`, exact: true }).click();
    dialog = page.getByRole('dialog').last();
    assert.ok(await dialog.getByRole('button', { name: '确认执行', exact: true }).isDisabled());
    await dialog.getByRole('checkbox').check();
    assert.ok(await dialog.getByRole('button', { name: '确认执行', exact: true }).isEnabled());
    await dialog.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  }
  await page.getByRole('searchbox', { name: '搜索 Steam 游戏' }).fill('');
  await page.getByRole('combobox', { name: '游戏状态', exact: true }).selectOption('installed');
  assert.ok(
    (await page.locator('.steam-card').count()) <=
      data.games.filter((game) => game.installed).length,
  );
  await page.getByRole('combobox', { name: '游戏状态', exact: true }).selectOption('all');
  for (const viewport of [
    { width: 1200, height: 800 },
    { width: 760, height: 560 },
  ]) {
    await page.setViewportSize(viewport);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({
      path: resolve(output, `library-${viewport.width}.png`),
      mask: [page.locator('.steam-status span')],
    });
  }
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.getByRole('button', { name: '同步公开游戏库', exact: true }).click();
  dialog = page.getByRole('dialog').last();
  await dialog.getByRole('checkbox').check();
  await dialog.getByPlaceholder('公开入口需登录时，可使用自己的官方 API Key').fill('invalid');
  assert.ok(await dialog.getByRole('button', { name: '确认执行', exact: true }).isDisabled());
  await dialog.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await page
    .getByRole('navigation', { name: '游戏库栏目' })
    .getByRole('button', { name: /本机账号/u })
    .click();
  assert.equal(await page.locator('.steam-account').count(), data.accounts.length);
  if (data.accounts.length) {
    for (const name of ['切换账号', '移除本机记录']) {
      await page
        .locator('.steam-account')
        .first()
        .getByRole('button', { name, exact: true })
        .click();
      dialog = page.getByRole('dialog').last();
      assert.ok(await dialog.getByRole('button', { name: '确认执行', exact: true }).isDisabled());
      await dialog.getByRole('checkbox').check();
      assert.ok(await dialog.getByRole('button', { name: '确认执行', exact: true }).isEnabled());
      await dialog.getByRole('button', { name: '关闭弹窗', exact: true }).click();
    }
  }
  await page.getByRole('button', { name: '操作记录与恢复', exact: true }).click();
  await page.getByRole('dialog').getByText('尚无账号操作记录。', { exact: true }).waitFor();
  await page.getByRole('dialog').getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await page
    .getByRole('navigation', { name: '游戏库栏目' })
    .getByRole('button', { name: '存储空间', exact: true })
    .click();
  assert.equal(await page.locator('.steam-disk').count(), data.libraries.length);
  for (const viewport of [
    { width: 1200, height: 800 },
    { width: 760, height: 560 },
  ]) {
    await page.setViewportSize(viewport);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  const after = await native({ operation: 'snapshot', refresh: true }, steamSnapshotSchema);
  assert.equal(after.revision, data.revision, '验收不得修改真实 Steam 登录配置');
  assert.equal(after.running, data.running, '验收不得启动或停止真实 Steam');
  assert.deepEqual(errors, []);
  const result = {
    installed: data.installed,
    running: data.running,
    games: data.games.length,
    accounts: data.accounts.length,
    libraries: data.libraries.length,
    search: true,
    filters: true,
    detailActions: true,
    confirmationGates: true,
    storage: true,
    loginFileUnchanged: true,
    clientStateUnchanged: true,
    pageErrors: errors,
  };
  await writeFile(resolve(output, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await page.locator('.window-controls button').last().click();
} finally {
  await browser.close();
}
