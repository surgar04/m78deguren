import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export async function musicHostSources(root: string): Promise<Record<string, string>> {
  const names = ['pnpm-lock.yaml', 'scripts/build-music-host.ts', 'scripts/music-inputs.ts'];
  async function walk(folder: string): Promise<void> {
    for (const entry of await readdir(resolve(root, folder), { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const name = join(folder, entry.name).replaceAll('\\', '/');
      if (entry.isSymbolicLink()) throw Error('音乐组件来源不能包含链接');
      if (entry.isDirectory()) await walk(name);
      else names.push(name);
    }
  }
  await walk('native/music-host');
  const records: Record<string, string> = {};
  for (const name of names.sort())
    records[name] = createHash('sha256')
      .update(await readFile(resolve(root, name)))
      .digest('hex');
  return records;
}
export async function musicFrontendSources(root: string): Promise<Record<string, string>> {
  const names = [
    'pnpm-lock.yaml',
    'integrations/folia-source.json',
    'src/lib/music-contracts.ts',
    'scripts/music-inputs.ts',
  ];
  for (const entry of await readdir(resolve(root, 'integrations/folia-engine'), {
    withFileTypes: true,
  }))
    if (entry.isFile()) names.push(`integrations/folia-engine/${entry.name}`);
  const records: Record<string, string> = {};
  for (const name of names.sort())
    records[name] = createHash('sha256')
      .update(await readFile(resolve(root, name)))
      .digest('hex');
  return records;
}
/** 冻结快照与本项目的传输补丁分离：构建前逐文件验证，不允许“还原”要求下悄悄改写渲染器。 */
export async function verifyMusicSnapshot(root: string): Promise<void> {
  const raw: unknown = JSON.parse(
    await readFile(resolve(root, 'integrations/folia-source.json'), 'utf8'),
  );
  const { z } = await import('zod');
  const entries = Object.entries(
    z.object({ files: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/u)) }).parse(raw).files,
  );
  let cursor = 0;
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      while (cursor < entries.length) {
        const entry = entries[cursor++];
        if (!entry) continue;
        const [name, expected] = entry;
        if (
          !/^(integrations\/folia-engine|native\/music-host)\/upstream\//u.test(name) ||
          name.split('/').includes('..')
        )
          throw Error('音乐快照路径无效');
        const actual = createHash('sha256')
          .update(await readFile(resolve(root, name)))
          .digest('hex');
        if (actual !== expected) throw Error(`音乐快照摘要不一致：${name}`);
      }
    }),
  );
}
