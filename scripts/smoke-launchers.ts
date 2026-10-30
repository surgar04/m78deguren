import './check-environment.ts';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { chromium } from 'playwright-core';
import {
  quickSnapshotSchema,
  otherGamesSchema,
  gameProfileSchema,
} from '../src/lib/launcher-contracts.ts';
import { footprintSchema, settingsSnapshotSchema } from '../src/lib/settings-contracts.ts';
import { z } from 'zod';
process.env.NO_PROXY = '127.0.0.1,localhost';
process.env.no_proxy = process.env.NO_PROXY;
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
const output = resolve('.cache/verification/launchers-desktop');
await mkdir(output, { recursive: true });
const page = browser
  .contexts()[0]
  ?.pages()
  .find((page) => page.url().includes('127.0.0.1:1420'));
assert.ok(page, '需要 desktop:launchers:dev 的真实原生窗口');
const errors: string[] = [];
page.on('pageerror', (error) => errors.push(error.message));
const invoke = (command: string, request: Record<string, unknown>) =>
  page.evaluate(
    async ({ command, request }) => {
      const bridge = window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (name: string, args: Record<string, unknown>) => Promise<unknown>;
        };
      };
      return bridge.__TAURI_INTERNALS__.invoke(command, { request });
    },
    { command, request },
  );
let original: z.infer<typeof quickSnapshotSchema> | null = null;
let originalHotkeys: boolean | null = null;
try {
  const footprint = footprintSchema.parse(
    await invoke('settings_execute', { operation: 'footprint' }),
  );
  assert.ok(
    resolve(footprint.dataRoot).startsWith(resolve('.cache/verification') + sep + 'launchers-'),
    '禁止修改普通用户档案',
  );
  await page.locator('.dock').waitFor();
  assert.equal(
    await page.locator('.custom-navigation>button:not(.custom-navigation-edit)').count(),
    6,
  );
  original = quickSnapshotSchema.parse(
    await invoke('quick_launch_execute', { operation: 'snapshot' }),
  );
  originalHotkeys = settingsSnapshotSchema.parse(
    await invoke('settings_execute', { operation: 'snapshot' }),
  ).config.hotkeysEnabled;
  assert.equal(original.config.wheel.enabled, false);
  await assert.rejects(invoke('quick_launch_execute', { operation: 'navigation', index: 6 }));
  await assert.rejects(
    invoke('quick_launch_execute', {
      operation: 'save',
      revision: '0'.repeat(64),
      config: original.config,
    }),
  );
  await assert.rejects(
    invoke('other_games_execute', { operation: 'scan', deep: true, path: 'C:/' }),
  );
  await assert.rejects(
    invoke('other_games_execute', {
      operation: 'launch',
      id: '00000000-0000-0000-0000-000000000000',
    }),
  );
  const profiles = z
    .array(gameProfileSchema)
    .parse(await invoke('other_games_execute', { operation: 'catalog' }));
  assert.equal(profiles.length, 8);
  await page.goto('http://127.0.0.1:1420/#/library/other');
  await page.getByRole('navigation', { name: '游戏库分类' }).waitFor();
  await page.getByRole('button', { name: '快速搜索', exact: true }).click();
  const deadline = Date.now() + 240000;
  let scan = otherGamesSchema.parse(await invoke('other_games_execute', { operation: 'snapshot' }));
  while (scan.running && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    scan = otherGamesSchema.parse(await invoke('other_games_execute', { operation: 'snapshot' }));
  }
  assert.equal(scan.running, false, '本机只读搜索应在预算内结束');
  assert.ok(scan.scannedAt, `扫描必须写入真实时间与结果，失败不能冒充空游戏库：${scan.message}`);
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll('button')).some(
      (button) => button.textContent?.trim() === '快速搜索' && !button.disabled,
    ),
  );
  await page.screenshot({ path: resolve(output, 'other-games.png') });
  await page.goto('http://127.0.0.1:1420/#/settings?tab=shortcuts');
  await page.locator('#quick-launch-settings').scrollIntoViewIfNeeded();
  await page.getByLabel('快捷启动目标', { exact: true }).selectOption('page:hardware');
  await page.getByRole('button', { name: '桌面八向轮盘', exact: true }).click();
  await page.getByLabel('快捷启动目标', { exact: true }).selectOption('page:other-games');
  await page.getByRole('button', { name: '保存快捷配置', exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('.custom-navigation button')?.getAttribute('title') === '系统与硬件',
  );
  const saved = quickSnapshotSchema.parse(
    await invoke('quick_launch_execute', { operation: 'snapshot' }),
  );
  assert.deepEqual(saved.config.navigation[0], { kind: 'page', id: 'hardware' });
  assert.deepEqual(saved.config.wheel.slots[0], { kind: 'page', id: 'other-games' });
  await page.getByRole('group', { name: '轮盘方向配置' }).waitFor();
  await page.getByRole('group', { name: '轮盘方向配置' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(output, 'wheel-settings.png') });
  await page.getByRole('button', { name: '系统与硬件', exact: true }).click();
  await page.waitForURL(/#\/hardware$/u);
  await page.getByRole('heading', { name: '系统与硬件', exact: true }).waitFor();
  await page.setViewportSize({ width: 840, height: 640 });
  await page.waitForTimeout(350);
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
    '窄窗口产生横向溢出',
  );
  await page.screenshot({ path: resolve(output, 'navigation-compact.png') });
  await page.setViewportSize({ width: 1200, height: 800 });
  // 预览采用原生分层窗口，不执行方向目标，也不安装触发键钩子。
  await invoke('quick_launch_execute', { operation: 'preview' });
  const previewDeadline = Date.now() + 25000;
  let preview = quickSnapshotSchema.parse(
    await invoke('quick_launch_execute', { operation: 'snapshot' }),
  );
  while (!preview.runtime.visible && Date.now() < previewDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    preview = quickSnapshotSchema.parse(
      await invoke('quick_launch_execute', { operation: 'snapshot' }),
    );
  }
  assert.equal(preview.runtime.visible, true, '原生轮盘没有实际显示');
  assert.equal(preview.runtime.ready, false, '关闭状态的预览不能注册键盘钩子');
  // 验证真实后台钩子生命周期，只配置页面目标，不注入实体按键、不执行游戏或系统工具。
  const setMaster = (value: boolean) =>
    invoke('settings_execute', { operation: 'patch', patch: { kind: 'hotkeys-enabled', value } });
  const waitReady = async (ready: boolean) => {
    const until = Date.now() + 12000;
    let state = quickSnapshotSchema.parse(
      await invoke('quick_launch_execute', { operation: 'snapshot' }),
    );
    while (state.runtime.ready !== ready && Date.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      state = quickSnapshotSchema.parse(
        await invoke('quick_launch_execute', { operation: 'snapshot' }),
      );
    }
    assert.equal(state.runtime.ready, ready, state.runtime.message);
  };
  await setMaster(true);
  const beforeEnable = quickSnapshotSchema.parse(
    await invoke('quick_launch_execute', { operation: 'snapshot' }),
  );
  await invoke('quick_launch_execute', {
    operation: 'save',
    revision: beforeEnable.revision,
    config: { ...beforeEnable.config, wheel: { ...beforeEnable.config.wheel, enabled: true } },
  });
  await waitReady(true);
  await page.evaluate(async () => {
    const bridge = window as unknown as {
      __TAURI_INTERNALS__: {
        invoke: (name: string, args: Record<string, unknown>) => Promise<unknown>;
      };
    };
    await bridge.__TAURI_INTERNALS__.invoke('plugin:window|close', { label: 'main' });
  });
  await waitReady(true);
  await invoke('settings_execute', { operation: 'restore-main' });
  await setMaster(false);
  await waitReady(false);
  await setMaster(true);
  await waitReady(true);
  assert.deepEqual(errors, []);
  await writeFile(
    resolve(output, 'result.json'),
    JSON.stringify(
      {
        passed: true,
        profiles: profiles.length,
        realScan: true,
        detectedGames: scan.games.length,
        visited: scan.visited,
        eightNavigationSlots: true,
        savedAndNavigated: true,
        compactLayout: true,
        nativePreview: true,
        backgroundHookAndMasterSwitch: true,
        systemChangesExecuted: false,
        gamesLaunched: false,
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log(
    '真实本机扫描、六项导航、八向轮盘、窄窗口和原生轮盘预览通过；未启动游戏、安装软件或修改系统。',
  );
} finally {
  if (original) {
    const current = quickSnapshotSchema.parse(
      await invoke('quick_launch_execute', { operation: 'snapshot' }),
    );
    await invoke('quick_launch_execute', {
      operation: 'save',
      revision: current.revision,
      config: original.config,
    });
  }
  if (originalHotkeys !== null)
    await invoke('settings_execute', {
      operation: 'patch',
      patch: { kind: 'hotkeys-enabled', value: originalHotkeys },
    });
  await browser.close();
}
