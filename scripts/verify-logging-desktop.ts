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
async function run(fill: boolean) {
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
      if (child.exitCode !== null) done();
      else child.once('exit', () => done());
    });
  }
}
await run(true);
await run(false);
await writeFile(
  join(root, 'result.json'),
  JSON.stringify(
    {
      passed: true,
      version,
      checks: [
        'actual-msi-exe',
        'structured-jsonl',
        'real-rotation',
        'server-redaction',
        'bounded-snapshot',
        'unclean-session-detection',
      ],
      systemChanges: false,
      privateAccounts: false,
    },
    null,
    2,
  ),
);
console.log(`发布版日志系统原生验收通过：${root}`);
