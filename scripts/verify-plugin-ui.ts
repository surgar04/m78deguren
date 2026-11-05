import './check-environment.ts';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { pluginManifestSchema, pluginSnapshotSchema } from '../src/lib/plugin-contracts.ts';

/** 界面夹具仅注入独立浏览器的 Query 缓存，绝不写入应用索引，也不伪造原生验收结论。 */
const output = resolve('.cache/verification/plugins-ui');
await mkdir(output, { recursive: true });
const manifest = pluginManifestSchema.parse(
  JSON.parse(await readFile('plugins/examples/rust/manifest.json', 'utf8')),
);
manifest.name = '用于核对长中文标题与权限说明自动换行的 Rust 示例插件';
manifest.permissions.push({
  id: 'network',
  reason: '仅读取指定 HTTPS 来源的公开数据，此项为可选能力。',
  optional: true,
  origins: ['https://example.com'],
});
const snapshot = pluginSnapshotSchema.parse({
  revision: 1,
  safeMode: false,
  runtimeAvailable: true,
  notice: null,
  nativeExtensions: false,
  items: [
    {
      manifest,
      digest: 'a'.repeat(64),
      publisherKey: 'b'.repeat(64),
      grants: [],
      enabled: false,
      quarantined: false,
      failures: 0,
      previous: null,
      running: false,
    },
  ],
});
const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: ['--no-proxy-server', '--disable-crash-reporter'],
});
const errors: string[] = [];
const checks = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 800 },
    reducedMotion: 'reduce',
  });
  page.on('pageerror', (cause) => errors.push(cause.message));
  await page.goto(`${process.env['ZHENJING_PLUGIN_UI_URL'] ?? 'http://127.0.0.1:1422'}/#/plugins`, {
    waitUntil: 'domcontentloaded',
    timeout: 90000,
  });
  await page.locator('#main-content').waitFor();
  await page.locator('.settings-startup-logo').waitFor({ state: 'detached' });
  await page.getByText('网页预览不会制造插件或授权记录。', { exact: false }).waitFor();
  await page.screenshot({ path: resolve(output, 'web-empty.png'), fullPage: true });
  await page.evaluate(
    `(async()=>{const {queryClient}=await import('/src/lib/query-client.ts');queryClient.setQueryData(['plugins','snapshot'],${JSON.stringify(snapshot)});})()`,
  );
  for (const size of [
    { width: 760, height: 560 },
    { width: 1200, height: 800 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(size);
    await page.getByRole('button', { name: '权限', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    assert.equal(await dialog.getByRole('checkbox', { name: /插件私有存储/ }).isChecked(), true);
    assert.equal(
      await dialog.getByRole('checkbox', { name: /指定网站网络请求/ }).isChecked(),
      false,
    );
    assert.equal(
      await dialog.getByRole('button', { name: '确认', exact: true }).isDisabled(),
      true,
    );
    await dialog.getByRole('checkbox', { name: /我已核对来源/ }).check();
    assert.equal(await dialog.getByRole('button', { name: '确认', exact: true }).isEnabled(), true);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({
      path: resolve(output, `permissions-${size.width}.png`),
      fullPage: true,
    });
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    await page.screenshot({ path: resolve(output, `center-${size.width}.png`), fullPage: true });
    checks.push({ ...size, permissions: true, noOverflow: true });
  }
  assert.deepEqual(errors, []);
  await writeFile(
    resolve(output, 'report.json'),
    JSON.stringify({ fixtureOnly: true, checks, errors }, null, 2),
  );
  console.log('插件中心布局、权限复核、可选权限默认关闭及原生 dialog 键盘关闭验收通过。');
} finally {
  await browser.close();
}
