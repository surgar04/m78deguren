import './check-environment.ts';
import { existsSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const tools = [
  ['Node', '.tools/node/node.exe', ['--version']],
  ['pnpm', '.tools/node/node.exe', [resolve(root, '.tools/pnpm/bin/pnpm.cjs'), '--version']],
  ['Rust', '.tools/cargo/bin/rustc.exe', ['--version']],
  ['Cargo', '.tools/cargo/bin/cargo.exe', ['--version']],
] as const;
for (const [name, binary, args] of tools) {
  const path = resolve(root, binary);
  if (!existsSync(path)) throw new Error(`缺少 ${name}: ${path}`);
  const result = spawnSync(path, [...args], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(`${name}: ${result.stderr}`);
  const entry = name === 'pnpm' ? resolve(root, '.tools/pnpm/bin/pnpm.cjs') : path;
  console.log(`${name}: ${result.stdout.trim()} (${realpathSync(entry)})`);
}
for (const relative of [
  '.tools/msvc/bin/link.exe',
  '.tools/msvc/bin/cl.exe',
  '.tools/winsdk/bin/rc.exe',
  '.tools/winsdk/lib/um/kernel32.lib',
]) {
  const path = resolve(root, relative);
  if (!existsSync(path)) throw new Error(`缺少 Windows 编译组件: ${path}`);
  console.log(`OK: ${path}`);
}
for (const key of [
  'TEMP',
  'APPDATA',
  'LOCALAPPDATA',
  'PNPM_HOME',
  'CARGO_HOME',
  'RUSTUP_HOME',
  'CARGO_TARGET_DIR',
  'TAURI_BUNDLER_TOOLS_DIR',
  'ZHENJING_DATA_DIR',
  'ZHENJING_RESTRICT_WRITES_TO_D',
]) {
  console.log(`${key}=${process.env[key] ?? '(unset)'}`);
}
