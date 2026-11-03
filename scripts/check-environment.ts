import { isAbsolute, resolve, relative } from 'node:path';
import { readFileSync } from 'node:fs';

const root = resolve(import.meta.dirname, '..');
const required = [
  'TEMP',
  'TMP',
  'APPDATA',
  'LOCALAPPDATA',
  'USERPROFILE',
  'CARGO_HOME',
  'RUSTUP_HOME',
  'CARGO_TARGET_DIR',
  'PNPM_HOME',
  'npm_config_cache',
  'TAURI_BUNDLER_TOOLS_DIR',
  'ZHENJING_DATA_DIR',
] as const;

if (process.platform === 'win32') {
  const restricted = process.env['ZHENJING_RESTRICT_WRITES_TO_D'] === '1';
  let workspace = false;
  if (
    !restricted &&
    process.env['ZHENJING_RESTRICT_WRITES_TO_D'] === '0' &&
    process.env['ZHENJING_WORKSPACE_ROOT'] &&
    resolve(process.env['ZHENJING_WORKSPACE_ROOT']).toLowerCase() === root.toLowerCase()
  ) {
    try {
      const profile: unknown = JSON.parse(
        readFileSync(resolve(root, '.local/workspace-profile.json'), 'utf8'),
      );
      workspace =
        typeof profile === 'object' &&
        profile !== null &&
        'repository' in profile &&
        profile.repository === 'https://github.com/surgar04/m78deguren.git' &&
        'branch' in profile &&
        profile.branch === 'codex/develop' &&
        'root' in profile &&
        typeof profile.root === 'string' &&
        resolve(profile.root).toLowerCase() === root.toLowerCase();
    } catch {
      workspace = false;
    }
  }
  if (!restricted && !workspace) {
    console.error('开发写入保护未启用，请通过 dev.ps1 运行。发布版不依赖此开发变量。');
    process.exit(1);
  }
  const invalid = required.filter((key) => {
    const value = process.env[key];
    if (!value || !isAbsolute(value)) return true;
    if (restricted) return !/^D:[\\/]/i.test(value);
    const child = relative(root, resolve(value));
    return child.startsWith('..') || isAbsolute(child);
  });
  if ((restricted && !/^D:[\\/]/i.test(root)) || invalid.length > 0) {
    console.error(
      `请通过 powershell -NoProfile -File .\\dev.ps1 <命令> 运行。${restricted ? '非 D 盘路径' : '越过开发工作区的路径'}: ${invalid.join(', ')}`,
    );
    process.exit(1);
  }
}
