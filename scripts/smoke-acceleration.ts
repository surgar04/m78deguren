import './check-environment.ts';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { chromium } from 'playwright-core';
import { accelerationSnapshotSchema } from '../src/lib/acceleration-contracts.ts';
import { footprintSchema } from '../src/lib/settings-contracts.ts';

process.env.NO_PROXY = '127.0.0.1,localhost';
process.env.no_proxy = process.env.NO_PROXY;
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
const page = browser
  .contexts()[0]
  ?.pages()
  .find((tab) => tab.url().includes('127.0.0.1:1420'));
assert.ok(page, '需要真实 desktop:launchers:dev 窗口');
const errors: string[] = [];
page.on('pageerror', (cause) => errors.push(cause.message));
const output = resolve('.cache/verification/acceleration-desktop');
await mkdir(output, { recursive: true });
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
let original: ReturnType<typeof accelerationSnapshotSchema.parse> | undefined;
let originalTheme: string | undefined;
const changeTheme = (theme: string | null) =>
  page.evaluate(async (theme) => {
    const modulePath = '/src/features/settings/ui-store.ts';
    const module: unknown = await import(modulePath);
    if (module === null || typeof module !== 'object' || !('useSettingsUi' in module))
      throw new Error('UI store unavailable');
    const store = module.useSettingsUi;
    if (
      typeof store !== 'function' ||
      !('getState' in store) ||
      typeof store.getState !== 'function'
    )
      throw new Error('UI state reader unavailable');
    const state: unknown = Reflect.apply(store.getState, store, []);
    if (
      state === null ||
      typeof state !== 'object' ||
      !('theme' in state) ||
      typeof state.theme !== 'string' ||
      !('patch' in state) ||
      typeof state.patch !== 'function'
    )
      throw new Error('Invalid UI state');
    const previous = state.theme;
    if (theme !== null) Reflect.apply(state.patch, state, [{ theme }]);
    return previous;
  }, theme);
try {
  const footprint = footprintSchema.parse(
    await invoke('settings_execute', { operation: 'footprint' }),
  );
  assert.ok(
    resolve(footprint.dataRoot).startsWith(resolve('.cache/verification') + sep + 'launchers-'),
    '禁止写普通用户档案',
  );
  await page.goto('http://127.0.0.1:1420/#/tools/game-acceleration');
  await page.getByRole('heading', { name: '准备好线路，再进入游戏' }).waitFor();
  original = accelerationSnapshotSchema.parse(
    await invoke('acceleration_execute', { operation: 'snapshot' }),
  );
  assert.equal(original.session, null, '验收不注入假会话');
  await assert.rejects(invoke('acceleration_execute', { operation: 'open', path: 'D:\\evil.exe' }));
  await assert.rejects(
    invoke('acceleration_execute', { operation: 'website', kind: 'https://evil.invalid' }),
  );
  await assert.rejects(
    invoke('acceleration_execute', { operation: 'prepare', gameId: 'D:\\evil.exe' }),
  );
  await assert.rejects(
    invoke('acceleration_execute', { operation: 'prepare', gameId: crypto.randomUUID() }),
  );
  await assert.rejects(
    invoke('acceleration_execute', {
      operation: 'confirm',
      id: crypto.randomUUID(),
      consent: false,
    }),
  );
  const discovery = accelerationSnapshotSchema.parse(
    await invoke('acceleration_execute', { operation: 'discover' }),
  );
  assert.equal(discovery.session, null);
  const changed = accelerationSnapshotSchema.parse(
    await invoke('acceleration_execute', {
      operation: 'remind',
      enabled: !original.config.remindOnExit,
      revision: original.revision,
    }),
  );
  assert.equal(changed.config.remindOnExit, !original.config.remindOnExit);
  await assert.rejects(
    invoke('acceleration_execute', {
      operation: 'remind',
      enabled: true,
      revision: original.revision,
    }),
  );
  await invoke('acceleration_execute', {
    operation: 'remind',
    enabled: original.config.remindOnExit,
    revision: changed.revision,
  });
  const layout = [];
  for (const [width, height] of [
    [760, 560],
    [1200, 800],
    [1920, 1080],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.screenshot({
      path: resolve(output, `quickfox-${width}x${height}.png`),
      fullPage: true,
    });
    const overflow: boolean = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    );
    assert.equal(overflow, false, `${width}px horizontal overflow`);
    assert.ok(await page.getByRole('button', { name: '检测安装', exact: true }).isVisible());
    layout.push({ width, height, overflow });
  }
  originalTheme = await changeTheme('dark');
  await page.locator('.home-layout[data-theme="dark"]').waitFor();
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.screenshot({ path: resolve(output, 'quickfox-dark.png'), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  const probeStarted = performance.now();
  accelerationSnapshotSchema.parse(await invoke('acceleration_execute', { operation: 'snapshot' }));
  const probeRoundTripMs = Math.round(performance.now() - probeStarted);
  assert.equal(errors.length, 0, errors.join('\n'));
  await writeFile(
    resolve(output, 'result.json'),
    JSON.stringify(
      {
        passed: true,
        clients: discovery.clients.length,
        layout,
        errors,
        realAccelerationTested: false,
        probeRoundTripMs,
        darkModeChecked: true,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      passed: true,
      output,
      clients: discovery.clients.length,
      realAccelerationTested: false,
    }),
  );
} finally {
  if (originalTheme !== undefined) await changeTheme(originalTheme);
  if (original) {
    const current = accelerationSnapshotSchema.parse(
      await invoke('acceleration_execute', { operation: 'snapshot' }),
    );
    if (current.config.remindOnExit !== original.config.remindOnExit)
      await invoke('acceleration_execute', {
        operation: 'remind',
        enabled: original.config.remindOnExit,
        revision: current.revision,
      });
  }
  await page.setViewportSize({ width: 1200, height: 800 });
  await browser.close();
}
