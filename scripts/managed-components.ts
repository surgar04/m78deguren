import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';

/** 验收复用实际发布 DLL 与同一加载器，避免测试继续走已删除的动态编译分支。 */
export async function injectManagedBridge(source: string): Promise<string> {
  const directory = resolve('src-tauri/resources/windows-bridge');
  const path = resolve(directory, 'Zhenjing.Windows.dll');
  const manifest = z
    .object({ files: z.record(z.string(), z.string()) })
    .parse(JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8')) as unknown);
  const digest = createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
  assert.equal(digest, manifest.files['Zhenjing.Windows.dll']);
  const loader = (await readFile('src-tauri/src/services/managed-loader.ps1', 'utf8'))
    .replaceAll('__MANAGED_PATH_BASE64__', Buffer.from(path).toString('base64'))
    .replaceAll('__MANAGED_SHA256__', digest);
  return source.replaceAll('# __MANAGED_BRIDGE__', loader);
}
