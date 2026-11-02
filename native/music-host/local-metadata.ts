import { parseFile } from 'music-metadata';
import { stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';

/** 只读原生选择器登记的文件；封面有硬上限，不把整首音频读成内存 Blob。 */
export async function inspectLocalFile(path: string) {
  const file = await stat(path);
  if (!file.isFile() || file.size > 8 * 1024 ** 3) throw Error('音频不是普通文件或超过扫描上限');
  const metadata = await parseFile(path, { duration: true });
  const cover = metadata.common.picture?.find((item) => item.data.byteLength <= 4 * 1024 ** 2);
  const lyrics = metadata.common.lyrics?.find((item) => typeof item.text === 'string')?.text ?? '';
  return {
    title: (metadata.common.title || basename(path, extname(path))).slice(0, 4096),
    artists: (metadata.common.artists ?? (metadata.common.artist ? [metadata.common.artist] : []))
      .slice(0, 64)
      .map((value) => value.slice(0, 4096)),
    album: (metadata.common.album ?? '').slice(0, 4096),
    durationMs: Math.round((metadata.format.duration ?? 0) * 1000),
    cover: cover ? { mime: cover.format, data: Buffer.from(cover.data).toString('base64') } : null,
    lyrics: lyrics.slice(0, 4_000_000),
  };
}
