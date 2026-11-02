import './check-environment.ts';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, writeFile, lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

/** 固定上游快照并记录逐文件摘要。只复制源码及许可，不复制其依赖、缓存或 Git 配置。 */
const source = resolve('.cache/upstream/folia-major');
const commit = execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], {
  encoding: 'utf8',
}).trim();
if (commit !== '42ff951c9106d0b59a7683ca6dceea019760b339') throw Error('Folia 来源提交不匹配');
const files: Record<string, string> = {};
for (const [target, names] of [
  [
    'integrations/folia-engine/upstream',
    [
      'src',
      'shared',
      'assets',
      'public',
      'LICENSE',
      'package.json',
      'dev/i18n',
      'dev/icuFolia',
      'dev/nebbia',
      'dev/pinyin',
      'electron/modSystem/foliumShared.json',
    ],
  ],
  ['native/music-host/upstream', ['electron', 'shared', 'LICENSE']],
] as const) {
  await mkdir(target, { recursive: true });
  for (const name of names)
    await cp(join(source, name), join(target, name), { recursive: true, force: false });
  const walk = async (path: string, original: string): Promise<void> => {
    const info = await lstat(original);
    if (info.isSymbolicLink()) throw Error('上游快照不能包含链接');
    if (info.isFile()) {
      const expected = createHash('sha256')
        .update(await readFile(original))
        .digest('hex');
      const actual = createHash('sha256')
        .update(await readFile(path))
        .digest('hex');
      if (actual !== expected) throw Error(`冻结源码被修改，拒绝覆盖：${path}`);
      files[path.replaceAll('\\', '/')] = actual;
      return;
    }
    for (const item of await readdir(original, { withFileTypes: true })) {
      const file = join(path, item.name);
      if (item.isSymbolicLink()) throw Error('上游快照不能包含链接');
      await walk(file, join(original, item.name));
    }
  };
  // 只检查清单中的来源，不能把本地 node_modules 缓存并入冻结源码或摘要清单。
  for (const name of names) await walk(join(target, name), join(source, name));
}
await writeFile(
  'integrations/folia-source.json',
  JSON.stringify(
    {
      repository: 'https://github.com/chthollyphile/folia-major',
      commit,
      license: 'AGPL-3.0',
      files,
    },
    null,
    2,
  ) + '\n',
);
console.log(`已固定 Folia ${commit}，${Object.keys(files).length} 个源文件。`);
