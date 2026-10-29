import './check-environment.ts';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, type Locator } from 'playwright-core';
import { z } from 'zod';
import {
  optimizationCatalogSchema,
  optimizationSnapshotSchema,
  optimizerRequestSchema,
  type OptimizerRequest,
} from '../src/lib/optimization-contracts.ts';
import { changePreviewSchema, changeReceiptSchema } from '../src/lib/builtin-contracts.ts';

// 本验收仅允许读取、生成预览和释放凭据。没有执行系统修改的入口，不申请 UAC。
process.env['NO_PROXY'] = '127.0.0.1,localhost';
process.env['no_proxy'] = '127.0.0.1,localhost';
const evidence = resolve(import.meta.dirname, '../.cache/verification/optimization-desktop');
await mkdir(evidence, { recursive: true });
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
const results: Record<string, unknown> = {};
const errors: string[] = [];
try {
  const context = browser.contexts()[0];
  const page = context?.pages().find((item) => !item.url().includes('#/hud'));
  if (!context || !page) throw new Error('没有找到本项目的桌面测试窗口');
  page.setDefaultTimeout(90_000);
  page.on('pageerror', (cause) => errors.push(cause.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  const read = async <T>(request: OptimizerRequest, schema: z.ZodType<T>) => {
    optimizerRequestSchema.parse(request);
    const value: unknown = await page.evaluate(
      `window.__TAURI_INTERNALS__.invoke('optimizer_execute',{request:${JSON.stringify(request)}})`,
    );
    return schema.parse(value);
  };
  const previewRequestSchema = z.discriminatedUnion('operation', [
    z.object({ operation: z.literal('change-discard'), token: z.uuid() }).strict(),
    z.object({ operation: z.literal('change-prepare'), change: z.unknown() }).strict(),
  ]);
  const previewOnly = async <T>(request: unknown, schema: z.ZodType<T>) => {
    // 运行时白名单避免未来维护时误把 change-apply 加入验收流程。
    const safeRequest = previewRequestSchema.parse(request);
    const value: unknown = await page.evaluate(
      `window.__TAURI_INTERNALS__.invoke('builtin_execute',{request:${JSON.stringify(safeRequest)}})`,
    );
    return schema.parse(value);
  };
  await page.goto(new URL('/#/optimization', page.url()).href);
  // 原生测试允许开发服务器热更新；完整刷新以丢弃此前 Query 缓存中的产品元数据。
  await page.reload();
  await page.getByRole('heading', { name: '系统优化', exact: true }).waitFor();
  const catalog = await read({ operation: 'catalog' }, optimizationCatalogSchema);
  const snapshot = await read({ operation: 'scan' }, optimizationSnapshotSchema);
  const initialHistory = await read({ operation: 'history' }, z.array(changeReceiptSchema));
  assert.deepEqual(
    [...new Set(snapshot.rows.map((row) => row.id))].sort(),
    catalog.items.map((item) => item.id).sort(),
  );
  assert.equal(snapshot.rows.filter((row) => row.state === 'error').length, 0);
  results['catalog'] = catalog;
  results['snapshot'] = snapshot;
  results['initialHistory'] = initialHistory;
  console.log('真实目录、201 项扫描及历史读取通过。');
  await page.getByRole('button', { name: '安全优化', exact: true }).waitFor({ state: 'visible' });
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll('button')].find(
      (element) => element.textContent === '安全优化',
    );
    return button instanceof HTMLButtonElement && !button.disabled;
  });
  const categoryCounts = [20, 14, 33, 56, 9, 22, 6, 6, 19, 11, 5];
  const categories = page.locator('.optimization-category > button');
  assert.equal(await categories.count(), 11);
  assert.equal(
    await page.locator('.optimization-common-item svg[data-icon="file-lines"]').count(),
    1,
  );
  assert.equal(
    await page.locator('.optimization-common-item svg[data-icon="window-restore"]').count(),
    1,
  );
  for (let index = 0; index < categoryCounts.length; index++) {
    await categories.nth(index).click();
    const dialog: Locator = page.getByRole('dialog');
    await dialog.waitFor();
    assert.equal(
      await dialog.locator('.optimization-setting-list > button').count(),
      categoryCounts[index],
    );
    if (index === 3) {
      await dialog.getByRole('combobox', { name: '风险等级' }).selectOption('high');
      assert.equal(await dialog.locator('.risk-low, .risk-medium').count(), 0);
      await dialog.getByRole('combobox', { name: '风险等级' }).selectOption('all');
      await page.screenshot({ path: resolve(evidence, 'privacy-category-native.png') });
    }
    await dialog.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  }
  // 实际设备可应用的全部目录项，含高风险项；只生成前后值预览后立即释放。
  const applicable = catalog.items.filter((item) =>
    snapshot.rows.some(
      (row) => row.id === item.id && row.state !== 'unsupported' && row.state !== 'error',
    ),
  );
  for (const restore of [false, true]) {
    const prepared = await previewOnly(
      {
        operation: 'change-prepare',
        change: {
          kind: 'optimization',
          selections: applicable.map((item) => ({
            id: item.id,
            value: restore ? 'restore' : item.defaultValue,
          })),
        },
      },
      changePreviewSchema,
    );
    try {
      assert.equal(prepared.expiresInSeconds, 600);
      assert.equal(prepared.preview.reversible, true);
      assert.ok(prepared.preview.changes.length > 0);
      assert.ok(prepared.preview.changes.every((change) => change.owners.length > 0));
      results[restore ? 'restorePreview' : 'allPreview'] = prepared;
    } finally {
      await previewOnly({ operation: 'change-discard', token: prepared.token }, z.null());
    }
  }
  for (const selections of [
    [{ id: 'unknownOperation', value: 'apply' }],
    [{ id: 'win32Priority', value: 'shell-command' }],
    [
      { id: 'gameMode', value: 'apply' },
      { id: 'gameMode', value: 'restore' },
    ],
  ])
    await assert.rejects(
      previewOnly(
        { operation: 'change-prepare', change: { kind: 'optimization', selections } },
        changePreviewSchema,
      ),
    );
  const search = page.getByRole('searchbox', { name: '搜索系统设置', exact: true });
  await search.fill('win32Priority');
  assert.equal(await page.locator('.optimization-setting-list > button').count(), 1);
  await page.locator('.optimization-setting-list > button').click();
  let dialog = page.getByRole('dialog');
  assert.equal(
    await dialog.getByRole('combobox', { name: '目标配置' }).locator('option').count(),
    4,
  );
  await dialog.getByRole('combobox', { name: '目标配置' }).selectOption('background');
  await dialog.getByText(/查看实际注册表读数/u).click();
  await page.screenshot({ path: resolve(evidence, 'enum-detail-native.png') });
  await dialog.getByRole('button', { name: '审阅并应用此项', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '生成修改预览', exact: true }).click();
  const submit = dialog.getByRole('button', { name: '确认并执行系统修改', exact: true });
  await submit.waitFor();
  assert.equal(await submit.isDisabled(), true);
  await dialog.locator('.optimization-confirm-row input').check();
  assert.equal(await submit.isDisabled(), true);
  await dialog.getByRole('checkbox', { name: /我已逐项核对风险/u }).check();
  assert.equal(await submit.isEnabled(), true);
  // 故意停在最终确认前：绝不点击 submit。
  await dialog.getByText('查看实际值与目标值', { exact: true }).click();
  await page.screenshot({ path: resolve(evidence, 'confirmation-native.png') });
  await dialog.getByRole('button', { name: '清空待应用', exact: true }).click();
  await dialog.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await search.fill('');
  for (const name of ['安全优化', '增强优化', '全部优化', '批量恢复']) {
    await page.getByRole('button', { name, exact: true }).click();
    const modal = page.getByRole('dialog');
    await modal.locator('.optimization-confirm-list').waitFor();
    assert.ok((await modal.locator('.optimization-confirm-row').count()) > 0);
    if (name === '安全优化' || name === '增强优化')
      assert.equal(await modal.locator('.risk-high').count(), 0);
    if (name === '安全优化') assert.equal(await modal.locator('.risk-medium').count(), 0);
    if (name === '全部优化') assert.ok((await modal.locator('.risk-high').count()) > 0);
    assert.equal(await modal.getByRole('button', { name: '确认并执行系统修改' }).count(), 0);
    assert.equal(await modal.locator('input:checked').count(), 0);
    results[name] = await modal.locator('.optimization-confirm-row').count();
    await modal.getByRole('button', { name: '清空待应用', exact: true }).click();
    await modal.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  }
  await page.getByRole('button', { name: '修改记录', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByText(/这里只显示实际执行回执/u)
    .waitFor();
  await page.screenshot({ path: resolve(evidence, 'history-native.png') });
  await page.getByRole('dialog').getByRole('button', { name: '关闭弹窗', exact: true }).click();
  for (const [width, height] of [
    [1200, 800],
    [1024, 720],
    [900, 720],
    [760, 560],
    [390, 780],
  ]) {
    if (width === undefined || height === undefined) throw new Error('无效验收尺寸');
    await page.setViewportSize({ width, height });
    await page.locator('.optimization-main').focus();
    await page.locator('.optimization-main').evaluate((element) => element.scrollIntoView());
    const layout = await page.evaluate(() => ({
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
      cards: [...document.querySelectorAll('.optimization-category')].map((element) => {
        const box = element.getBoundingClientRect();
        return { width: box.width, right: box.right };
      }),
    }));
    assert.ok(layout.document <= layout.viewport + 1, `${width}px 出现横向溢出`);
    assert.ok(layout.cards.every((card) => card.width > 0 && card.right <= width + 1));
    results[`layout-${width}`] = layout;
    await page.screenshot({ path: resolve(evidence, `optimization-${width}.png`), fullPage: true });
    if (width === 1200)
      await page.screenshot({ path: resolve(evidence, 'optimization-final-1200.png') });
    if (width === 760 || width === 390) {
      await categories.first().click();
      const modal = page.getByRole('dialog');
      assert.equal(
        await modal.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
        true,
        `${width}px 分类弹窗横向溢出`,
      );
      await page.screenshot({ path: resolve(evidence, `category-modal-${width}.png`) });
      await modal.locator('.optimization-setting-list > button').first().click();
      assert.equal(
        await modal.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
        true,
        `${width}px 配置详情横向溢出`,
      );
      await page.screenshot({ path: resolve(evidence, `setting-modal-${width}.png`) });
      await modal.getByRole('button', { name: '关闭弹窗', exact: true }).click();
    }
  }
  await page.setViewportSize({ width: 1200, height: 800 });
  const finalHistory = await read({ operation: 'history' }, z.array(changeReceiptSchema));
  assert.deepEqual(finalHistory, initialHistory, '预览或草稿不应生成执行记录');
  assert.deepEqual(errors, [], '存在脚本、资源或 CSP 错误');
  results['errors'] = errors;
  results['systemWrites'] = '未调用 change-apply，未执行系统配置写入';
  await writeFile(
    resolve(evidence, 'results.json'),
    JSON.stringify({ passed: true, checkedAt: new Date().toISOString(), results, errors }, null, 2),
  );
  console.log(`201 项真实扫描、分类、风险、枚举、预览、恢复预览及响应式验证通过：${evidence}`);
} finally {
  await browser.close();
}
