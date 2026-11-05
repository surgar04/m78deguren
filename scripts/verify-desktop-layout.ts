import './check-environment.ts';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, type Page } from 'playwright-core';
import type { ToolCatalog } from '../src/features/tools/types.ts';

/**
 * 浏览器布局回归：覆盖真实路由、容器断点、偏好组合和辅助面板，不调用原生变更命令。
 * 启动前使用 dev.ps1 exec vite；浏览器、临时档案与截图均继承入口的 D 盘隔离环境。
 * 工具长文本夹具仅注入本次独立浏览器的 Query 缓存，不作为产品运行时回退数据。
 */
const output = resolve('.cache/verification/material-layout');
await mkdir(output, { recursive: true });
const catalog = JSON.parse(
  await readFile('src-tauri/src/services/tools/windows/optimizer-catalog.json', 'utf8'),
) as unknown;
const tools: ToolCatalog = {
  source: 'native',
  external: null,
  tools: [
    { id: 'crosshair', category: 'gaming', name: '长标题与完整说明的布局边界验收工具' },
    { id: 'screen-test', category: 'gaming', name: '屏幕测试' },
    { id: 'recordings', category: 'gaming', name: '录屏管理' },
    { id: 'downloads', category: 'network', name: '下载管理' },
    { id: 'speed-test', category: 'network', name: '网络测速' },
    { id: 'time-sync', category: 'network', name: '时间同步' },
    { id: 'runtimes', category: 'maintenance', name: '运行库修复' },
    { id: 'crash-logs', category: 'maintenance', name: '崩溃日志' },
  ].map((row) => ({
    ...row,
    category: row.category as 'gaming' | 'network' | 'maintenance',
    icon: 'display',
    tone: 'mint',
    origin: 'builtin',
    description:
      row.id === 'crosshair'
        ? '用于验证中文长说明在窄窗口中自动换行，确保文字完整可读，并且不会与独立收藏按钮重叠。'
        : '用于检查栅格对齐、工具入口和卡片内部留白。',
    aliases: [],
    details: [],
  })),
};
const browser = await chromium.launch({
  executablePath:
    process.env['ZHENJING_LAYOUT_BROWSER'] ??
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: ['--no-proxy-server', '--disable-crash-reporter'],
});
interface LayoutResult {
  route: string;
  width: number;
  height: number;
  scrollWidth: number;
}
const results: LayoutResult[] = [];
const errors: string[] = [];
async function open(page: Page, route: string) {
  await page.goto(`http://127.0.0.1:1420/#/${route}`, { waitUntil: 'domcontentloaded' });
  await page.locator('#main-content').waitFor();
  await page.locator('.settings-startup-logo').waitFor({ state: 'detached' });
  await page.evaluate(() => document.fonts.ready);
  // 等待容器查询与 React 路由提交，避免把过渡帧当作最终布局。
  await page.evaluate(() => new Promise(requestAnimationFrame));
}
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 800 },
    reducedMotion: 'reduce',
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await open(page, '');
  await page.evaluate(`(async () => {
    const { queryClient } = await import('/src/lib/query-client.ts');
    const { optimizationCatalogSchema } = await import('/src/lib/optimization-contracts.ts');
    const { createOptimizationCatalog } = await import('/src/features/optimization/catalog.ts');
    queryClient.setQueryData(['optimization', 'catalog'], createOptimizationCatalog(optimizationCatalogSchema.parse(${JSON.stringify(catalog)})));
    queryClient.setQueryData(['tools', 'catalog'], ${JSON.stringify(tools)});
  })()`);
  for (const size of [
    { width: 760, height: 560 },
    { width: 1200, height: 800 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(size);
    for (const route of [
      '',
      'tools',
      'optimization',
      'hardware',
      'library',
      'library/other',
      'settings',
      'music',
    ]) {
      await open(page, route);
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      results.push({ route: route || 'home', ...size, scrollWidth });
      assert.ok(scrollWidth <= size.width + 1, `${route || 'home'} 在 ${size.width}px 横向溢出`);
      if (route === 'music') {
        const workbench = await page.locator('.music-workbench').boundingBox();
        const controls = await page.locator('.music-controls').boundingBox();
        assert.ok(
          workbench && controls && controls.y >= workbench.y + workbench.height - 1,
          '播放条不得覆盖曲库工作台',
        );
      }
      await page.screenshot({
        path: resolve(output, `${route.replaceAll('/', '-') || 'home'}-${size.width}.png`),
        fullPage: true,
      });
    }
  }
  // 组合偏好从独立页面状态修改，不触发用户真实配置或原生系统操作。
  for (const navPosition of ['side', 'top']) {
    for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width: 760, height: 560 });
      await page.evaluate(`(async () => {
        const { useSettingsUi } = await import('/src/features/settings/ui-store.ts');
        const { usePreferences } = await import('/src/stores/preferences.ts');
        useSettingsUi.setState({ navPosition: '${navPosition}', theme: '${theme}', splashEnabled: false });
        usePreferences.setState({ compact: true });
      })()`);
      await open(page, 'settings');
      await page.getByRole('tab', { name: '外观与体验', exact: true }).focus();
      await page.keyboard.press('ArrowRight');
      await page.getByRole('tab', { name: '通用偏好', exact: true, selected: true }).waitFor();
      assert.equal(
        await page
          .getByRole('tab', { name: '通用偏好', exact: true })
          .getAttribute('aria-selected'),
        'true',
      );
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({
        path: resolve(output, `settings-${navPosition}-${theme}-compact.png`),
        fullPage: true,
      });
      await open(page, 'music');
      // 开合会改变按钮名称，使用稳定元素定位检查同一控件的状态。
      const toggle = page.locator('.music-support-toggle');
      await toggle.click();
      await page.locator('.music-support-toggle[aria-expanded="true"]').waitFor();
      assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
      assert.equal(
        await page.getByRole('complementary', { name: '当前播放详情' }).isVisible(),
        true,
      );
      await page.getByRole('button', { name: '收起当前播放', exact: true }).click();
      await page.locator('.music-support-toggle[aria-expanded="false"]').waitFor();
      assert.equal(
        await page.getByRole('complementary', { name: '当前播放详情' }).isVisible(),
        false,
      );
    }
  }
  assert.deepEqual(errors, [], '存在页面脚本异常');
  await writeFile(
    resolve(output, 'layout-results.json'),
    JSON.stringify(
      {
        scope: '浏览器界面验收；工具使用测试夹具，不代表 Windows 原生服务或真实业务操作验收',
        results,
        preferenceCombinations: 4,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(`布局验收通过：${results.length} 个页面尺寸组合、4 组偏好、键盘导航和播放面板开合。`);
} finally {
  await browser.close();
}
