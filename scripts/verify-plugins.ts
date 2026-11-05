import './check-environment.ts';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { z } from 'zod';
import { pluginViewSchema } from '../src/lib/plugin-contracts.ts';

/** 使用真正链接的独立宿主和三种语言编译产物，代理只模拟本次测试的私有存储。 */
const output = resolve('.cache/verification/plugins');
await mkdir(output, { recursive: true });
const executable = resolve('src-tauri/resources/plugin-host/zhenjing-plugin-host.exe');
const frame = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('starting'), stage: z.enum(['compiling', 'instantiating']) }),
  z.object({ kind: z.literal('ready'), ticket: z.uuid(), api: z.literal('1.0.0') }),
  z.object({
    kind: z.literal('capability'),
    sequence: z.number().int().positive(),
    request: z.string(),
  }),
  z.object({
    kind: z.literal('result'),
    id: z.uuid(),
    ok: z.boolean(),
    value: z.unknown().optional(),
    error: z.string().optional(),
  }),
]);
type Frame = z.infer<typeof frame>;
async function exercise(language: string, path: string) {
  const child = spawn(executable, [], {
    env: { TEMP: process.env.TEMP, TMP: process.env.TMP },
    cwd: output,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  const inbox: Frame[] = [];
  let pending: { resolve: (f: Frame) => void; reject: (e: Error) => void } | undefined;
  let failure: Error | undefined;
  let buffer = Buffer.alloc(0);
  function fail(error: Error) {
    failure = error;
    pending?.reject(error);
    pending = undefined;
    child.kill();
  }
  child.on('error', fail);
  child.on('exit', (code) => fail(new Error(`宿主退出 ${code}`)));
  child.stdout.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    if (buffer.length > 2 * 1024 * 1024) {
      fail(new Error('帧超过上限'));
      return;
    }
    for (let line = buffer.indexOf(10); line >= 0; line = buffer.indexOf(10)) {
      try {
        const value = frame.parse(JSON.parse(buffer.subarray(0, line).toString('utf8')));
        buffer = buffer.subarray(line + 1);
        if (value.kind === 'starting') {
          console.log(`${language} ${value.stage}`);
          continue;
        }
        if (pending) {
          const waiter = pending;
          pending = undefined;
          waiter.resolve(value);
        } else inbox.push(value);
      } catch {
        fail(new Error('宿主返回无效协议'));
        return;
      }
    }
  });
  function receive(): Promise<Frame> {
    const value = inbox.shift();
    if (value) return Promise.resolve(value);
    if (failure) return Promise.reject(failure);
    return new Promise((done, reject) => {
      const timer = setTimeout(() => {
        pending = undefined;
        reject(new Error(`${language} 宿主等待超时`));
        child.kill();
      }, 60000);
      pending = {
        resolve: (f) => {
          clearTimeout(timer);
          done(f);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      };
    });
  }
  const send = (value: unknown) => child.stdin.write(JSON.stringify(value) + '\n');
  const bytes = await readFile(path),
    ticket = randomUUID();
  send({ bytes: bytes.length, memoryMb: 256, fuel: 500000000, ticket });
  child.stdin.write(bytes);
  let count = 0;
  const calls: string[] = [];
  async function invoke(command: string, input: unknown = null, denied = false) {
    const id = randomUUID();
    send({ id, command, input });
    for (;;) {
      const response = await receive();
      if (response.kind === 'capability') {
        const request = z
          .object({ method: z.string(), params: z.unknown() })
          .strict()
          .parse(JSON.parse(response.request));
        calls.push(request.method);
        if (denied) {
          send({ sequence: response.sequence, ok: false, error: 'PLUGIN_PERMISSION_DENIED' });
          continue;
        }
        const params = z
          .object({ key: z.literal('counter'), value: z.number().optional() })
          .strict()
          .parse(request.params);
        if (request.method === 'storage.get')
          send({ sequence: response.sequence, ok: true, value: count });
        else if (request.method === 'storage.put') {
          assert.equal(typeof params.value, 'number');
          count = z.number().parse(params.value);
          send({ sequence: response.sequence, ok: true, value: null });
        } else throw new Error(`插件尝试未预期能力 ${request.method}`);
      } else {
        assert.equal(response.kind, 'result');
        if (response.kind !== 'result') throw new Error('意外握手');
        assert.equal(response.id, id);
        return response;
      }
    }
  }
  try {
    const ready = await receive();
    assert.equal(ready.kind, 'ready');
    if (ready.kind === 'ready') assert.equal(ready.ticket, ticket);
    console.log(`${language} 组件握手通过`);
    const initial = await invoke('render');
    assert.equal(initial.ok, true);
    pluginViewSchema.parse(initial.value);
    assert.equal((await invoke('increment')).ok, true);
    assert.equal(count, 1);
    const next = await invoke('render');
    assert.equal(next.ok, true);
    assert.ok(JSON.stringify(next.value).includes('"value":"1"'));
    const migration = await invoke('migrate', { from: 1, to: 2 });
    assert.equal(migration.ok, true);
    assert.deepEqual(migration.value, { dataVersion: 2 });
    const denied = await invoke('render', null, true);
    assert.equal(denied.ok, false);
    console.log(`${language} 渲染、存储、迁移与权限拒绝通过`);
    return {
      language,
      bytes: bytes.length,
      calls: calls.length,
      render: true,
      storage: true,
      migration: true,
      permissionDenied: true,
    };
  } finally {
    child.kill();
  }
}
const results = [];
for (const language of process.argv.length > 2
  ? z.array(z.enum(['rust', 'typescript', 'csharp'])).parse(process.argv.slice(2))
  : ['rust', 'typescript', 'csharp'])
  results.push(
    await exercise(
      language,
      process.env['ZHENJING_PLUGIN_TEST_COMPONENT'] ??
        join('.cache/plugins-build', `org.zhenjing.example-${language}`, 'component.wasm'),
    ),
  );
await writeFile(
  join(output, 'host-report.json'),
  JSON.stringify({ date: new Date().toISOString(), results }, null, 2),
);
console.log(`已通过 ${results.length} 种语言的真实宿主验收：渲染、私有存储、迁移协议、权限拒绝。`);
