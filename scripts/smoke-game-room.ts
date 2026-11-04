import './check-environment.ts';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import {
  gameRoomSchema,
  deltaLoadoutsSchema,
  deltaStreamersSchema,
} from '../src/lib/game-room-contracts.ts';
import { hardwareSnapshotSchema } from '../src/lib/hardware-contracts.ts';
import { deltaImageSource } from '../src/features/delta/image-source.ts';

// 只连接项目专用验收档案。禁止替换真实账号、提交社区内容或修改系统设置。
const output = resolve('.cache/verification/game-room-native');
await mkdir(output, { recursive: true });
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
try {
  const context = browser.contexts()[0];
  const main = context?.pages().find((page) => page.url().includes('127.0.0.1:1420'));
  assert.ok(main && context, '缺少专用桌面预览');
  const root = await main.evaluate<string>(
    "window.__TAURI_INTERNALS__.invoke('settings_execute',{request:{operation:'snapshot'}}).then(value=>value.dataRoot)",
  );
  assert.equal(resolve(root), resolve('.cache/verification/game-room-desktop-data'));
  await main.evaluate(
    "window.__TAURI_INTERNALS__.invoke('game_room_execute',{request:{operation:'open'}})",
  );
  const deadline = Date.now() + 30000;
  while (
    !context.pages().some((page) => page.url().includes('#/delta-force')) &&
    Date.now() < deadline
  ) {
    await new Promise((done) => setTimeout(done, 200));
  }
  const room = context.pages().find((page) => page.url().includes('#/delta-force'));
  assert.ok(room, '未创建独立窗口');
  room.setDefaultTimeout(45000);
  const errors: string[] = [];
  room.on('pageerror', (cause) => errors.push(cause.message));
  const call = (request: Record<string, unknown>) =>
    room.evaluate<unknown>(
      `window.__TAURI_INTERNALS__.invoke('game_room_execute',{request:${JSON.stringify(request)}})`,
    );
  const snapshot = gameRoomSchema.parse(await call({ operation: 'snapshot' }));
  assert.match(snapshot.protectionMessage, /仅检测/u);
  await room.getByRole('heading', { name: '实时性能' }).waitFor();
  const loadouts = deltaLoadoutsSchema.parse(
    await call({ operation: 'loadouts', category: null, weapon: '', search: '', page: 1 }),
  );
  assert.ok(loadouts.data.length > 0);
  const streamers = deltaStreamersSchema.parse(
    await call({ operation: 'streamers', refresh: false }),
  );
  assert.ok(streamers.data.entries.length > 0);
  const avatar = streamers.data.entries.find((row) => row.avatar)?.avatar;
  assert.ok(avatar);
  const asset = await call({ operation: 'asset', url: deltaImageSource(avatar) });
  assert.ok(typeof asset === 'string' && asset.startsWith('data:image/png;base64,'));
  const telemetrySchema = hardwareSnapshotSchema.pick({
    status: true,
    capturedAt: true,
    metrics: true,
    gpus: true,
    samples: true,
    fps: true,
    warnings: true,
  });
  let telemetry = telemetrySchema.parse(await call({ operation: 'telemetry' }));
  const samplingDeadline = Date.now() + 45000;
  while (!telemetry.capturedAt && Date.now() < samplingDeadline) {
    await new Promise((done) => setTimeout(done, 1200));
    telemetry = telemetrySchema.parse(await call({ operation: 'telemetry' }));
  }
  assert.ok(telemetry.capturedAt, '共享硬件采样未返回');
  assert.ok(Object.keys(telemetry.metrics).length > 0);
  // 验证官方授权可以取消，且不会把尚未扫码的用户标记成已登录。
  await call({ operation: 'auth-open' });
  assert.equal(
    gameRoomSchema.parse(await call({ operation: 'snapshot' })).account.phase,
    'authorizing',
  );
  await call({ operation: 'auth-cancel' });
  assert.equal(
    gameRoomSchema.parse(await call({ operation: 'snapshot' })).account.phase,
    'disconnected',
  );
  await room.evaluate(() => document.fonts.ready);
  await room.screenshot({ path: resolve(output, 'community.png'), fullPage: true });
  assert.equal(await room.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
  await writeFile(
    resolve(output, 'result.json'),
    JSON.stringify(
      {
        passed: true,
        nativeWindow: true,
        sharedHardware: true,
        publicLoadouts: loadouts.data.length,
        publicStreamers: streamers.data.entries.length,
        avatar: true,
        authCancel: true,
        privateAccountVerified: false,
        systemWrites: false,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    '游戏空间原生窗口、共享硬件、社区数据、头像与授权取消验收通过；未使用私人账号或修改系统。',
  );
} finally {
  await browser.close();
}
