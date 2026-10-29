import './check-environment.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';

// 只读检查实际 PE 导入表，不运行安装器，也不假设验收机已安装的 VC++ 运行库会存在于用户电脑。
const profile = z.enum(['debug', 'release']).parse(process.argv[2]);
const targets = [
  `.cache/cargo/target/${profile}/zhenjing.exe`,
  '.cache/cargo/target/release/zhenjing.exe.msi-actions.dll',
  'src-tauri/resources/hardware-monitor/ZhenjingMonitor.exe',
  'native/hardware-monitor/Hud/Collector/ECPFrames-x64.exe',
];
const results = targets.map((path) => {
  const output = execFileSync(
    resolve('.tools/msvc/bin/dumpbin.exe'),
    ['/dependents', resolve(path)],
    {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    },
  );
  const dependencies = [...output.matchAll(/^\s+([\w.-]+\.dll)\s*$/gimu)].map((row) => row[1]);
  assert.ok(dependencies.length > 0, `无法读取实际 PE 依赖：${path}`);
  assert.ok(
    dependencies.every(
      (name) => name !== undefined && !/^(?:vcruntime|msvcp|msvcr|concrt)/iu.test(name),
    ),
    `发现需要额外 VC++ 安装的直接依赖：${path}`,
  );
  return { path, dependencies };
});
await mkdir('.cache/verification', { recursive: true });
await writeFile('.cache/verification/release-dependencies.json', JSON.stringify(results, null, 2));
console.log('MSI 目录校验组件、主程序及硬件助手的实际 PE 直接依赖检查通过。');
