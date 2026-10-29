import './check-environment.ts';
import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
// 只收集唯一 MSI，不拼接 EXE 负载，也不运行安装器。
const profile = z.literal('release').parse(process.argv[2]);
const pkg = z
  .object({ version: z.string().regex(/^\d+\.\d+\.\d+$/u) })
  .parse(JSON.parse(await readFile('package.json', 'utf8')) as unknown);
const source = resolve('.cache/cargo/target', profile, 'bundle/msi');
const files = (await readdir(source)).filter((name) => name.endsWith('.msi'));
assert.equal(files.length, 1, 'MSI 输出不唯一，拒绝使用陈旧安装包');
const file = files[0];
assert.ok(file);
await mkdir('dist/desktop', { recursive: true });
const target = resolve('dist/desktop', `zhenjing-${pkg.version}-windows-x64.msi`);
await copyFile(resolve(source, file), target);
console.log(`MSI：${target}`);
