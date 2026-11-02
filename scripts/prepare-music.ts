import './check-environment.ts';
import { readFile, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { z } from 'zod';
import { musicHostSources, musicFrontendSources } from './music-inputs.ts';

const root = resolve(import.meta.dirname, '..');
async function run(args: string[]) {
  await new Promise<void>((done, fail) => {
    const child = spawn(process.execPath, args, { cwd: root, windowsHide: true, stdio: 'inherit' });
    child.once('error', fail);
    child.once('exit', (code) => (code === 0 ? done() : fail(Error(`音乐准备失败：${code}`))));
  });
}
async function held(path: string) {
  try {
    return z
      .object({ sources: z.record(z.string(), z.string()) })
      .parse(JSON.parse(await readFile(resolve(root, path), 'utf8')) as unknown).sources;
  } catch {
    return null;
  }
}
const frontend = await musicFrontendSources(root),
  frontHeld = await held('public/music-engine/build-input.json');
if (JSON.stringify(frontend) !== JSON.stringify(frontHeld))
  await run([
    join(root, '.tools/pnpm/bin/pnpm.cjs'),
    '--filter',
    '@zhenjing/folia-engine',
    'build',
  ]);
const backend = await musicHostSources(root),
  backHeld = await held('src-tauri/resources/music-host/manifest.json');
let ready = true;
try {
  await access(resolve(root, 'src-tauri/resources/music-host/node.exe'));
} catch {
  ready = false;
}
if (!ready || JSON.stringify(backend) !== JSON.stringify(backHeld)) {
  const refresh =
    ready &&
    backHeld?.['pnpm-lock.yaml'] === backend['pnpm-lock.yaml'] &&
    backHeld?.['native/music-host/package.json'] === backend['native/music-host/package.json'];
  await run(['scripts/build-music-host.ts', ...(refresh ? ['--refresh-only'] : [])]);
}
