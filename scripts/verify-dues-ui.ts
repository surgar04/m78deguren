import './check-environment.ts';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { exampleLedger, exampleRemoteLedger } from '../src/features/plugins/dues/test-fixtures.ts';

/** 只对合成成员进行界面验收；不注入真实开发者认证、不访问群 API，也不声称原生联调通过。 */
const output = resolve('.cache/verification/dues-ui');
await mkdir(output, { recursive: true });
const ledger = exampleLedger();
const snapshot = {
  revision: 1,
  safeMode: false,
  runtimeAvailable: true,
  notice: null,
  nativeExtensions: false,
  items: [],
  builtins: [
    {
      id: 'org.zhenjing.builtin.group-dues',
      name: '群会费智能表格',
      description: '合成数据界面验收',
      version: '1.0.0',
    },
  ],
};
const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: ['--no-proxy-server', '--disable-crash-reporter'],
});
const errors: string[] = [],
  checks: object[] = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 800 },
    reducedMotion: 'reduce',
  });
  // 只固定合成测试页面的时间，避免跨天改变夹具的到期状态；不调整 Windows 系统时钟。
  await page.clock.install({ time: new Date('2026-11-06T03:00:00Z') });
  page.on('pageerror', (cause) => errors.push(cause.message));
  await page.goto(`${process.env['ZHENJING_PLUGIN_UI_URL'] ?? 'http://127.0.0.1:1422'}/#/plugins`, {
    waitUntil: 'domcontentloaded',
    timeout: 90000,
  });
  await page.locator('#main-content').waitFor();
  await page.locator('.settings-startup-logo').waitFor({ state: 'detached' });
  assert.equal(await page.getByRole('link', { name: '群会费智能表格', exact: true }).count(), 0);
  await page.evaluate(
    `(async()=>{const {queryClient}=await import('/src/lib/query-client.ts');queryClient.setQueryData(['plugins','snapshot'],${JSON.stringify(snapshot)});queryClient.setQueryData(['plugins','builtin-dues','ledger'],${JSON.stringify(ledger)});})()`,
  );
  await page.getByRole('link', { name: '打开智能表格', exact: true }).click();
  await page.getByRole('button', { name: '本地人民币账本', exact: true }).click();
  await page.getByLabel('查看月份').fill('2026-11');
  await page.getByRole('region', { name: '会费智能表格', exact: true }).waitFor();
  assert.match(await page.getByLabel('当月会费统计').innerText(), /50%/u);
  for (const size of [
    { width: 760, height: 560 },
    { width: 1200, height: 800 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(size);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.equal(await page.locator('.dues-row-unpaid').count(), 1);
    await page.screenshot({ path: resolve(output, `table-${size.width}.png`), fullPage: true });
    await page.getByRole('button', { name: '会费设置', exact: true }).click();
    const dialog = page.getByRole('dialog');
    assert.equal(await dialog.getByLabel('每月固定金额（元）').inputValue(), '10.00');
    await page.screenshot({ path: resolve(output, `settings-${size.width}.png`), fullPage: true });
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    checks.push({ ...size, noOverflow: true, unpaidHighlight: true, settings: true });
  }
  await page.getByRole('button', { name: '查看未缴人员 →' }).click();
  assert.equal(await page.locator('.dues-table tbody tr').count(), 1);
  await page.getByRole('button', { name: '登记已缴', exact: true }).click();
  const payment = page.getByRole('dialog');
  await payment.getByLabel('缴费类型').selectOption('annual');
  assert.equal(await payment.getByLabel('每人缴纳金额（元）').inputValue(), '100.00');
  assert.match(await payment.innerText(), /2027-10/u);
  assert.equal(await payment.getByRole('button', { name: '确认保存' }).isDisabled(), true);
  await payment.getByRole('checkbox', { name: /我已核对成员/u }).check();
  assert.equal(await payment.getByRole('button', { name: '确认保存' }).isEnabled(), true);
  await page.screenshot({ path: resolve(output, 'annual-review.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: '缴费流水' }).click();
  assert.match(await page.getByRole('tabpanel').innerText(), /2026-11 — 2027-10/u);
  await page.evaluate(
    `(async()=>{const {queryClient}=await import('/src/lib/query-client.ts');queryClient.setQueryData(['plugins','builtin-dues','ledger'],${JSON.stringify(exampleRemoteLedger())});})()`,
  );
  await page.getByRole('button', { name: '返回 API 游戏币会费', exact: true }).click();
  const apiTable = page.getByRole('table', { name: 'API 成员会费表', exact: true });
  assert.match(await apiTable.innerText(), /2,000,000 游戏币/u);
  assert.match(await apiTable.innerText(), /2027-11-01/u);
  assert.match(await apiTable.innerText(), /历史记录未提供/u);
  for (const size of [
    { width: 760, height: 560 },
    { width: 1200, height: 800 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(size);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: resolve(output, `api-table-${size.width}.png`), fullPage: true });
  }
  await page.getByLabel('会费状态').selectOption('expired');
  await page.getByLabel('缴费方案').selectOption('monthly');
  assert.match(await apiTable.innerText(), /test-b/u);
  assert.doesNotMatch(await apiTable.innerText(), /test-a/u);
  assert.equal(await page.locator('.dues-row-expired').count(), 1);
  await apiTable.getByRole('button', { name: 'API 流水', exact: true }).click();
  assert.match(await page.getByRole('dialog').innerText(), /fee-old-b/u);
  await page.keyboard.press('Escape');
  // 撤掉目录描述后立即隐藏入口和表格；缓存清理在真实卸载后执行。
  await page.evaluate(
    `(async()=>{const {queryClient}=await import('/src/lib/query-client.ts');queryClient.setQueryData(['plugins','snapshot'],${JSON.stringify({ ...snapshot, builtins: [] })});})()`,
  );
  await page
    .getByRole('region', { name: 'API 会费智能表格', exact: true })
    .waitFor({ state: 'detached' });
  assert.deepEqual(errors, []);
  await writeFile(
    resolve(output, 'report.json'),
    JSON.stringify(
      {
        fixtureOnly: true,
        normalWebHidden: true,
        descriptorRevocationHidden: true,
        filtering: true,
        annualReview: true,
        history: true,
        apiGameCurrency: true,
        apiExpiryAndHistory: true,
        apiViewportChecks: true,
        checks,
        errors,
      },
      null,
      2,
    ),
  );
  console.log('内置会费表格界面验收通过（合成数据，不代替原生认证与 API 验收）。');
} finally {
  await browser.close();
}
