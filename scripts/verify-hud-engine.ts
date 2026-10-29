import './check-environment.ts';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import presets from '../src/features/hud/upstream-presets.json' with { type: 'json' };
import { hudRenderSchema } from '../src/lib/hud-contracts.ts';

// 真实单文件助手的管道验收：控制消息只发送一次，防止“必须不断写 stdin 才能采样”的回归。
// 不启用帧采样、驱动或外部网络源；所有解包、缓存与证据均在隔离 D 盘目录。
const root = resolve('.cache/verification/hud-engine-data');
const env: NodeJS.ProcessEnv = { ...process.env, ZHENJING_HUD_DIR: root };
for (const key of [
  'TEMP',
  'TMP',
  'APPDATA',
  'LOCALAPPDATA',
  'USERPROFILE',
  'DOTNET_BUNDLE_EXTRACT_BASE_DIR',
]) {
  const path = resolve(root, key);
  await mkdir(path, { recursive: true });
  env[key] = path;
}
const child = spawn(
  resolve('src-tauri/resources/hardware-monitor/ZhenjingMonitor.exe'),
  [String(process.pid), 'safe'],
  { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
);
const lines = createInterface({ input: child.stdout });
const evidence: { samples: number; render: boolean; catalog: boolean; elapsedMs: number } = {
  samples: 0,
  render: false,
  catalog: false,
  elapsedMs: 0,
};
const start = Date.now();
let error = '';
child.stderr.on('data', (data: Buffer) => {
  error = (error + data.toString()).slice(-2048);
});
child.stdin.write(
  JSON.stringify({
    enabled: true,
    active: true,
    frameSampling: false,
    samplingMs: 1000,
    locale: 'zh-CN',
    settings: { profiles: presets, activeProfileId: 'system.memory', triggers: [] },
    external: {},
    gamePaths: [],
    includeProcesses: [],
    excludeProcesses: [],
  }) + '\n',
);
try {
  await new Promise<void>((accept, reject) => {
    const timer = setTimeout(
      () => reject(Error('硬件助手未在期限内返回真实采样：' + JSON.stringify(evidence) + error)),
      60000,
    );
    child.once('error', reject);
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(Error(`硬件助手提前退出 ${code}：${error}`));
    });
    lines.on('line', (line) => {
      try {
        assert.ok(line.length <= 2097152);
        const value: unknown = JSON.parse(line);
        if (!value || typeof value !== 'object') return;
        if ('type' in value && ['inventory', 'capabilities', 'error'].includes(String(value.type)))
          console.log('助手阶段', value.type, Date.now() - start, 'ms');
        if ('type' in value && value.type === 'sample') {
          evidence.samples++;
          if (evidence.samples === 1)
            console.log('首个真实硬件样本，耗时', Date.now() - start, 'ms');
        }
        if (
          'type' in value &&
          value.type === 'hud' &&
          'data' in value &&
          value.data &&
          typeof value.data === 'object'
        ) {
          if ('catalog' in value.data) evidence.catalog = true;
          if ('error' in value.data) console.error('HUD 原生诊断', value.data.error);
          if ('render' in value.data) {
            hudRenderSchema.parse(value.data.render);
            evidence.render = true;
          }
        }
        if (evidence.samples >= 3 && evidence.render && evidence.catalog) {
          clearTimeout(timer);
          accept();
        }
      } catch (cause) {
        clearTimeout(timer);
        reject(cause instanceof Error ? cause : new Error('硬件助手返回的数据无效'));
      }
    });
  });
  evidence.elapsedMs = Date.now() - start;
  await writeFile(
    resolve('.cache/verification/hud-engine-result.json'),
    JSON.stringify(evidence, null, 2),
  );
  console.log('HUD 助手真实采样、真实模板渲染、变量目录及空闲 stdin 验证通过。', evidence);
} finally {
  lines.close();
  child.stdin.end();
  child.kill();
}
