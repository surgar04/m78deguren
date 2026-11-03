import './check-environment.ts';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium, type Page, type Browser } from 'playwright-core';
import { z } from 'zod';
import { diagnosticSnapshotSchema } from '../src/lib/diagnostic-contracts.ts';

// 仅从刚验签、解包重建的 MSI 布局启动，所有事件/账号/路径均为 D 盘隔离夹具。
const receipt = z
  .object({ version: z.string(), passed: z.literal(true), installedDirectory: z.string() })
  .parse(JSON.parse(await readFile('.cache/verification/msi-artifact.json', 'utf8')) as unknown);
const version = z
  .object({ version: z.string() })
  .parse(JSON.parse(await readFile('package.json', 'utf8')) as unknown).version;
assert.equal(receipt.version, version);
assert.ok(resolve(receipt.installedDirectory).startsWith(resolve('.cache/verification') + sep));
const root = resolve('.cache/verification', `logging-release-${randomUUID()}`);
await mkdir(root, { recursive: true });
const port = 9257;
const native = (page: Page, request: unknown): Promise<unknown> =>
  page.evaluate(
    `window.__TAURI_INTERNALS__.invoke('diagnostics_execute',{request:${JSON.stringify(request)}})`,
  );
async function run(fill: boolean, nativeOnly = false) {
  let previousSession: string | undefined;
  if (!fill) {
    previousSession = z
      .object({ session: z.uuid() })
      .parse(
        JSON.parse(await readFile(join(root, 'logs', 'session.json'), 'utf8')) as unknown,
      ).session;
  }
  const child = spawn(join(receipt.installedDirectory, 'zhenjing.exe'), ['--data-dir', root], {
    cwd: root,
    env: {
      ...process.env,
      ZHENJING_RESTRICT_WRITES_TO_D: '1',
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
    },
    windowsHide: true,
    stdio: 'ignore',
  });
  let browser: Browser | undefined;
  try {
    if (nativeOnly) {
      // 高完整性级别的 WebView2 会忽略环境调试参数；不为验收改注册表或发行 EXE。
      // 用上次日志超过配额的真实启动场景检查轮转，强杀本次隔离实例后检查会话标记。
      let ready = false;
      for (let attempt = 0; attempt < 120; attempt++) {
        if (child.exitCode !== null) throw Error('release exited early');
        try {
          const text = await readFile(join(root, 'logs', 'zhenjing.log'), 'utf8');
          const marker = z
            .object({ session: z.uuid() })
            .parse(
              JSON.parse(await readFile(join(root, 'logs', 'session.json'), 'utf8')) as unknown,
            );
          ready =
            marker.session !== previousSession &&
            text.split(/\r?\n/u).some((line) => {
              if (!line) return false;
              const row = z
                .object({ session: z.string(), message: z.string() })
                .parse(JSON.parse(line) as unknown);
              return row.session === marker.session && row.message === '臻境已启动';
            });
        } catch {
          // 等待实际程序创建日志目录；有界轮询，不把初始化竞态当作成功。
        }
        if (ready) break;
        await new Promise<void>((done) => setTimeout(done, 500));
      }
      assert.ok(ready, 'actual MSI executable did not finish startup');
      const names = (await readdir(join(root, 'logs'))).filter(
        (name) => name.startsWith('zhenjing') && name.endsWith('.log'),
      );
      const entries: unknown[] = [];
      for (const name of names) {
        const text = await readFile(join(root, 'logs', name), 'utf8');
        for (const line of text.trim().split(/\r?\n/u)) {
          if (line) entries.push(JSON.parse(line) as unknown);
        }
      }
      const rows = z
        .array(z.object({ event: z.string(), message: z.string(), version: z.string() }))
        .parse(entries);
      assert.ok(names.length >= 2, 'actual logger did not rotate the full previous log');
      assert.ok(rows.some((row) => row.version === version && row.message === '臻境已启动'));
      if (!fill)
        assert.ok(
          rows.some(
            (row) =>
              row.event === 'session.start' && row.message.includes('上次会话未记录正常退出'),
          ),
          'forced exit was not detected',
        );
      const marker = z
        .object({ clean: z.literal(false), session: z.uuid() })
        .parse(JSON.parse(await readFile(join(root, 'logs', 'session.json'), 'utf8')) as unknown);
      assert.ok(marker.session);
      return;
    }
    for (let n = 0; n < 90; n++) {
      if (child.exitCode !== null) throw Error('release exited early');
      try {
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 1000 });
        break;
      } catch {
        await new Promise<void>((done) => setTimeout(done, 500));
      }
    }
    assert.ok(browser, 'release CDP endpoint unavailable');
    const page = browser
      .contexts()[0]
      ?.pages()
      .find((page) => page.url().includes('tauri.localhost'));
    assert.ok(page);
    await page.waitForFunction(() => Object.hasOwn(window, '__TAURI_INTERNALS__'));
    if (fill) {
      // 合成高负载只测试轮转，不触发实际工具、账号、更新或系统操作。
      for (let batch = 0; batch < 8; batch++)
        await native(page, {
          operation: 'ingest',
          entries: Array.from({ length: 64 }, () => ({
            level: 'info',
            event: 'window.event',
            operation: 'logging.verify',
            trace: randomUUID(),
            durationMs: 1,
            message: '验收'.repeat(1024),
          })),
        });
      await native(page, {
        operation: 'ingest',
        entries: [
          {
            level: 'error',
            event: 'ipc.failed',
            operation: 'logging.verify',
            trace: randomUUID(),
            durationMs: 1,
            message: 'Cookie: fixture-credential-never-share',
          },
          {
            level: 'error',
            event: 'ipc.failed',
            operation: 'logging.verify',
            trace: randomUUID(),
            durationMs: 1,
            message: 'file C:/Users/fixture-user/private.txt',
          },
        ],
      });
      const snapshot = diagnosticSnapshotSchema.parse(
        await native(page, { operation: 'read', level: 'all', search: '' }),
      );
      assert.ok(snapshot.files >= 2, 'actual logger did not rotate at 2 MiB');
      assert.ok(snapshot.entries.length <= 500);
      assert.ok(!JSON.stringify(snapshot).includes('fixture-credential-never-share'));
      assert.ok(!JSON.stringify(snapshot).includes('fixture-user'));
      for (const name of await readdir(join(root, 'logs'))) {
        if (name.startsWith('zhenjing') && name.endsWith('.log')) {
          const text = await readFile(join(root, 'logs', name), 'utf8');
          assert.ok(!text.includes('fixture-credential-never-share'));
          for (const line of text.trim().split(/\r?\n/u)) {
            if (line) JSON.parse(line);
          }
        }
      }
    } else {
      const snapshot = diagnosticSnapshotSchema.parse(
        await native(page, { operation: 'read', level: 'all', search: '' }),
      );
      assert.equal(snapshot.previousUnclean, true, 'forced exit was not detected');
    }
  } finally {
    await browser?.close();
    child.kill();
    await new Promise<void>((done) => {
      if (child.exitCode !== null || child.signalCode !== null) done();
      else child.once('exit', () => done());
    });
  }
}
const nativeOnly = process.argv.includes('--native-only');
if (nativeOnly) {
  await mkdir(join(root, 'logs'), { recursive: true });
  // 仅预置本次合成档案，不修改已有用户日志。每行仍是可校验的结构化 JSON。
  const line = JSON.stringify({
    schema: 1,
    at: new Date().toISOString(),
    session: randomUUID(),
    version,
    level: 'info',
    source: 'verification',
    event: 'fixture.previous_session',
    message: '验收'.repeat(1024),
  });
  await writeFile(join(root, 'logs', 'zhenjing.log'), `${line}\n`.repeat(400));
}
await run(true, nativeOnly);
await run(false, nativeOnly);
await writeFile(
  join(root, 'result.json'),
  JSON.stringify(
    {
      passed: true,
      version,
      mode: nativeOnly ? 'native-without-cdp' : 'full-cdp',
      checks: [
        'actual-msi-exe',
        'structured-jsonl',
        'real-rotation',
        ...(nativeOnly ? [] : ['server-redaction', 'bounded-snapshot']),
        'unclean-session-detection',
      ],
      skipped: nativeOnly ? ['cdp-ingest-and-snapshot; covered separately by Rust tests'] : [],
      systemChanges: false,
      privateAccounts: false,
    },
    null,
    2,
  ),
);
console.log(`发布版日志系统原生验收通过：${root}`);
