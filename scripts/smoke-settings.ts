import { verifyHud } from './hud-native-smoke.ts';
import './check-environment.ts';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { z } from 'zod';
import * as settings from '../src/lib/settings-contracts.ts';

// 只对独立 D 盘验收档案修改应用偏好；禁止运行 UAC、驱动、输入、颜色、注册表与真实重置。
const safeOperations = new Set([
  'snapshot',
  'runtime',
  'patch',
  'footprint',
  'network-sites',
  'network-test',
  'pawn-status',
  'reset-prepare',
  'reset-backups',
  'update-check',
  'update-status',
  'hotkey-capture-start',
  'hotkey-capture-end',
  'island-status',
  'boot-ready',
  'restore-main',
]);
process.env['NO_PROXY'] = '127.0.0.1,localhost';
process.env['no_proxy'] = '127.0.0.1,localhost';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
const output = resolve('.cache/verification/settings-desktop');
await mkdir(output, { recursive: true });
const results: Record<string, unknown> = {};
const errors: string[] = [];
try {
  const context = browser.contexts()[0];
  const page = context?.pages().find((page) => !page.url().includes('#/hud'));
  if (!context || !page) throw new Error('未找到独立桌面验证窗口');
  page.setDefaultTimeout(60_000);
  page.on('pageerror', (error) => errors.push(error.message));
  const read = async <T>(request: settings.SettingsRequest, schema: z.ZodType<T>) => {
    settings.settingsRequestSchema.parse(request);
    if (!safeOperations.has(request.operation)) throw new Error('验收禁止此系统修改');
    const value: unknown = await page.evaluate(
      `window.__TAURI_INTERNALS__.invoke('settings_execute',{request:${JSON.stringify(request)}})`,
    );
    return schema.parse(value);
  };
  await page.goto(new URL('/#/settings', page.url()).href);
  await page.reload();
  await page.getByRole('heading', { name: '外观与体验', exact: true }).waitFor();
  const snapshot = await read({ operation: 'snapshot' }, settings.settingsSnapshotSchema);
  assert.match(snapshot.dataRoot, /^D:\\新境\\\.cache\\verification\\settings-app-data$/iu);
  assert.equal(snapshot.version, '0.2.0');
  assert.ok(snapshot.assets.some((asset) => asset.kind === 'image'));
  assert.ok(snapshot.assets.some((asset) => asset.kind === 'font'));
  results['snapshot'] = snapshot;
  const runtime = await read({ operation: 'runtime' }, settings.runtimeSettingsSchema);
  assert.equal(runtime.hotkeys.length, 7);
  assert.ok(
    runtime.hotkeys.every((row) => row.registered || Boolean(row.error)),
    '系统占用必须明确报告，不能假装注册成功',
  );
  results['runtime'] = runtime;
  // 本机可能已有第三方软件占用默认热键；该冲突不能阻塞无关的原生偏好。
  await read(
    { operation: 'patch', patch: { kind: 'minimized-start', value: true } },
    settings.nativeSettingsSchema,
  );
  await read(
    {
      operation: 'patch',
      patch: { kind: 'minimized-start', value: snapshot.config.minimizedStart },
    },
    settings.nativeSettingsSchema,
  );
  const image = snapshot.assets.find((asset) => asset.kind === 'image');
  const font = snapshot.assets.find((asset) => asset.kind === 'font');
  assert.ok(image);
  assert.ok(font);
  const imageWidth = await page.evaluate(async (id) => {
    const image = new Image();
    const loaded = new Promise<number>((resolve, reject) => {
      image.onload = () => resolve(image.naturalWidth);
      image.onerror = () => reject(new Error('素材图片加载失败'));
    });
    image.src = `http://zhenjing-asset.localhost/${id}`;
    return loaded;
  }, image.id);
  assert.ok(imageWidth > 180);
  const customFont = await page.evaluate(async (id) => {
    const face = new FontFace(
      'SettingsProtocolTest',
      `url("http://zhenjing-asset.localhost/${id}")`,
    );
    await face.load();
    return face.status;
  }, font.id);
  assert.equal(customFont, 'loaded');
  results['protocol'] = { imageWidth, font: customFont };
  const video = snapshot.assets.find((asset) => asset.kind === 'video');
  if (video) {
    results['video'] = await page.evaluate(async (id) => {
      const video = document.createElement('video');
      video.muted = true;
      const loaded = new Promise<number>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('视频元数据超时')), 10_000);
        video.onloadedmetadata = () => {
          clearTimeout(timeout);
          resolve(video.videoWidth);
        };
        video.onerror = () => {
          clearTimeout(timeout);
          reject(new Error('真实 WebM 解码失败'));
        };
      });
      video.src = `http://zhenjing-asset.localhost/${id}`;
      video.preload = 'metadata';
      try {
        return await loaded;
      } finally {
        video.pause();
        video.removeAttribute('src');
        video.load();
      }
    }, video.id);
    assert.ok(Number(results['video']) > 0);
  }
  const preview = await read({ operation: 'reset-prepare' }, settings.maintenancePreviewSchema);
  assert.match(preview.backupRoot, /^[dD]:/u);
  assert.equal(preview.restore, false);
  results['resetPreview'] = preview;
  results['footprint'] = await read({ operation: 'footprint' }, settings.footprintSchema);
  results['pawn'] = await read({ operation: 'pawn-status' }, settings.pawnStatusSchema);
  const sites = await read({ operation: 'network-sites' }, z.array(settings.serverSchema));
  assert.equal(sites.length, 10);
  results['latency'] = await read(
    { operation: 'network-test', ids: [sites[0]?.id ?? 'missing'] },
    z.array(settings.latencySchema),
  );
  // 所有栏目必须可达，且界面不出现旧的演示标签。
  for (const name of ['外观与体验', '通用偏好', '快捷键', '高级', '网络', '关于臻境']) {
    await page.getByRole('tab', { name, exact: true }).click();
    await page.getByRole('heading', { name, exact: true }).waitFor();
  }
  assert.equal(await page.getByText('演示内容', { exact: true }).count(), 0);
  await page.getByRole('tab', { name: '通用偏好', exact: true }).click();
  await page.getByRole('textbox', { name: '首页用户名', exact: true }).fill('设置验收');
  await page.getByRole('combobox', { name: '导航布局', exact: true }).selectOption('top');
  await page.waitForFunction(
    () => document.querySelector('.home-layout')?.getAttribute('data-nav') === 'top',
  );
  await page.reload();
  await page.getByRole('tab', { name: '通用偏好', exact: true }).click();
  assert.equal(
    await page.getByRole('textbox', { name: '首页用户名', exact: true }).inputValue(),
    '设置验收',
  );
  await page.getByRole('combobox', { name: '导航布局', exact: true }).selectOption('side');
  for (const [code, label] of [
    ['en', 'General'],
    ['ja', '一般'],
    ['de', 'Allgemein'],
    ['fr', 'Général'],
    ['zh-TW', '一般偏好'],
    ['zh-CN', '通用偏好'],
  ]) {
    await page
      .locator('.setting-row select')
      .filter({ has: page.locator('option[value="zh-CN"]') })
      .selectOption(code ?? 'zh-CN');
    await page.getByRole('tab', { name: label ?? '通用偏好', exact: true }).waitFor();
  }
  await page.getByRole('tab', { name: '外观与体验', exact: true }).click();
  await page.getByRole('combobox', { name: '主题', exact: true }).selectOption('dark');
  await page.waitForFunction(
    () => document.querySelector('.home-layout')?.getAttribute('data-theme') === 'dark',
  );
  await page.screenshot({ path: resolve(output, 'appearance-dark.png'), fullPage: true });
  await page.getByRole('combobox', { name: '主题', exact: true }).selectOption('light');
  // 录制只发送未注册的新组合键，不触发实际工具或输入动作。
  await page.getByRole('tab', { name: '快捷键', exact: true }).click();
  await page.getByRole('button', { name: '录制快捷键 准心', exact: true }).click();
  await page.waitForFunction(
    "window.__TAURI_INTERNALS__.invoke('settings_execute',{request:{operation:'runtime'}}).then(state=>state.captureActive===true)",
  );
  await page.keyboard.press('Control+Alt+F10');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.locator('.settings-review').waitFor({ state: 'detached' });
  const after = await read({ operation: 'snapshot' }, settings.settingsSnapshotSchema);
  assert.equal(
    after.config.bindings.find((row) => row.action === 'crosshair')?.shortcut,
    'Ctrl+Alt+F10',
  );
  const registered = await read({ operation: 'runtime' }, settings.runtimeSettingsSchema);
  assert.ok(registered.hotkeys.find((row) => row.action === 'crosshair')?.registered);
  await read(
    {
      operation: 'patch',
      patch: { kind: 'server-add', name: '自定义测试', url: 'https://example.com/' },
    },
    settings.nativeSettingsSchema,
  );
  const custom = (await read({ operation: 'network-sites' }, z.array(settings.serverSchema))).find(
    (row) => row.custom,
  );
  assert.ok(custom);
  await read(
    { operation: 'patch', patch: { kind: 'server-remove', id: custom.id } },
    settings.nativeSettingsSchema,
  );
  results['hud'] = await verifyHud(page, context, output);
  await read(
    { operation: 'patch', patch: { kind: 'close-behavior', value: 'tray' } },
    settings.nativeSettingsSchema,
  );
  await page.getByRole('button', { name: '关闭窗口', exact: true }).click();
  await page.waitForTimeout(300);
  await read({ operation: 'restore-main' }, z.null());
  await read(
    { operation: 'patch', patch: { kind: 'close-behavior', value: 'exit' } },
    settings.nativeSettingsSchema,
  );
  try {
    results['update'] = await read({ operation: 'update-check' }, settings.updateStatusSchema);
  } catch (error) {
    results['updateError'] = error instanceof Error ? error.message : String(error);
    results['update'] = await read({ operation: 'update-status' }, settings.updateStatusSchema);
  }
  for (const name of ['外观与体验', '通用偏好', '快捷键', '高级', '网络', '关于臻境']) {
    await page.getByRole('tab', { name, exact: true }).click();
    await page.evaluate(() => {
      scrollTo(0, 0);
      document.querySelector<HTMLElement>('#main-content')?.focus({ preventScroll: true });
    });
    await page.screenshot({ path: resolve(output, `${name}.png`) });
  }
  for (const size of [
    { width: 760, height: 560 },
    { width: 960, height: 640 },
    { width: 1200, height: 800 },
  ]) {
    await page.setViewportSize(size);
    await page.getByRole('tab', { name: '外观与体验', exact: true }).click();
    const metrics = await page.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
    }));
    assert.ok(metrics.scrollWidth <= metrics.width);
    assert.ok(metrics.scrollHeight <= metrics.height + 3);
    await page.screenshot({ path: resolve(output, `viewport-${size.width}.png`) });
  }
  results['errors'] = errors;
  assert.deepEqual(errors, []);
  results['systemMutationsExecuted'] = false;
  await writeFile(resolve(output, 'result.json'), JSON.stringify(results, null, 2));
  console.log('设置真实 IPC、六栏目、六语言、热键录制、持久化和桌面岛验证通过。');
} finally {
  await browser.close();
}
