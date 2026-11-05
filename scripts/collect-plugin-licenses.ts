import './check-environment.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { z } from 'zod';

/** 从锁定的真实 Cargo 依赖保留原始许可与 SPDX 清单，不把开发机绝对路径写入安装包。 */
const output = resolve('src-tauri/resources/plugin-host/licenses');
const metadata = z
  .object({
    packages: z.array(
      z.object({
        name: z.string().regex(/^[\w-]+$/u),
        version: z.string().regex(/^[\w.+-]+$/u),
        manifest_path: z.string(),
        license: z.string().nullable(),
        license_file: z.string().nullable(),
        repository: z.string().nullable(),
      }),
    ),
  })
  .parse(
    JSON.parse(
      execFileSync(
        'cargo',
        [
          'metadata',
          '--manifest-path',
          'native/plugin-host/Cargo.toml',
          '--locked',
          '--format-version',
          '1',
          '--filter-platform',
          'x86_64-pc-windows-msvc',
        ],
        { encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
      ),
    ),
  );
await mkdir(output, { recursive: true });
const wasmtime = metadata.packages.find((dependency) => dependency.name === 'wasmtime');
assert.ok(wasmtime, '锁定依赖缺少 Wasmtime');
const llvmLicense = await readFile(join(dirname(wasmtime.manifest_path), 'LICENSE'));
const inventory: {
  name: string;
  version: string;
  license: string | null;
  repository: string | null;
  files: string[];
}[] = [];
for (const dependency of metadata.packages) {
  if (dependency.name === 'zhenjing-plugin-host') continue;
  const root = dirname(dependency.manifest_path);
  assert.equal(root.slice(0, 3).toLowerCase(), 'd:\\', '仅从 D 盘依赖读取许可');
  const candidates = (await readdir(root, { withFileTypes: true }))
    .filter(
      (file) =>
        file.isFile() && /^(?:licen[cs]e|copying|notice|copyright)(?:[._-]|$)/iu.test(file.name),
    )
    .map((file) => file.name);
  if (dependency.license_file && !candidates.includes(dependency.license_file))
    candidates.push(dependency.license_file);
  const files: string[] = [];
  for (const name of candidates.sort()) {
    const source = resolve(root, name),
      rel = relative(root, source);
    assert.ok(rel && !rel.startsWith(`..${sep}`) && rel !== '..' && !rel.includes(':'));
    const target = join(`${dependency.name}-${dependency.version}`, rel);
    const destination = resolve(output, target);
    await mkdir(dirname(destination), { recursive: true });
    const original = await readFile(source);
    const previous = await readFile(destination).catch(() => null);
    if (!previous?.equals(original)) await copyFile(source, destination);
    files.push(target.replaceAll('\\', '/'));
  }
  // 部分 Wasmtime/Cranelift 子 crate 发布时只声明 SPDX，原许可位于同版本 Wasmtime 根目录。
  // 保留该上游原文，不能用普通 Apache-2.0 文本丢掉 LLVM exception。
  if (!files.length && dependency.license === 'Apache-2.0 WITH LLVM-exception') {
    const common = 'shared/Apache-2.0-WITH-LLVM-exception.txt';
    await mkdir(join(output, 'shared'), { recursive: true });
    const destination = join(output, common);
    if (!(await readFile(destination).catch(() => null))?.equals(llvmLicense))
      await writeFile(destination, llvmLicense);
    files.push(common);
  }
  assert.ok(files.length, `依赖缺少可分发的原始许可：${dependency.name}`);
  inventory.push({
    name: dependency.name,
    version: dependency.version,
    license: dependency.license,
    repository: dependency.repository,
    files,
  });
}
inventory.sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`, 'en'));
const text =
  JSON.stringify({ component: 'zhenjing-plugin-host', dependencies: inventory }, null, 2) + '\n';
const path = join(output, 'dependencies.json');
if ((await readFile(path, 'utf8').catch(() => '')) !== text) await writeFile(path, text);
console.log(`插件宿主已保留 ${inventory.length} 项依赖的许可声明及其原始许可文件。`);
