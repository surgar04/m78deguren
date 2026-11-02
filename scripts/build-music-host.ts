import { cp, mkdir, readFile, writeFile, readdir, lstat, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { musicHostSources } from './music-inputs.ts';

/** 从同一 pnpm 锁文件创建无链接的独立生产目录；发布版不读取开发机 store。 */
const root = resolve(import.meta.dirname, '..');
if (process.env.ZHENJING_RESTRICT_WRITES_TO_D !== '1' || !root.startsWith('D:\\'))
  throw Error('请使用 dev.ps1 入口');
const sources = await musicHostSources(root);
const stage = join(root, '.cache/music-host-flat');
await mkdir(stage, { recursive: true });
const lock = await readFile(join(root, 'pnpm-lock.yaml'), 'utf8');
const importer = lock.match(
  /^[ ]{2}native\/music-host:\r?\n([\s\S]*?)(?=^[ ]{2}\S|^packages:)/mu,
)?.[1];
const packages = lock.indexOf('\npackages:');
if (!importer || packages < 0) throw Error('音乐组件的锁定依赖缺失');
await writeFile(
  join(stage, 'pnpm-lock.yaml'),
  lock.slice(0, lock.indexOf('importers:')) +
    'importers:\n\n  .:\n' +
    importer +
    lock.slice(packages),
);
await cp(join(root, 'native/music-host/package.json'), join(stage, 'package.json'));
if (!process.argv.includes('--refresh-only'))
  await new Promise<void>((done, fail) => {
    const child = spawn(
      process.execPath,
      [
        join(root, '.tools/pnpm/bin/pnpm.cjs'),
        'install',
        '--prod',
        '--frozen-lockfile',
        '--ignore-workspace',
        '--ignore-scripts',
        '--node-linker=hoisted',
      ],
      { cwd: stage, stdio: 'inherit', windowsHide: true },
    );
    child.once('error', fail);
    child.once('exit', (code) => (code === 0 ? done() : fail(Error(`音乐依赖部署失败：${code}`))));
  });
const output = join(root, 'src-tauri/resources/music-host');
await mkdir(output, { recursive: true });
if (!process.argv.includes('--refresh-only'))
  await cp(join(stage, 'node_modules'), join(output, 'node_modules'), {
    recursive: true,
    filter: (source) =>
      !/[\\/]@lox-audioserver[\\/]node-librespot[\\/]prebuilds[\\/](?!win32-x64-msvc(?:[\\/]|$))/u.test(
        source,
      ),
  });
for (const name of await readdir(join(root, 'native/music-host'))) {
  if (
    name === 'upstream' ||
    (name.endsWith('.ts') && name !== 'tsconfig.json') ||
    name === 'package.json'
  )
    await cp(join(root, 'native/music-host', name), join(output, name), { recursive: true });
}
if (!process.argv.includes('--refresh-only')) await cp(process.execPath, join(output, 'node.exe'));
const files: Record<string, string> = {};
const prebuilds = join(output, 'node_modules/@lox-audioserver/node-librespot/prebuilds');
for (const name of await readdir(prebuilds))
  if (name !== 'win32-x64-msvc') {
    const target = resolve(prebuilds, name);
    if (!target.startsWith(output + '\\') || !/^D:\\/u.test(target))
      throw Error('原生预编译模块清理范围无效');
    await rm(target, { recursive: true, force: true });
  }
const pending: { path: string; relative: string }[] = [];
async function scan(folder: string, prefix = ''): Promise<void> {
  for (const info of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, info.name),
      relative = prefix + info.name;
    if (info.isSymbolicLink()) throw Error(`音乐发布目录不能包含链接：${relative}`);
    if (info.isDirectory()) await scan(path, relative + '/');
    else if (info.isFile() && relative !== 'manifest.json') pending.push({ path, relative });
  }
}
await scan(output);
// 大量小文件不逐个串行等待磁盘；限制八个读取，避免一次 Promise.all 打开数万个句柄。
let next = 0;
await Promise.all(
  Array.from({ length: 8 }, async () => {
    for (;;) {
      const item = pending[next++];
      if (!item) return;
      // 读取前再次检查，不能把枚举后被替换的链接写进发布清单。
      if (!(await lstat(item.path)).isFile()) throw Error('音乐组件文件类型在校验期间发生变化');
      files[item.relative] = createHash('sha256')
        .update(await readFile(item.path))
        .digest('hex');
    }
  }),
);
const currentSources = await musicHostSources(root);
if (JSON.stringify(sources) !== JSON.stringify(currentSources))
  throw Error('音乐来源在部署期间发生变化，请重试；不生成不一致的发布清单。');
await writeFile(
  join(output, 'manifest.json'),
  JSON.stringify(
    {
      schema: 1,
      node: process.version,
      sources,
      files: Object.fromEntries(
        Object.entries(files).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
      ),
    },
    null,
    2,
  ) + '\n',
);
console.log(`音乐组件已部署并校验 ${Object.keys(files).length} 个文件。`);
