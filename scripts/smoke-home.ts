import './check-environment.ts';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import type { z } from 'zod';
import {
  homeRequestSchema,
  homeSnapshotSchema,
  type HomeRequest,
} from '../src/lib/home-contracts.ts';
import { settingsSnapshotSchema } from '../src/lib/settings-contracts.ts';

// 使用独立 D 盘档案；只读真实服务并检查确认门槛，不执行进程压制、Win 钩子或系统安装。
process.env['NO_PROXY'] = '127.0.0.1,localhost';
process.env['no_proxy'] = '127.0.0.1,localhost';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
const output = resolve('.cache/verification/home-desktop');
await mkdir(output, { recursive: true });
try {
  const page = browser
    .contexts()[0]
    ?.pages()
    .find(
      (page) => page.url().includes('tauri.localhost') || page.url().includes('127.0.0.1:1420'),
    );
  if (!page) throw new Error('没有找到首页验收窗口');
  page.setDefaultTimeout(45000);
  const errors: string[] = [];
  page.on('pageerror', (cause) => errors.push(cause.message));
  const native = async <T>(request: HomeRequest, schema: z.ZodType<T>) =>
    schema.parse(
      await page.evaluate(
        `window.__TAURI_INTERNALS__.invoke('home_execute',{request:${JSON.stringify(homeRequestSchema.parse(request))}})`,
      ),
    );
  const settings = settingsSnapshotSchema.parse(
    await page.evaluate(
      "window.__TAURI_INTERNALS__.invoke('settings_execute',{request:{operation:'snapshot'}})",
    ),
  );
  assert.equal(
    resolve(settings.dataRoot),
    resolve('.cache/verification/home-gui-data'),
    '禁止在日常数据目录验收',
  );
  assert.equal(
    settings.config.confirmActions,
    true,
    '验收前必须开启二次确认；不能在关闭确认时点击真实系统控制开关',
  );
  await page.goto(page.url().split('#')[0] + '#/');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: /快捷启动/u, level: 2 }).waitFor();
  // 启动 Logo 不阻塞后台 DOM 的挂载，必须等遮罩消失后再取得可审阅的页面截图。
  await page.locator('.settings-startup-logo').waitFor({ state: 'detached' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() =>
    [...document.querySelectorAll('[data-home-enter]')].every(
      (element) => Number(getComputedStyle(element).opacity) >= 0.99,
    ),
  );
  const before = await native({ operation: 'snapshot' }, homeSnapshotSchema);
  assert.ok(before.username.length > 0);
  assert.equal(before.policy.autoGameMode, false);
  assert.equal(before.policy.disableWinInGame, false);
  assert.equal(before.runtime.effective, false);
  // 此处故意绕过前端契约，只提交必定不可执行的请求，核实 Rust 再次拒绝输入。
  // 不发送有效启用请求，不以测试名义执行进程调整或键盘钩子。
  for (const request of [
    { operation: 'manual', enabled: true, consent: false },
    { operation: 'policy', key: 'disableWinInGame', enabled: true, consent: false },
    { operation: 'restore', consent: false },
    { operation: 'launch', id: 'D:/not-registered.exe', consent: true },
    { operation: 'launch', id: crypto.randomUUID(), consent: true, path: 'D:/not-registered.exe' },
    { operation: 'remove', id: crypto.randomUUID(), revision: before.revision, consent: false },
    { operation: 'reorder', ids: ['not-a-shortcut'], revision: before.revision },
    { operation: 'picture-wallpaper', id: '../../not-a-picture' },
    { operation: 'content', kind: 'arbitrary-url', refresh: false },
  ]) {
    let rejected = false;
    try {
      await page.evaluate(
        `window.__TAURI_INTERNALS__.invoke('home_execute',{request:${JSON.stringify(request)}})`,
      );
    } catch {
      rejected = true;
    }
    assert.ok(rejected, `Rust 未拒绝非法首页请求：${request.operation}`);
  }
  assert.equal(await page.getByRole('heading', { name: '最近玩过', exact: true }).count(), 0);
  assert.equal(await page.getByRole('heading', { name: '全部游戏', exact: true }).count(), 0);
  assert.equal(await page.getByText('演示内容', { exact: true }).count(), 0);
  for (const viewport of [
    { width: 1200, height: 800 },
    { width: 1920, height: 1080 },
    { width: 2560, height: 1440 },
    { width: 760, height: 560 },
  ]) {
    await page.setViewportSize(viewport);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if (viewport.width >= 1200)
      assert.ok(
        await page
          .locator('.home-workspace')
          .evaluate((element) => innerWidth - element.getBoundingClientRect().right < 45),
        '大窗口右侧不能残留固定宽度以外的大面积空白',
      );
    await page.screenshot({
      path: resolve(output, `home-${viewport.width}.png`),
      mask: [page.locator('.home-welcome h1')],
    });
  }
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.getByRole('button', { name: '添加程序', exact: true }).click();
  let dialog = page.getByRole('dialog');
  assert.ok(await dialog.getByRole('button', { name: '保存快捷启动', exact: true }).isDisabled());
  await dialog.getByRole('button', { name: '选择 EXE 程序', exact: true }).waitFor();
  await dialog.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await page.getByRole('button', { name: '使用文档', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('heading', { name: '臻境使用指南', exact: true }).waitFor();
  assert.match(await dialog.locator('.home-guide-text').innerText(), /选择本机 EXE/u);
  await dialog.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await page.getByRole('switch', { name: '游戏模式', exact: true }).click();
  dialog = page.getByRole('dialog');
  assert.ok(await dialog.getByRole('button', { name: '确认执行', exact: true }).isDisabled());
  await dialog.getByRole('checkbox').check();
  assert.ok(await dialog.getByRole('button', { name: '确认执行', exact: true }).isEnabled());
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  for (const name of ['游戏启动时自动启用', '游戏时禁用 Win 键']) {
    await dialog.getByRole('switch', { name, exact: true }).click();
    assert.ok(await dialog.getByRole('button', { name: '确认执行', exact: true }).isDisabled());
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
  }
  await dialog.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await page.getByRole('button', { name: '全局搜索，Ctrl K', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('heading', { name: '内置工具', exact: true }).waitFor();
  await dialog.getByRole('searchbox').fill('准心');
  await dialog.getByRole('button', { name: '辅助准心', exact: true }).waitFor();
  await dialog.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  const after = await native({ operation: 'snapshot' }, homeSnapshotSchema);
  assert.equal(after.revision, before.revision);
  assert.equal(after.runtime.effective, false);
  assert.equal(after.runtime.winKeyBlocked, false);
  assert.deepEqual(errors, []);
  const result = {
    usernameFromNative: true,
    shortcuts: after.shortcuts.length,
    mockLibraryRemoved: true,
    search: true,
    offlineGuide: true,
    confirmationGates: true,
    rustBoundaryRejections: 9,
    responsiveWidths: [1200, 1920, 2560, 760],
    configurationUnchanged: true,
    noSystemChanges: true,
    pageErrors: errors,
  };
  await writeFile(resolve(output, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
