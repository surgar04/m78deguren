import './check-environment.ts';
import { createHash } from 'node:crypto';
import { access, copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// 仅供原生资源协议验收：导入真实自带图片/字体及之前录制的 WebM，绝不写入日常用户档案。
const root = resolve('.cache/verification/settings-app-data');
const index = resolve(root, 'settings/assets/index.json');
if (
  await access(index).then(
    () => true,
    () => false,
  )
)
  throw new Error('验收素材清单已存在，拒绝覆盖');
await mkdir(resolve(root, 'settings/assets'), { recursive: true });
const entries = [];
const sources = [
  {
    path: resolve('public/assets/settings/default-wallpaper.png'),
    kind: 'image',
    mime: 'image/png',
    extension: 'png',
  },
  { path: resolve('public/fonts/MiSansVF.ttf'), kind: 'font', mime: 'font/ttf', extension: 'ttf' },
];
const videoRoot = resolve('.cache/verification/tools-video-library');
const video = (await readdir(videoRoot).catch(() => [])).find((name) => name.endsWith('.webm'));
if (video)
  sources.push({
    path: resolve(videoRoot, video),
    kind: 'video',
    mime: 'video/webm',
    extension: 'webm',
  });
for (const source of sources) {
  const data = await readFile(source.path);
  const id = createHash('sha256').update(source.kind).update(data).digest('hex');
  await copyFile(source.path, resolve(root, `settings/assets/${id}.${source.extension}`));
  entries.push({
    id,
    kind: source.kind,
    mime: source.mime,
    extension: source.extension,
    bytes: data.length,
    name: `验收素材.${source.extension}`,
  });
}
await writeFile(index, JSON.stringify(entries, null, 2));
console.log(`已准备 ${entries.length} 项真实素材，仅用于隔离验收。`);
