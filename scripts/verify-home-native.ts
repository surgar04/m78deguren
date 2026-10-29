import './check-environment.ts';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { homeRuntimeSchema } from '../src/lib/home-contracts.ts';

// 仅编译/读取图标、读取自身 API、测试关闭与父进程退出看门狗；从不启用游戏模式或 Win 钩子。
const root = resolve('.cache/verification/home-native');
await mkdir(root, { recursive: true });
const script = resolve(root, `helper-${randomUUID()}.ps1`);
const source = (await readFile('src-tauri/src/services/home/native.ps1', 'utf8')).replace(
  '// __HOME_CS__',
  (await readFile('src-tauri/src/services/home/native.cs', 'utf8')) +
    '\n' +
    (await readFile('src-tauri/src/services/home/wheel.cs', 'utf8')),
);
await writeFile(script, '\ufeff' + source);
async function once(operation: string, args: string[]) {
  return new Promise<string>((resolveOutput, reject) => {
    const child = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        script,
        '-Operation',
        operation,
        '-ArgumentJson',
        JSON.stringify(args),
      ],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let output = '',
      errors = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: unknown) => {
      if (typeof chunk === 'string') output += chunk;
      if (output.length > 1048576) child.kill();
    });
    child.stderr.on('data', (chunk: unknown) => {
      if (typeof chunk === 'string') errors += chunk;
      if (errors.length > 32768) child.kill();
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('只读原生探测超时'));
    }, 30000);
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(errors.slice(0, 6000)));
      else resolveOutput(output);
    });
  });
}
const icon = z
  .string()
  .startsWith('data:image/png;base64,')
  .parse(JSON.parse(await once('home-icon', [resolve('.tools/node/node.exe')])));
const png = Buffer.from(icon.slice('data:image/png;base64,'.length), 'base64');
assert.ok(png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
assert.ok(png.readUInt32BE(16) > 0 && png.readUInt32BE(16) <= 256);
const probe = z
  .object({
    priority: z.number().int().positive(),
    created: z.literal(true),
    sameUser: z.literal(true),
    io: z.number().nullable(),
    memory: z.number().nullable(),
    ecoSupported: z.boolean(),
  })
  .parse(JSON.parse(await once('home-probe', [])));
const runtimeRoot = resolve(root, `runtime-${randomUUID()}`);
await mkdir(runtimeRoot);
const child = spawn(
  'powershell.exe',
  [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    script,
    '-Operation',
    'home-runtime',
    '-ArgumentJson',
    JSON.stringify([String(process.pid), runtimeRoot]),
  ],
  { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
);
const events: Record<string, unknown>[] = [],
  errors: string[] = [];
let buffer = '';
child.stdout.setEncoding('utf8');
child.stderr.setEncoding('utf8');
child.stderr.on('data', (value: unknown) => {
  if (typeof value === 'string') errors.push(value.slice(0, 2000));
});
child.stdout.on('data', (value: unknown) => {
  if (typeof value !== 'string') return;
  buffer += value;
  if (buffer.length > 32768) {
    child.kill();
    return;
  }
  for (;;) {
    const end = buffer.indexOf('\n');
    if (end < 0) break;
    const line = buffer.slice(0, end);
    buffer = buffer.slice(end + 1);
    try {
      events.push(z.record(z.string(), z.unknown()).parse(JSON.parse(line)));
    } catch {
      errors.push('无效原生输出');
    }
  }
});
async function wait(predicate: () => boolean) {
  const started = Date.now();
  while (!predicate()) {
    if (child.exitCode !== null) throw new Error(`原生助手提前退出：${errors.join('\n')}`);
    if (Date.now() - started > 30000) throw new Error('原生助手等待超时');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
try {
  await wait(() => events.some((value) => value['kind'] === 'status'));
  const id = randomUUID();
  child.stdin.write(
    JSON.stringify({
      id,
      manual: null,
      autoGameMode: false,
      disableWinInGame: false,
      paths: [],
      directories: [],
      names: [],
      launched: [],
    }) + '\n',
  );
  await wait(() => events.some((value) => value['kind'] === 'ack' && value['id'] === id));
  for (const event of events.filter((value) => value['kind'] === 'status')) {
    const state = homeRuntimeSchema.parse(event['runtime']);
    assert.ok(state.ready);
    assert.equal(state.effective, false);
    assert.equal(state.winKeyBlocked, false);
    assert.equal(state.suppressedCount, 0);
  }
  const stop = randomUUID();
  child.stdin.write(JSON.stringify({ id: stop, stop: true }) + '\n');
  await wait(() => events.some((value) => value['kind'] === 'ack' && value['id'] === stop));
  child.stdin.end();
  await new Promise<void>((resolveExit, reject) => {
    if (child.exitCode !== null) {
      resolveExit();
      return;
    }
    const timer = setTimeout(() => reject(new Error('原生助手未正常关闭')), 8000);
    child.once('close', () => {
      clearTimeout(timer);
      resolveExit();
    });
  });
  assert.equal(child.exitCode, 0);
  assert.deepEqual(
    JSON.parse(await readFile(resolve(runtimeRoot, 'process-recovery.json'), 'utf8')),
    [],
  );
  // 独立测试父进程意外结束：保持控制管道打开，确保退出确实来自看门狗，而不是 stdin EOF。
  const owner = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
    windowsHide: true,
    stdio: 'ignore',
  });
  const ownerPid = owner.pid;
  assert.ok(ownerPid);
  const orphanRoot = resolve(root, `orphan-${randomUUID()}`);
  await mkdir(orphanRoot);
  const orphan = spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      script,
      '-Operation',
      'home-runtime',
      '-ArgumentJson',
      JSON.stringify([String(ownerPid), orphanRoot]),
    ],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  let orphanOutput = '',
    orphanError = '';
  orphan.stdout.setEncoding('utf8');
  orphan.stderr.setEncoding('utf8');
  orphan.stdout.on('data', (value: unknown) => {
    if (typeof value === 'string') orphanOutput += value;
  });
  orphan.stderr.on('data', (value: unknown) => {
    if (typeof value === 'string') orphanError += value;
  });
  try {
    const started = Date.now();
    while (!orphanOutput.includes('"kind":"status"')) {
      if (orphan.exitCode !== null || Date.now() - started > 30000)
        throw new Error(`看门狗启动失败：${orphanError.slice(0, 2000)}`);
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
    owner.kill();
    const stopped = Date.now();
    while (orphan.exitCode === null) {
      if (Date.now() - stopped > 10000) throw new Error('父进程退出后原生助手未释放');
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
    assert.equal(orphan.exitCode, 0);
    assert.deepEqual(
      JSON.parse(await readFile(resolve(orphanRoot, 'process-recovery.json'), 'utf8')),
      [],
    );
  } finally {
    owner.kill();
    orphan.stdin.end();
    if (orphan.exitCode === null) orphan.kill();
  }
  const evidence = {
    iconBytes: png.length,
    iconWidth: png.readUInt32BE(16),
    probe,
    readOnlyRuntime: true,
    gracefulShutdown: true,
    parentExitWatchdog: true,
    noSuppression: true,
    noWinKeyHook: true,
  };
  await writeFile(resolve(root, 'result.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  child.stdin.end();
  if (child.exitCode === null) child.kill();
}
