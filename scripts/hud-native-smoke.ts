import './check-environment.ts';
import assert from 'node:assert/strict';
import { resolve, sep } from 'node:path';
import type { BrowserContext, Page } from 'playwright-core';
import type { z } from 'zod';
import { hudSnapshotSchema, hudRequestSchema, type HudRequest } from '../src/lib/hud-contracts.ts';
import { footprintSchema } from '../src/lib/settings-contracts.ts';

export async function invokeHud<T>(
  page: Page,
  request: HudRequest,
  schema: z.ZodType<T>,
): Promise<T> {
  const value = await page.evaluate(async (request) => {
    const native = window as unknown as {
      __TAURI_INTERNALS__: {
        invoke: (name: string, args: Record<string, unknown>) => Promise<unknown>;
      };
    };
    return native.__TAURI_INTERNALS__.invoke('hud_execute', { request });
  }, hudRequestSchema.parse(request));
  return schema.parse(value);
}
/** 真实 IPC 与窗口检查；先验证隔离数据目录，禁止测试覆盖日常偏好，且不启动 ETW/驱动。 */
export async function verifyHud(page: Page, context: BrowserContext, output: string) {
  const footprint = footprintSchema.parse(
    await page.evaluate(async () => {
      const native = window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (name: string, args: Record<string, unknown>) => Promise<unknown>;
        };
      };
      return native.__TAURI_INTERNALS__.invoke('settings_execute', {
        request: { operation: 'footprint' },
      });
    }),
  );
  assert.ok(
    resolve(footprint.dataRoot).startsWith(resolve('.cache/verification') + sep),
    'HUD 验收只允许使用 D 盘隔离档案',
  );
  const original = await invokeHud(page, { operation: 'snapshot' }, hudSnapshotSchema);
  try {
    const config = {
      ...original.config,
      enabled: true,
      frames: false,
      powerEvents: false,
      mode: 'normal' as const,
      activeProfile: 'system.memory',
      queue: ['system.memory'],
      locked: false,
      alwaysShow: true,
      scale: 0.8,
      opacity: 1,
      animation: 'full' as const,
    };
    await invokeHud(page, { operation: 'configure', config }, hudSnapshotSchema);
    let live = original;
    for (let attempt = 0; attempt < 120; attempt++) {
      live = await invokeHud(page, { operation: 'snapshot' }, hudSnapshotSchema);
      if (typeof live.live.metrics?.['cpu'] === 'number' && live.live.render) break;
      if (attempt === 119) throw Error('共享硬件和上游方案的真实采样未就绪');
      await page.waitForTimeout(500);
    }
    const hud =
      context.pages().find((p) => p.url().endsWith('#/hud')) ??
      (await context.waitForEvent('page', { timeout: 15000 }));
    await hud.waitForURL(/#\/hud$/u);
    await hud.locator('.hud-shell').waitFor();
    await hud.waitForTimeout(2900);
    await hud.screenshot({ path: resolve(output, 'hud-system.png'), omitBackground: true });
    assert.equal(
      await hud.evaluate(() => getComputedStyle(document.documentElement).backgroundColor),
      'rgba(0, 0, 0, 0)',
    );
    assert.equal(await hud.locator('.hud-progress').count(), 1);
    assert.equal(await hud.evaluate(() => document.fonts.check('16px ZhenjingHudInter')), true);
    for (const [command, request] of [
      ['builtin_execute', { operation: 'query', tool: 'apps' }],
      ['optimizer_execute', { operation: 'catalog' }],
      ['hud_execute', { operation: 'configure', config }],
    ] as const) {
      await assert.rejects(
        hud.evaluate(
          async ({ command, request }) => {
            const native = window as unknown as {
              __TAURI_INTERNALS__: {
                invoke: (name: string, args: Record<string, unknown>) => Promise<unknown>;
              };
            };
            return native.__TAURI_INTERNALS__.invoke(command, { request });
          },
          { command, request },
        ),
        'HUD 辅助窗口不应获得配置或系统工具能力',
      );
    }
    await invokeHud(
      page,
      {
        operation: 'configure',
        config: { ...config, scale: 0.55, opacity: 0.6, position: 'bottom-right' },
      },
      hudSnapshotSchema,
    );
    await hud.waitForTimeout(1600);
    const geometry = await hud.evaluate(() => ({
      width: innerWidth,
      opacity: getComputedStyle(document.querySelector('.hud-shell') ?? document.body).opacity,
    }));
    assert.ok(Math.abs(geometry.width - 319) < 3, 'HUD 缩放未调整原生窗口');
    assert.equal(Number(geometry.opacity), 0.6);
    await invokeHud(
      page,
      { operation: 'configure', config: { ...config, mode: 'game' } },
      hudSnapshotSchema,
    );
    await hud.locator('.hud-game-grid').waitFor();
    for (
      let attempt = 0;
      attempt < 20 && (await hud.locator('.hud-game-grid>div').count()) !== 8;
      attempt++
    )
      await hud.waitForTimeout(100);
    assert.equal(await hud.locator('.hud-game-grid>div').count(), 8);
    await hud.waitForTimeout(800);
    await hud.screenshot({ path: resolve(output, 'hud-game.png'), omitBackground: true });
    const game = await invokeHud(page, { operation: 'snapshot' }, hudSnapshotSchema);
    assert.equal(game.live.game, true);
    assert.equal(game.live.fps?.enabled, false);
    await invokeHud(
      page,
      { operation: 'configure', config: { ...config, enabled: false } },
      hudSnapshotSchema,
    );
    // 即使主窗口持续续租预览，关闭 HUD 也应销毁真正的桌面窗口。
    for (let attempt = 0; attempt < 30 && !hud.isClosed(); attempt++) {
      await invokeHud(page, { operation: 'snapshot' }, hudSnapshotSchema);
      await page.waitForTimeout(100);
    }
    assert.equal(hud.isClosed(), true, '编辑器预览不能使已关闭的 HUD 继续显示');
    return {
      sharedTelemetry: true,
      nativeWindow: true,
      frameSamplingStarted: false,
      modeSwitch: true,
      scaleAndOpacity: true,
      leastPrivilege: true,
      closesDuringPreview: true,
      normalReadings: live.live.metrics,
    };
  } finally {
    await invokeHud(page, { operation: 'configure', config: original.config }, hudSnapshotSchema);
  }
}
