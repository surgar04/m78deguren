import { verifyHud } from './hud-native-smoke.ts';
import './check-environment.ts';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { z } from 'zod';
import * as builtin from '../src/lib/builtin-contracts.ts';
import {
  catalogSchema,
  crosshairSnapshotSchema,
  displaysSchema,
  screenConfigSchema,
  recordingsSchema,
  downloadsSchema,
  runtimesSchema,
  crashesSchema,
  externalSchema,
  speedSchema,
  runtimeJobSchema,
  ntpServersSchema,
  type ToolRequest,
} from '../src/lib/tool-contracts.ts';

// 只连接本项目显式启动的D盘WebView，不安装浏览器、不执行运行库安装或修改系统时间。
process.env['NO_PROXY'] = '127.0.0.1,localhost';
process.env['no_proxy'] = '127.0.0.1,localhost';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
const evidence = resolve(import.meta.dirname, '../.cache/verification/tools-desktop');
await mkdir(evidence, { recursive: true });
const results: Record<string, unknown> = {};
let cleanup: (() => Promise<void>) | undefined;
try {
  const context = browser.contexts()[0];
  const page = context?.pages()[0];
  if (!page || !context) throw new Error('桌面测试窗口未启动');
  cleanup = async () => {
    if (page.isClosed()) return;
    for (const operation of ['screen-close', 'speed-stop']) {
      await page
        .evaluate(
          `window.__TAURI_INTERNALS__.invoke('tools_execute',{request:{operation:${JSON.stringify(operation)}}})`,
        )
        .catch(() => undefined);
    }
  };
  const errors: string[] = [];
  page.on('pageerror', (cause) => errors.push(cause.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(new URL('/#/tools', page.url()).href);
  await page.getByRole('heading', { name: '工具箱', exact: true }).waitFor();
  // 真实生成短视频写入测试目录，再交由Rust扫描和自定义媒体协议读取；不伪造扫描回执。
  const video: unknown = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 180;
    const drawing = canvas.getContext('2d');
    if (!drawing) throw new Error('无法生成视频测试画布');
    const stream = canvas.captureStream(12);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (event) => chunks.push(event.data);
    const ready = new Promise<string>((resolve, reject) => {
      recorder.onerror = () => reject(new Error('测试视频录制失败'));
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const reader = new FileReader();
        reader.onload = () =>
          typeof reader.result === 'string'
            ? resolve(reader.result)
            : reject(new Error('视频读取失败'));
        reader.readAsDataURL(new Blob(chunks, { type: 'video/webm' }));
      };
    });
    let frame = 0;
    const tick = setInterval(() => {
      drawing.fillStyle = frame++ % 2 ? '#4fdbc1' : '#6587cc';
      drawing.fillRect(0, 0, 320, 180);
    }, 60);
    recorder.start();
    await new Promise((resolve) => setTimeout(resolve, 1200));
    clearInterval(tick);
    recorder.stop();
    return ready;
  });
  const encodedVideo = z.string().max(8_000_000).parse(video).split(',')[1];
  if (!encodedVideo) throw new Error('没有生成真实视频内容');
  await writeFile(
    resolve(evidence, '../tools-video-library/验收视频.webm'),
    Buffer.from(encodedVideo, 'base64'),
  );
  // evaluate中的JSON来自本脚本的静态请求，不含用户代码；返回值始终先作为unknown经过Zod。
  const call = async <T>(request: ToolRequest, schema: z.ZodType<T>) => {
    const value: unknown = await page.evaluate(
      `window.__TAURI_INTERNALS__.invoke('tools_execute', {request:${JSON.stringify(request)}})`,
    );
    return schema.parse(value);
  };
  const catalog = await call({ operation: 'catalog' }, catalogSchema);
  assert.equal(catalog.tools.length, 23);
  assert.equal(new Set(catalog.tools.map((tool) => tool.id)).size, 23);
  assert.equal(catalog.source, 'native');
  results['catalog'] = catalog;
  results['displays'] = await call({ operation: 'displays' }, displaysSchema);
  results['recordings'] = await call({ operation: 'recording-scan' }, recordingsSchema);
  results['downloads'] = await call({ operation: 'downloads-list' }, downloadsSchema);
  results['runtimes'] = await call({ operation: 'runtime-detect' }, runtimesSchema);
  results['crashes'] = await call({ operation: 'crash-scan' }, crashesSchema);
  results['external'] = await call({ operation: 'external-catalog' }, externalSchema);
  results['ntpServers'] = await call({ operation: 'ntp-servers' }, ntpServersSchema);
  const callBuiltin = async <T>(request: builtin.BuiltinRequest, schema: z.ZodType<T>) =>
    schema.parse(
      await page.evaluate(
        `window.__TAURI_INTERNALS__.invoke('builtin_execute',{request:${JSON.stringify(request)}})`,
      ),
    );
  const nativeChecks: [builtin.BuiltinRequest, z.ZodType][] = [
    [{ operation: 'query', tool: 'apps' }, builtin.appsSnapshotSchema],
    [{ operation: 'query', tool: 'gpus' }, builtin.gpuSnapshotSchema],
    [{ operation: 'query', tool: 'virtualization' }, builtin.virtualizationSnapshotSchema],
    [{ operation: 'query', tool: 'disks' }, builtin.disksSnapshotSchema],
    [{ operation: 'query', tool: 'context' }, builtin.contextSnapshotSchema],
    [{ operation: 'query', tool: 'vac' }, builtin.vacSnapshotSchema],
    [{ operation: 'query', tool: 'displays' }, builtin.displaySnapshotSchema],
    [{ operation: 'query', tool: 'features-runtime' }, builtin.featuresSnapshotSchema],
    [{ operation: 'query', tool: 'features-boot' }, builtin.featuresSnapshotSchema],
    [{ operation: 'query', tool: 'nvidia' }, builtin.nvidiaSnapshotSchema],
    [{ operation: 'audio-status' }, builtin.audioSnapshotSchema],
    [{ operation: 'filter-status' }, builtin.filterSnapshotSchema],
    [{ operation: 'display-history' }, builtin.displayHistorySchema],
  ];
  for (const [request, schema] of nativeChecks) {
    const key = request.operation === 'query' ? request.tool : request.operation;
    results[key] = await callBuiltin(request, schema);
    console.log(`${key}：真实 IPC 校验通过`);
  }
  const prepared = await callBuiltin(
    { operation: 'change-prepare', change: { kind: 'virtualization', enabled: false } },
    builtin.changePreviewSchema,
  );
  assert.ok(prepared.token);
  results['changePreview'] = prepared;
  results['hud'] = await verifyHud(page, context, evidence);
  // 仅检查确认入口；绝不执行 change-apply、点击注入、显示切换、滤镜、音频捕获或驱动安装。
  // 逐个打开真实工具，确保组件/样式加载后不存在脚本或CSP错误。
  for (const entry of [...catalog.tools, catalog.external]) {
    await page.getByRole('button', { name: `查看${entry.name}详情`, exact: true }).click();
    const dialog = page.getByRole('region', { name: `${entry.name}工具界面`, exact: true });
    await dialog.waitFor();
    await dialog.locator('.native-tool-panel, [role="alert"]').first().waitFor({ timeout: 90000 });
    await dialog
      .locator('.native-tool-feedback[role="status"]')
      .filter({ hasText: '正在处理，请稍候…' })
      .first()
      .waitFor({ state: 'hidden', timeout: 90000 });
    const pageErrors = await dialog.locator('[role="alert"]').allTextContents();
    results[`page:${entry.id}`] = { errors: pageErrors };
    if (entry.id !== 'dlss-preset')
      assert.deepEqual(pageErrors, [], `${entry.name} 出现未处理的界面错误`);
    console.log(`${entry.name}：页面检查完成`);
    if (entry.id === 'recordings') {
      await dialog.locator('.native-video-thumbnail img').waitFor({ timeout: 20000 });
      results['videoThumbnail'] = { decoded: true };
    }
    await page.screenshot({ path: resolve(evidence, `${entry.id}.png`) });
    await dialog.getByRole('button', { name: '返回工具箱', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
  }
  const original = await call({ operation: 'crosshair-status' }, crosshairSnapshotSchema);
  try {
    const enabled = await call(
      { operation: 'crosshair-update', config: original.config, enabled: true },
      crosshairSnapshotSchema,
    );
    assert.equal(enabled.enabled, true);
    let overlay = browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((item) => item.url().includes('tool-overlay'));
    for (let attempt = 0; !overlay && attempt < 60; attempt++) {
      await page.waitForTimeout(500);
      overlay = browser
        .contexts()
        .flatMap((context) => context.pages())
        .find((item) => item.url().includes('tool-overlay'));
    }
    if (!overlay) throw new Error('没有发现实际透明准心窗口');
    await overlay.locator('.crosshair-overlay canvas').waitFor();
    const size = await overlay.locator('canvas').evaluate((canvas) => {
      if (!(canvas instanceof HTMLCanvasElement)) throw new Error('准心画布类型错误');
      return { width: canvas.width, height: canvas.height };
    });
    assert.ok(size.width > 0 && size.height > 0);
    results['overlay'] = { created: true, canvas: size };
  } finally {
    await call(
      { operation: 'crosshair-update', config: original.config, enabled: false },
      crosshairSnapshotSchema,
    );
  }
  const screen = await call({ operation: 'screen-status' }, screenConfigSchema);
  await call({ operation: 'screen-open', config: { ...screen, pattern: 'geometry' } }, z.null());
  let screenPage = browser
    .contexts()
    .flatMap((context) => context.pages())
    .find((item) => item.url().includes('screen-test'));
  for (let attempt = 0; !screenPage && attempt < 60; attempt++) {
    await page.waitForTimeout(500);
    screenPage = browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((item) => item.url().includes('screen-test'));
  }
  if (!screenPage) throw new Error('没有发现实际全屏测试窗口');
  await screenPage.getByLabel('全屏显示测试图样').waitFor();
  await screenPage.screenshot({ path: resolve(evidence, 'screen-fullscreen.png') });
  await screenPage.keyboard.press('Escape');
  await screenPage
    .waitForEvent('close', { timeout: 5000 })
    .catch(() => assert.ok(screenPage.isClosed()));
  results['screen'] = { created: true, escapeClosed: true };
  await call({ operation: 'runtime-prepare', id: 'vc-2013-x64' }, z.null());
  for (let attempt = 0; attempt < 180; attempt++) {
    const job = await call({ operation: 'runtime-status' }, runtimeJobSchema);
    if (job.phase === 'ready' || job.phase === 'failed') {
      results['runtimePrepared'] = job;
      assert.equal(job.phase, 'ready', job.message);
      assert.ok(job.sha256 && job.publisher && job.token);
      break;
    }
    if (attempt === 179) throw new Error('运行库签名准备超时');
    await page.waitForTimeout(500);
  }
  await page.getByRole('button', { name: '查看运行库修复详情', exact: true }).click();
  const runtimeDialog = page.getByRole('region', { name: '运行库修复工具界面', exact: true });
  const installButton = runtimeDialog.getByRole('button', { name: '确认并请求管理员安装' });
  await installButton.waitFor();
  assert.equal(await installButton.isEnabled(), false, '逐项确认前不能执行安装');
  const consent = runtimeDialog.getByRole('checkbox');
  await consent.check();
  assert.equal(await installButton.isEnabled(), true);
  await consent.uncheck();
  await page.screenshot({ path: resolve(evidence, 'runtime-signed-confirmation.png') });
  await runtimeDialog.getByRole('button', { name: '返回工具箱', exact: true }).click();
  // 未点击安装确认，不触发UAC和系统写入。
  await call({ operation: 'speed-start' }, z.null());
  for (let attempt = 0; attempt < 160; attempt++) {
    const speed = await call({ operation: 'speed-status' }, speedSchema);
    if (!speed.running) {
      results['speedMeasurement'] = speed;
      assert.equal(speed.phase, 'complete', speed.message);
      break;
    }
    if (attempt === 159) throw new Error('真实测速未完成');
    await page.waitForTimeout(500);
  }
  await call({ operation: 'speed-start' }, z.null());
  await page.waitForTimeout(1500);
  await call({ operation: 'speed-stop' }, z.null());
  await page.waitForTimeout(500);
  results['speedStopped'] = await call({ operation: 'speed-status' }, speedSchema);
  assert.equal(z.object({ running: z.boolean() }).parse(results['speedStopped']).running, false);
  assert.equal(
    await page.locator('body').evaluate((element) => element.scrollWidth <= innerWidth),
    true,
  );
  assert.deepEqual(errors, [], '工具页面不应出现脚本或CSP错误');
  await page.screenshot({ path: resolve(evidence, 'tools.png') });
  await writeFile(
    resolve(evidence, 'results.json'),
    JSON.stringify({ passed: true, checkedAt: new Date().toISOString(), results, errors }, null, 2),
  );
  console.log(
    '原生工具WebView验收通过：23项内置工具及第三方入口、真实IPC、只读配置与确认预览、准心窗口、全屏测试、测速停止和CSP。',
  );
} finally {
  await cleanup?.();
  await browser.close();
}
