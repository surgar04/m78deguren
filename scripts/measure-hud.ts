import './check-environment.ts';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { chromium } from 'playwright-core';
import { z } from 'zod';
import { hudSnapshotSchema } from '../src/lib/hud-contracts.ts';
import { invokeHud } from './hud-native-smoke.ts';
import { footprintSchema } from '../src/lib/settings-contracts.ts';

const sampleSchema = z.object({
  logical: z.number().positive(),
  processes: z.array(
    z.object({ id: z.number(), cpu: z.number(), privateBytes: z.number(), workingSet: z.number() }),
  ),
});
// 静态只读命令：取当前工作区实际桌面进程及其子树，不采集命令行、窗口标题等私人内容。
const probe = String.raw`$all=Get-CimInstance Win32_Process; $ids=[Collections.Generic.HashSet[int]]::new();
foreach($p in $all){if($p.Name -eq 'zhenjing.exe' -and $p.ExecutablePath -eq (Join-Path (Get-Location) '.cache\cargo\target\debug\zhenjing.exe')){[void]$ids.Add([int]$p.ProcessId)}}
do{$added=$false;foreach($p in $all){if($ids.Contains([int]$p.ParentProcessId)-and $ids.Add([int]$p.ProcessId)){$added=$true}}}while($added)
$rows=@(foreach($idValue in $ids){try{$p=Get-Process -Id $idValue -ErrorAction Stop;@{id=$p.Id;cpu=$p.CPU;privateBytes=$p.PrivateMemorySize64;workingSet=$p.WorkingSet64}}catch{}})
ConvertTo-Json -Depth 4 -Compress -InputObject @{logical=[Environment]::ProcessorCount;processes=$rows}`;
function sample() {
  return sampleSchema.parse(
    JSON.parse(
      execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', probe], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 15000,
      }),
    ) as unknown,
  );
}
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
try {
  const page = browser
    .contexts()[0]
    ?.pages()
    .find((p) => !p.url().endsWith('#/hud'));
  if (!page) throw Error('请先启动隔离桌面端');
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
  assert.ok(
    resolve(footprint.dataRoot).startsWith(resolve('.cache/verification') + sep),
    '只能测量隔离验收档案',
  );
  // invokeHud 的快照会短暂续租预览；采样前等待租约过期。
  const original = await invokeHud(page, { operation: 'snapshot' }, hudSnapshotSchema);
  const results = [];
  let renderer: ReturnType<typeof spawn> | undefined;
  try {
    await page.goto(page.url().split('#')[0] + '#/settings');
    for (const mode of ['off', 'normal', 'game', 'game-etw'] as const) {
      if (mode === 'game-etw')
        renderer = spawn(resolve('.cache/verification/hud-render.exe'), [], { stdio: 'ignore' });
      await invokeHud(
        page,
        {
          operation: 'configure',
          config: {
            ...original.config,
            enabled: mode !== 'off',
            mode: mode === 'game' ? 'game' : mode === 'game-etw' ? 'auto' : 'normal',
            frames: mode === 'game-etw',
            includeProcesses:
              mode === 'game-etw' ? ['hud-render.exe'] : original.config.includeProcesses,
            powerEvents: false,
            queue: ['system.memory'],
            activeProfile: 'system.memory',
          },
        },
        hudSnapshotSchema,
      );
      await page.waitForTimeout(8000);
      const before = sample(),
        start = performance.now();
      await page.waitForTimeout(15000);
      const after = sample();
      if (mode === 'game-etw') {
        const actual = (await invokeHud(page, { operation: 'snapshot' }, hudSnapshotSchema)).live;
        assert.ok(
          actual.game && actual.fps?.enabled && actual.fps.fps !== null,
          'ETW 性能测量必须实际采集到帧事件',
        );
      }
      const seconds = (performance.now() - start) / 1000;
      const map = new Map(before.processes.map((p) => [p.id, p.cpu]));
      const cpu = after.processes.reduce(
        (n, p) => n + Math.max(0, p.cpu - (map.get(p.id) ?? 0)),
        0,
      );
      const entry = {
        mode,
        seconds,
        processes: after.processes.length,
        stableProcesses:
          before.processes.length === after.processes.length &&
          after.processes.every((p) => map.has(p.id)),
        cpuCorePercent: (cpu / seconds) * 100,
        cpuMachinePercent: (cpu / seconds / after.logical) * 100,
        privateMiB: after.processes.reduce((n, p) => n + p.privateBytes, 0) / 1048576,
        workingSetMiB: after.processes.reduce((n, p) => n + p.workingSet, 0) / 1048576,
      };
      results.push(entry);
      console.log(entry);
    }
    await writeFile(
      resolve('.cache/verification/hud-desktop/performance.json'),
      JSON.stringify(
        {
          environment:
            'debug desktop + development server; game-etw uses actual private D3D11 renderer',
          results,
        },
        null,
        2,
      ),
    );
  } finally {
    if (renderer?.exitCode === null) renderer.kill();
    await invokeHud(page, { operation: 'configure', config: original.config }, hudSnapshotSchema);
  }
} finally {
  await browser.close();
}
