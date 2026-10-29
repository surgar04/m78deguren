import './check-environment.ts';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { z } from 'zod';
import {
  hardwareSnapshotSchema,
  hardwareRequestSchema,
  hardwareRemoteSchema,
  type HardwareRequest,
} from '../src/lib/hardware-contracts.ts';
import { settingsSnapshotSchema } from '../src/lib/settings-contracts.ts';

// 必须是独立 D 盘验收档案。只测试应用自有历史、报告、只读监控和临时渲染进程；不安装驱动、不更改系统设置。
const output = resolve('.cache/verification/hardware-desktop');
await mkdir(output, { recursive: true });
// 冷启动需先加载 WebView2；等待调试端点就绪，避免把启动时序误判成产品错误。
async function connectDesktop() {
  const started = Date.now();
  for (;;) {
    try {
      return await chromium.connectOverCDP('http://127.0.0.1:9223', { timeout: 5000 });
    } catch (cause) {
      if (Date.now() - started > 90_000) throw cause;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}
const browser = await connectDesktop();
const errors: string[] = [];
const results: Record<string, unknown> = {};
let renderer: ReturnType<typeof spawn> | null = null;
try {
  const page = browser
    .contexts()[0]
    ?.pages()
    .find((page) => page.url().includes('tauri.localhost'));
  if (!page) throw new Error('未找到独立桌面验收窗口');
  page.setDefaultTimeout(120_000);
  page.on('pageerror', (cause) => errors.push(cause.message));
  const native = async <T>(request: HardwareRequest, schema: z.ZodType<T>) =>
    schema.parse(
      await page.evaluate(
        `window.__TAURI_INTERNALS__.invoke('hardware_execute',{request:${JSON.stringify(hardwareRequestSchema.parse(request))}})`,
      ),
    );
  const settings = settingsSnapshotSchema.parse(
    await page.evaluate(
      "window.__TAURI_INTERNALS__.invoke('settings_execute',{request:{operation:'snapshot'}})",
    ),
  );
  assert.equal(
    resolve(settings.dataRoot),
    resolve('.cache/verification/hardware-gui-final-data'),
    '拒绝对日常数据执行验收',
  );
  await page.goto('http://tauri.localhost/#/settings', { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '设置', exact: true }).waitFor();
  await page.goto('http://tauri.localhost/#/hardware', { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '系统与硬件', exact: true }).waitFor();
  let snapshot = await native({ operation: 'snapshot' }, hardwareSnapshotSchema);
  const start = Date.now();
  while (snapshot.samples.length < 3) {
    if (Date.now() - start > 100_000) throw new Error(JSON.stringify(snapshot.warnings));
    await new Promise((resolve) => setTimeout(resolve, 1000));
    snapshot = await native({ operation: 'snapshot' }, hardwareSnapshotSchema);
  }
  assert.ok(snapshot.devices.length > 0 && snapshot.sensors.length > 0);
  assert.equal(snapshot.privileged, false);
  assert.equal(snapshot.fps.enabled, false);
  assert.ok(snapshot.metrics['memoryTotal'] !== null);
  assert.ok(!(await page.locator('main').getByText('演示数据', { exact: true }).count()));
  const copy = await native({ operation: 'copy' }, z.string());
  assert.ok(copy.includes(snapshot.devices[0]?.name ?? 'CPU'));
  assert.match(copy, /原始传感器/u);
  results['realData'] = {
    devices: snapshot.devices.length,
    sensors: snapshot.sensors.length,
    gpus: snapshot.gpus.length,
    samples: snapshot.samples.length,
  };
  if (snapshot.gpus.length > 1) {
    const last = snapshot.gpus.at(-1);
    if (!last) throw new Error('GPU 缺失');
    await page.getByRole('combobox', { name: '选择显卡' }).selectOption(last.id);
    await page.locator('.hw-metric').nth(1).getByText(last.name, { exact: true }).waitFor();
    results['gpuSwitch'] = true;
  }
  for (const viewport of [
    { width: 1200, height: 800 },
    { width: 760, height: 560 },
  ]) {
    await page.setViewportSize(viewport);
    const dimensions = await page.evaluate(() => ({
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    assert.ok(dimensions.scrollWidth <= dimensions.width, JSON.stringify(dimensions));
    await page.screenshot({ path: resolve(output, `hardware-${viewport.width}.png`) });
  }
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.getByRole('tab', { name: '设备信息', exact: true }).click();
  assert.equal(await page.locator('.hw-device-detail').count(), snapshot.devices.length);
  await page.getByRole('combobox', { name: '设备分类' }).selectOption('memory');
  assert.equal(
    await page.locator('.hw-device-detail').count(),
    snapshot.devices.filter((device) => device.kind === 'memory').length,
  );
  await page.getByRole('button', { name: '传感器详情', exact: true }).click();
  let windows = z
    .array(z.string())
    .parse(
      await page.evaluate("window.__TAURI_INTERNALS__.invoke('plugin:window|get_all_windows')"),
    );
  const opened = Date.now();
  while (!windows.includes('sensor-monitor') && Date.now() - opened < 15000) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    windows = z
      .array(z.string())
      .parse(
        await page.evaluate("window.__TAURI_INTERNALS__.invoke('plugin:window|get_all_windows')"),
      );
  }
  assert.ok(windows.includes('sensor-monitor'));
  results['independentWindow'] = true;
  await page.goto('http://tauri.localhost/#/sensor-monitor', { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '原始传感器', exact: true }).waitFor();
  await page.getByRole('button', { name: '全部展开' }).click();
  assert.ok((await page.locator('table').count()) > 0);
  const sensor = snapshot.sensors.find((sensor) => sensor.value !== null);
  if (!sensor) throw new Error('没有可验收传感器');
  await page.getByRole('combobox', { name: '硬件类型筛选' }).selectOption(sensor.hardwareType);
  await page.getByRole('combobox', { name: '传感器类型筛选' }).selectOption(sensor.sensorType);
  await page.getByRole('searchbox').fill(sensor.name);
  await page.getByRole('button', { name: '全部展开' }).click();
  assert.ok((await page.locator('tbody tr').count()) > 0);
  await page.getByRole('button', { name: '全部收起' }).click();
  assert.equal(await page.locator('table').count(), 0);
  results['rawFiltersAndCollapse'] = true;
  await page.goto('http://tauri.localhost/#/hardware', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '导出 HTML 报告', exact: true }).click();
  await page.getByRole('button', { name: '生成 HTML 报告', exact: true }).click();
  const receipt = page.locator('.hw-export-receipt');
  await receipt.waitFor();
  const report = z
    .string()
    .regex(/^[dD]:[\\/]/u)
    .parse((await receipt.innerText()).split('\n')[0]?.replace('保存位置：', '').trim());
  snapshot = await native({ operation: 'snapshot' }, hardwareSnapshotSchema);
  await writeFile(
    resolve('.cache/verification/hardware-live-result.json'),
    JSON.stringify({ report, snapshot }, null, 2),
  );
  results['report'] = report;
  await page.getByRole('button', { name: '关闭弹窗' }).click();
  await page.getByRole('button', { name: '手机远程监控', exact: true }).click();
  await page.getByRole('dialog', { name: '手机远程监控' }).waitFor();
  const remote = await native({ operation: 'remote-info' }, hardwareRemoteSchema);
  assert.equal(remote.enabled, false);
  assert.equal(remote.url, null);
  results['remoteDefaultOff'] = true;
  await page.getByRole('button', { name: '关闭弹窗' }).click();
  // C++ 夹具只渲染颜色，目标约 200 Present/s；通过真实界面确认开启，绝不启动外部 PresentMon。
  renderer = spawn(resolve('.cache/verification/etw-render.exe'), [], {
    windowsHide: true,
    stdio: 'ignore',
  });
  const pid = renderer.pid;
  if (!pid) throw new Error('临时 ETW 渲染夹具无法启动');
  await page.getByRole('button', { name: '启用 ETW', exact: true }).click();
  await page.getByRole('spinbutton').fill(String(pid));
  await page.getByRole('checkbox', { name: '我已了解并确认执行上述操作' }).check();
  await page.getByRole('button', { name: '确认执行', exact: true }).click();
  const fpsStart = Date.now();
  let fps = await native({ operation: 'snapshot' }, hardwareSnapshotSchema);
  while (Date.now() - fpsStart < 25_000) {
    fps = await native({ operation: 'snapshot' }, hardwareSnapshotSchema);
    if (fps.fps.low01 !== null) break;
    if (!fps.fps.enabled && (await page.getByRole('dialog').count())) {
      const message = await page.getByRole('dialog').innerText();
      if (/ETW.*失败/u.test(message)) {
        results['etwPermission'] = message;
        break;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (fps.fps.enabled) {
    assert.ok(
      fps.fps.fps !== null && fps.fps.fps > 30 && fps.fps.fps < 400,
      JSON.stringify(fps.fps),
    );
    assert.ok(fps.fps.low1 !== null && fps.fps.low01 !== null, JSON.stringify(fps.fps));
    results['etwLive'] = fps.fps;
    await page.getByRole('button', { name: '停止 ETW', exact: true }).click();
  } else {
    assert.ok(results['etwPermission'], 'ETW 没有读数且没有权限诊断');
    await page.getByRole('button', { name: '关闭弹窗' }).click();
  }
  if (renderer.exitCode === null) renderer.kill();
  renderer = null;
  await page.getByRole('button', { name: '清除记录', exact: true }).click();
  await page.getByRole('checkbox', { name: '我已了解并确认执行上述操作' }).check();
  await page.getByRole('button', { name: '确认执行', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  snapshot = await native({ operation: 'snapshot' }, hardwareSnapshotSchema);
  assert.ok(snapshot.recording.count <= 2);
  results['clearHistory'] = true;
  assert.deepEqual(errors, []);
  results['pageErrors'] = errors;
  await writeFile(resolve(output, 'result.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
  // 默认退出偏好：即使传感器窗口仍打开，也应关闭整个程序并刷盘。
  await page.locator('.window-controls button').last().click();
} finally {
  if (renderer?.exitCode === null) renderer.kill();
  await browser.close();
}
