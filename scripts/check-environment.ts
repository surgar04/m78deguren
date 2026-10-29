import { isAbsolute, resolve } from 'node:path';

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
  if (process.env['ZHENJING_RESTRICT_WRITES_TO_D'] !== '1') {
    console.error('开发写入保护未启用，请通过 dev.ps1 运行。发布版不依赖此开发变量。');
    process.exit(1);
  }
  const invalid = required.filter((key) => {
    const value = process.env[key];
    return !value || !isAbsolute(value) || !/^D:[\\/]/i.test(value);
  });
  if (!/^D:[\\/]/i.test(root) || invalid.length > 0) {
    console.error(
      `请通过 powershell -NoProfile -File .\\dev.ps1 <命令> 运行。非 D 盘环境: ${invalid.join(', ')}`,
    );
    process.exit(1);
  }
}
