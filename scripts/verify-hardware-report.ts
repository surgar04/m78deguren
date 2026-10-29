import './check-environment.ts';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { z } from 'zod';
import { hardwareSnapshotSchema } from '../src/lib/hardware-contracts.ts';

// 输入来自显式 Windows 只读验收，报告由 Rust 生成；不向报告注入演示样本。
const input = z
  .object({ report: z.string().regex(/^[dD]:[\\/]/u), snapshot: hardwareSnapshotSchema })
  .parse(
    JSON.parse(await readFile(resolve('.cache/verification/hardware-live-result.json'), 'utf8')),
  );
const root = resolve('.cache/verification/hardware-report-browser');
await mkdir(root, { recursive: true });
const context = await chromium.launchPersistentContext(resolve(root, 'profile'), {
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  viewport: { width: 1200, height: 900 },
  args: [`--disk-cache-dir=${resolve(root, 'cache')}`, '--disable-component-update'],
});
const errors: string[] = [];
const external: string[] = [];
try {
  const page = context.pages()[0] ?? (await context.newPage());
  page.setDefaultTimeout(120_000);
  page.on('pageerror', (cause) => errors.push(cause.message));
  page.on('request', (request) => {
    if (/^https?:/u.test(request.url())) external.push(request.url());
  });
  await page.goto(pathToFileURL(input.report).href, { waitUntil: 'load', timeout: 120_000 });
  await page
    .locator('#status')
    .getByText(/原始记录/u)
    .waitFor();
  assert.equal(await page.locator('canvas').count(), 10);
  assert.equal(await page.locator('#devices details').count(), input.snapshot.devices.length);
  const initial = await page.locator('#range-status').innerText();
  assert.match(initial, /个实测点/u);
  await page.locator('#range').selectOption('900');
  assert.match(await page.locator('#range-status').innerText(), /个实测点/u);
  await page.locator('#from').fill('2100-01-01T00:00');
  await page.locator('#to').fill('2100-01-02T00:00');
  await page.locator('#apply').click();
  assert.match(await page.locator('#range-status').innerText(), /没有实测数据/u);
  await page.locator('#range').selectOption('all');
  await page.locator('#apply').click();
  assert.equal(await page.locator('#range-status').innerText(), initial);
  await page.screenshot({ path: resolve(root, 'report-1200.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => ({
    width: innerWidth,
    scroll: document.documentElement.scrollWidth,
    elements: Array.from(document.querySelectorAll('main *'))
      .filter(
        (element) =>
          element.getBoundingClientRect().right > innerWidth + 1 ||
          element.scrollWidth > element.clientWidth + 1,
      )
      .map((element) => ({
        tag: element.tagName,
        id: element.id,
        width: element.getBoundingClientRect().width,
        client: element.clientWidth,
        scroll: element.scrollWidth,
      })),
  }));
  assert.ok(overflow.scroll <= overflow.width, JSON.stringify(overflow));
  await page.screenshot({ path: resolve(root, 'report-390.png') });
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  const result = {
    report: input.report,
    devices: input.snapshot.devices.length,
    charts: 10,
    offline: true,
    timeFilter: true,
    errors,
    external,
  };
  await writeFile(resolve(root, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await context.close();
}
