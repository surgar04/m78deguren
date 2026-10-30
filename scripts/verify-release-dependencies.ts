import './check-environment.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';

// 只读检查实际 PE 导入表，不运行安装器，也不假设验收机已安装的 VC++ 运行库会存在于用户电脑。
const profile = z.enum(['debug', 'release']).parse(process.argv[2]);
const targets = [
  `.cache/cargo/target/${profile}/zhenjing.exe`,
  '.cache/cargo/target/release/zhenjing.exe.msi-actions.dll',
  'src-tauri/resources/hardware-monitor/runtime/ZhenjingMonitor.exe',
  'native/hardware-monitor/Hud/Collector/ECPFrames-x64.exe',
];
const runtime = 'src-tauri/resources/hardware-monitor/runtime';
const runtimeFiles = await readdir(runtime);
const runtimeNames = new Set(runtimeFiles.map((name) => name.toLowerCase()));
for (const name of runtimeFiles) {
  if (/\.(?:dll|exe)$/iu.test(name)) {
    // 使用实际大小写，包含 .NET 原生宿主/CLR/本地 CRT；托管 DLL 也校验 PE 表。
    const path = `${runtime}/${name}`;
    if (!targets.includes(path)) targets.push(path);
  }
}
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
  if (dependencies.length === 0) {
    // .NET Core 的 x64 托管映像可以没有原生导入表；必须同时证实 CLR 头和空导入表，
    // 不能将 dumpbin 解析失败或普通损坏文件当作“无依赖”放行。
    const headers = execFileSync(
      resolve('.tools/msvc/bin/dumpbin.exe'),
      ['/headers', resolve(path)],
      { encoding: 'utf8', windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024 },
    );
    assert.match(headers, /^\s+0 \[\s+0\] RVA \[size\] of Import Directory\s*$/mu);
    assert.match(
      headers,
      /^\s+(?=[\dA-F]*[1-9A-F])[\dA-F]+ \[\s+[\dA-F]+\] RVA \[size\] of COM Descriptor Directory\s*$/mu,
      `零导入映像缺少有效 CLR 头：${path}`,
    );
  }
  assert.ok(
    dependencies.every(
      (name) =>
        name !== undefined &&
        (!/^(?:vcruntime|msvcp|msvcr|concrt)/iu.test(name) || runtimeNames.has(name.toLowerCase())),
    ),
    `发现需要额外 VC++ 安装的直接依赖：${path}`,
  );
  return { path, dependencies };
});
await mkdir('.cache/verification', { recursive: true });
await writeFile('.cache/verification/release-dependencies.json', JSON.stringify(results, null, 2));
console.log('MSI 目录校验组件、主程序及硬件助手的实际 PE 直接依赖检查通过。');
