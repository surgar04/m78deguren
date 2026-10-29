import './check-environment.ts';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { chromium, type Page } from 'playwright-core';
import { z } from 'zod';
import { hudSnapshotSchema } from '../src/lib/hud-contracts.ts';
import { footprintSchema } from '../src/lib/settings-contracts.ts';
import { downloadsSchema, type ToolRequest, toolRequestSchema } from '../src/lib/tool-contracts.ts';
import { invokeHud } from './hud-native-smoke.ts';

async function call<T>(page: Page, request: ToolRequest, schema: z.ZodType<T>): Promise<T> {
  const data = await page.evaluate(async (request) => {
    const native = window as unknown as {
      __TAURI_INTERNALS__: {
        invoke: (name: string, args: Record<string, unknown>) => Promise<unknown>;
      };
    };
    return native.__TAURI_INTERNALS__.invoke('tools_execute', { request });
  }, toolRequestSchema.parse(request));
  return schema.parse(data);
}
// 下载官方 Inter 文件并限速，检验真实字节进度和轮播；结束取消并移除自己的任务与文件。
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
try {
  const context = browser.contexts()[0],
    page = context?.pages().find((p) => !p.url().endsWith('#/hud'));
  if (!context || !page) throw Error('未找到隔离主窗口');
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
  assert.ok(resolve(footprint.dataRoot).startsWith(resolve('.cache/verification') + sep));
  const original = await invokeHud(page, { operation: 'snapshot' }, hudSnapshotSchema);
  let id: string | undefined;
  try {
    await invokeHud(
      page,
      {
        operation: 'configure',
        config: {
          ...original.config,
          enabled: true,
          mode: 'normal',
          frames: false,
          powerEvents: false,
          cycleSeconds: 3,
          alwaysShow: true,
          activeProfile: 'system.memory',
          queue: ['system.memory'],
        },
      },
      hudSnapshotSchema,
    );
    const hash = createHash('sha256')
      .update(await readFile('public/fonts/InterVariable.woff2'))
      .digest('hex');
    id = await call(
      page,
      {
        operation: 'download-create',
        input: {
          url: 'https://raw.githubusercontent.com/rsms/inter/v4.1/docs/font-files/InterVariable.woff2',
          fileName: `hud-check-${randomUUID()}.woff2`,
          connections: 1,
          limitKib: 4,
          expectedSha256: hash,
        },
      },
      z.string(),
    );
    let visible = false,
      progress = false;
    for (let attempt = 0; attempt < 240; attempt++) {
      const snapshot = await invokeHud(page, { operation: 'snapshot' }, hudSnapshotSchema);
      const task = (await call(page, { operation: 'downloads-list' }, downloadsSchema)).find(
        (t) => t.id === id,
      );
      if (attempt % 10 === 0)
        console.log({
          status: task?.status,
          downloaded: task?.downloaded,
          total: task?.total,
          scene: snapshot.live.scene,
        });
      if (task?.status === 'failed') throw Error(task.message);
      progress = progress || (task?.downloaded ?? 0) > 0;
      visible = visible || (snapshot.live.scene?.startsWith('@downloads') ?? false);
      if (progress && visible) {
        const hud = context.pages().find((p) => p.url().endsWith('#/hud'));
        if (hud) {
          await hud.waitForTimeout(600);
          await hud.screenshot({
            path: resolve('.cache/verification/hud-desktop/hud-download.png'),
            omitBackground: true,
          });
        }
        await writeFile(
          resolve('.cache/verification/hud-desktop/download.json'),
          JSON.stringify(
            {
              passed: true,
              scene: snapshot.live.scene,
              downloaded: task?.downloaded,
              total: task?.total,
            },
            null,
            2,
          ),
        );
        break;
      }
      await page.waitForTimeout(500);
    }
    assert.ok(progress && visible, '真实下载字节进度或 HUD 轮播未出现');
    console.log('真实下载任务进度及 HUD 轮播验证通过。');
  } finally {
    try {
      if (id) {
        try {
          await call(page, { operation: 'download-action', id, action: 'cancel' }, z.null());
        } finally {
          // 取消是异步动作；等分段任务真正退出后再移除记录及残留。
          for (let attempt = 0; attempt < 50; attempt++) {
            const task = (await call(page, { operation: 'downloads-list' }, downloadsSchema)).find(
              (t) => t.id === id,
            );
            if (task && ['cancelled', 'paused', 'failed', 'complete'].includes(task.status)) {
              await page.waitForTimeout(100);
              break;
            }
            await page.waitForTimeout(100);
          }
          await call(page, { operation: 'download-action', id, action: 'remove' }, z.null());
        }
      }
    } finally {
      await invokeHud(page, { operation: 'configure', config: original.config }, hudSnapshotSchema);
    }
  }
} finally {
  await browser.close();
}
