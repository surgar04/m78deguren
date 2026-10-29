import './check-environment.ts';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFile, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { chromium } from 'playwright-core';
import { z } from 'zod';
import { hudSnapshotSchema } from '../src/lib/hud-contracts.ts';
import { footprintSchema } from '../src/lib/settings-contracts.ts';
import { invokeHud } from './hud-native-smoke.ts';

/** 创建独立且静音的真实 Windows 媒体会话；只对包含随机标识的本次会话发控制指令。 */
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
const wav = resolve('.cache/verification', `hud-silent-${randomUUID()}.wav`);
let fixture: ReturnType<typeof spawn> | undefined;
try {
  const context = browser.contexts()[0],
    page = context?.pages().find((p) => !p.url().endsWith('#/hud'));
  if (!context || !page) throw Error('隔离桌面端未启动');
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
  let original = await invokeHud(page, { operation: 'snapshot' }, hudSnapshotSchema);
  // 默认空结构不代表 Windows 已确认没有会话；先等待 WinRT 返回实际状态，避免干扰用户播放器。
  for (let attempt = 0; attempt < 30 && !original.live.media?.status; attempt++) {
    await page.waitForTimeout(250);
    original = await invokeHud(page, { operation: 'snapshot' }, hudSnapshotSchema);
  }
  assert.ok(
    original.live.media?.status && !original.live.media.error,
    'Windows 媒体接口未就绪，停止控制测试。',
  );
  if (original.live.media?.available)
    throw Error('已有用户媒体会话，停止本次控制测试，避免干扰播放器。');
  try {
    // 15 秒 PCM 静音波形，属于测试夹具，不进入应用资源或生产数据。
    const size = 44100 * 2 * 15,
      bytes = Buffer.alloc(size + 44);
    bytes.write('RIFF');
    bytes.writeUInt32LE(size + 36, 4);
    bytes.write('WAVEfmt ', 8);
    bytes.writeUInt32LE(16, 16);
    bytes.writeUInt16LE(1, 20);
    bytes.writeUInt16LE(1, 22);
    bytes.writeUInt32LE(44100, 24);
    bytes.writeUInt32LE(88200, 28);
    bytes.writeUInt16LE(2, 32);
    bytes.writeUInt16LE(16, 34);
    bytes.write('data', 36);
    bytes.writeUInt32LE(size, 40);
    await writeFile(wav, bytes);
    const title = `HUD silent ${randomUUID()}`;
    let stderr = '';
    fixture = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        resolve('native/hud-tests/media-fixture.ps1'),
      ],
      {
        env: { ...process.env, HUD_TEST_AUDIO: wav, HUD_TEST_TITLE: title },
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe'],
      },
    );
    fixture.stderr?.on(
      'data',
      (data: Buffer) => (stderr = (stderr + data.toString()).slice(-2048)),
    );
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
        },
      },
      hudSnapshotSchema,
    );
    let live = original.live;
    for (let attempt = 0; attempt < 120; attempt++) {
      live = (await invokeHud(page, { operation: 'snapshot' }, hudSnapshotSchema)).live;
      if (live.media?.title === title && live.media.status === 'playing' && live.scene === '@media')
        break;
      if (fixture.exitCode !== null) throw Error('静音媒体夹具提前退出：' + stderr);
      await page.waitForTimeout(250);
    }
    assert.ok(
      live.media?.title === title && live.media.status === 'playing' && live.scene === '@media',
      '未收到本次真实媒体会话及轮播',
    );
    await invokeHud(page, { operation: 'media', action: 'play-pause' }, z.null());
    for (let attempt = 0; attempt < 40; attempt++) {
      live = (await invokeHud(page, { operation: 'snapshot' }, hudSnapshotSchema)).live;
      if (live.media?.title === title && live.media.status === 'paused') break;
      await page.waitForTimeout(250);
    }
    assert.equal(live.media?.status, 'paused');
    const hud = context.pages().find((p) => p.url().endsWith('#/hud'));
    if (hud)
      await hud.screenshot({
        path: resolve('.cache/verification/hud-desktop/hud-media.png'),
        omitBackground: true,
      });
    const result = {
      passed: true,
      realWindowsSession: true,
      carousel: true,
      playPause: true,
      durationSeconds: live.media?.durationSeconds,
    };
    await writeFile(
      resolve('.cache/verification/hud-desktop/media.json'),
      JSON.stringify(result, null, 2),
    );
    console.log(result);
  } finally {
    if (fixture?.exitCode === null) fixture.kill();
    await invokeHud(page, { operation: 'configure', config: original.config }, hudSnapshotSchema);
  }
} finally {
  await rm(wav, { force: true });
  await browser.close();
}
