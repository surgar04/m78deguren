import './check-environment.ts';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { chromium } from 'playwright-core';
import { hudSnapshotSchema } from '../src/lib/hud-contracts.ts';
import { footprintSchema } from '../src/lib/settings-contracts.ts';
import { invokeHud } from './hud-native-smoke.ts';

// 只运行本项目的独立 D3D11 测试窗口；不注入游戏、不提权、不安装驱动。
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
let renderer: ReturnType<typeof spawn> | undefined;
try {
  const page = browser
    .contexts()[0]
    ?.pages()
    .find((p) => !p.url().endsWith('#/hud'));
  if (!page) throw Error('未找到主窗口');
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
  try {
    await invokeHud(
      page,
      {
        operation: 'configure',
        config: {
          ...original.config,
          enabled: true,
          mode: 'auto',
          frames: true,
          powerEvents: false,
          includeProcesses: ['hud-render.exe'],
          excludeProcesses: [],
        },
      },
      hudSnapshotSchema,
    );
    renderer = spawn(resolve('.cache/verification/hud-render.exe'), [], { stdio: 'ignore' });
    const pid = renderer.pid;
    assert.ok(pid);
    let found = false,
      result = original.live;
    for (let attempt = 0; attempt < 50; attempt++) {
      result = (await invokeHud(page, { operation: 'snapshot' }, hudSnapshotSchema)).live;
      if (result.game && result.gameInfo?.processId === pid) {
        found = true;
        if (result.fps?.low01 != null) break;
      }
      await page.waitForTimeout(500);
    }
    assert.ok(found, '前台进程白名单未触发自动游戏模式');
    // 权限受限时应明确失败；禁止填造 FPS 让验收看似成功。
    const actualFrames =
      result.fps?.fps != null && result.fps.low1 != null && result.fps.low01 != null;
    const evidence = {
      automaticGame: true,
      target: result.gameInfo?.name,
      actualFrames,
      fps: result.fps,
    };
    await writeFile(
      resolve('.cache/verification/hud-desktop/game-etw.json'),
      JSON.stringify(evidence, null, 2),
    );
    console.log(evidence);
    const hud = browser
      .contexts()[0]
      ?.pages()
      .find((p) => p.url().endsWith('#/hud'));
    if (hud)
      await hud.screenshot({
        path: resolve('.cache/verification/hud-desktop/hud-live-game.png'),
        omitBackground: true,
      });
    if (!actualFrames) throw Error('ETW 没有完整真实帧数据：' + result.fps?.message);
  } finally {
    if (renderer?.exitCode === null) renderer.kill();
    await invokeHud(page, { operation: 'configure', config: original.config }, hudSnapshotSchema);
  }
} finally {
  await browser.close();
}
