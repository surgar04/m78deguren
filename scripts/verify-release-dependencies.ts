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
    // .NET Core 托管映像和纯资源 DLL 可以没有原生导入表；分别验证 CLR 头，
    // 或零代码/零入口加有效资源目录，不能把解析失败当作“无依赖”放行。
    const headers = execFileSync(
      resolve('.tools/msvc/bin/dumpbin.exe'),
      ['/headers', resolve(path)],
      { encoding: 'utf8', windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024 },
    );
    assert.match(headers, /^\s+0 \[\s+0\] RVA \[size\] of Import Directory\s*$/mu);
    const managed =
      /^\s+(?=[\dA-F]*[1-9A-F])[\dA-F]+ \[\s+[\dA-F]+\] RVA \[size\] of COM Descriptor Directory\s*$/mu.test(
        headers,
      );
    const resourceOnly =
      /^\s+0 size of code\s*$/mu.test(headers) &&
      /^\s+0 entry point\s*$/mu.test(headers) &&
      /^\s+(?=[\dA-F]*[1-9A-F])[\dA-F]+ \[\s+[\dA-F]+\] RVA \[size\] of Resource Directory\s*$/mu.test(
        headers,
      );
    assert.ok(managed || resourceOnly, `零导入映像既非托管程序集，也非纯资源 DLL：${path}`);
  }
  assert.ok(
    dependencies.every(
      (name) =>
        name !== undefined &&
        // msvcrt.dll / msvcp_win.dll 是 Windows 组件；额外 VC++ 运行库带版本数字。
        (!/^(?:vcruntime|msvcp|msvcr|concrt)\d/iu.test(name) ||
          runtimeNames.has(name.toLowerCase())),
    ),
    `发现需要额外 VC++ 安装的直接依赖：${path}`,
  );
  return { path, dependencies };
});
await mkdir('.cache/verification', { recursive: true });
await writeFile('.cache/verification/release-dependencies.json', JSON.stringify(results, null, 2));
console.log('MSI 目录校验组件、主程序及硬件助手的实际 PE 直接依赖检查通过。');
