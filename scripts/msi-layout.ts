import assert from 'node:assert/strict';
import { copyFile, mkdir, readdir, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
export interface MsiLayoutTables {
  files: string[][];
  directories: string[][];
  components: string[][];
}
/** 按实际 MSI 表恢复安装布局；不执行 MSI、自定义动作、注册表或快捷方式。 */
export async function materializeMsiLayout(
  table: MsiLayoutTables,
  extracted: string,
  destination: string,
) {
  const payloads = new Map<string, string>();
  async function walk(path: string): Promise<void> {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      assert.ok(!entry.isSymbolicLink());
      const child = join(path, entry.name);
      if (entry.isDirectory()) await walk(child);
      else {
        assert.ok(!payloads.has(entry.name), `MSI 文件标识不唯一：${entry.name}`);
        payloads.set(entry.name, child);
      }
    }
  }
  await walk(extracted);
  const directories = new Map(table.directories.map((row) => [row[0], row]));
  const components = new Map(table.components.map((row) => [row[0], row[1]]));
  const targetName = (value: string) => {
    const name = (value.split(':')[0] ?? '').split('|').at(-1) ?? '';
    assert.ok(name && name !== '..' && !/[<>:"/\\|?*\p{Cc}]/u.test(name));
    return name;
  };
  function parts(id: string, seen = new Set<string>()): string[] {
    if (id === 'INSTALLDIR') return [];
    assert.ok(!seen.has(id) && seen.size < 32, 'MSI 目录存在循环或过深');
    seen.add(id);
    const row = directories.get(id);
    assert.ok(row?.[1] && row[2]);
    const name = targetName(row[2]);
    return [...parts(row[1], seen), ...(name === '.' ? [] : [name])];
  }
  const root = resolve(destination);
  await mkdir(root, { recursive: true });
  const installed = new Map<string, string>();
  for (const row of table.files) {
    const [id, name, , component, size] = row;
    assert.ok(id && name && component && size);
    const directory = components.get(component);
    assert.ok(directory);
    const segments = [...parts(directory), targetName(name)];
    const path = resolve(root, ...segments);
    assert.ok(path.startsWith(root + sep));
    const source = payloads.get(id) ?? payloads.get(targetName(name));
    assert.ok(source, `MSI 缺少 CAB 文件：${id}`);
    assert.equal(
      (await stat(source)).size,
      Number(size),
      `MSI 表与 CAB 长度不一致：${basename(path)}`,
    );
    await mkdir(dirname(path), { recursive: true });
    await copyFile(source, path);
    const relative = segments.join('/');
    assert.ok(!installed.has(relative));
    installed.set(relative, path);
  }
  return installed;
}
