import './check-environment.ts';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile, lstat } from 'node:fs/promises';
import { resolve, posix } from 'node:path';
import { z } from 'zod';

/** 固定安装相对路径决定组件 GUID，确保后续 MSI 升级/修复不会随构建机目录改变身份。 */
const key = (value: string) =>
  createHash('sha256').update(value.toLowerCase()).digest('hex').slice(0, 28);
const guid = (value: string) => {
  const hash = createHash('sha256')
    .update(`dev.zhenjing.desktop/msi/${value.toLowerCase()}`)
    .digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-8${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
};
const xml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
const manifestSchema = z.object({
  files: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/u)),
});
interface Entry {
  destination: string;
  source: string;
}
const entries: Entry[] = [];
for (const [sourceRoot, destinationRoot, manifestPath] of [
  [
    'src-tauri/resources/hardware-monitor/runtime',
    'components/monitor',
    'src-tauri/resources/hardware-monitor/manifest.json',
  ],
  [
    'src-tauri/resources/windows-bridge',
    'components/windows-bridge',
    'src-tauri/resources/windows-bridge/manifest.json',
  ],
] as const) {
  const manifest = manifestSchema.parse(
    JSON.parse(await readFile(manifestPath, 'utf8')) as unknown,
  );
  for (const [name, expected] of Object.entries(manifest.files).sort(([a], [b]) =>
    a.localeCompare(b, 'en'),
  )) {
    assert.ok(
      !name.startsWith('/') &&
        !name.includes('\\') &&
        name
          .split('/')
          .every((part) => /^[a-zA-Z0-9_.-]+$/u.test(part) && part !== '.' && part !== '..'),
    );
    const source = resolve(sourceRoot, name),
      stat = await lstat(source);
    assert.ok(stat.isFile() && !stat.isSymbolicLink());
    assert.equal(
      createHash('sha256')
        .update(await readFile(source))
        .digest('hex'),
      expected,
      `组件与清单不一致：${name}`,
    );
    entries.push({ source, destination: posix.join(destinationRoot, name) });
  }
  if (destinationRoot.endsWith('windows-bridge'))
    entries.push({
      source: resolve(manifestPath),
      destination: posix.join(destinationRoot, 'manifest.json'),
    });
}
const template = await readFile('src-tauri/installer/installer.wxs', 'utf8');
const licenseEntries: Entry[] = [];
for (const name of await readdir('src-tauri/resources/licenses')) {
  if (template.includes(`resources\\licenses\\${name}"`)) continue;
  licenseEntries.push({
    source: resolve('src-tauri/resources/licenses', name),
    destination: posix.join('licenses', name),
  });
}
const ids: string[] = [];
function component(entry: Entry) {
  const id = `Managed_${key(entry.destination)}`;
  ids.push(id);
  return `<Component Id="${id}" Guid="${guid(entry.destination)}" Win64="yes"><File Id="Payload_${key(entry.destination)}" Name="${xml(posix.basename(entry.destination))}" Source="${xml(entry.source)}" Checksum="yes" /><RegistryValue Root="HKCU" Key="Software\\SurFangTang\\Zhenjing\\Components" Name="${id}" Type="string" Value="[ProductVersion]" KeyPath="yes" /></Component>`;
}
function directory(path: string): string {
  const id = `ManagedDir_${key(path)}`,
    cleanup = `ManagedCleanup_${key(path)}`;
  ids.push(cleanup);
  const files = entries
    .filter((entry) => posix.dirname(entry.destination) === path)
    .map(component)
    .join('\n');
  const children = [
    ...new Set(
      entries
        .filter((entry) => entry.destination.startsWith(`${path}/`))
        .map((entry) => entry.destination.slice(path.length + 1).split('/')[0])
        .filter((part): part is string => !!part)
        .filter((part) =>
          entries.some((entry) => entry.destination.startsWith(`${path}/${part}/`)),
        ),
    ),
  ].sort();
  return `<Directory Id="${id}" Name="${xml(posix.basename(path))}">${files}${children.map((child) => directory(`${path}/${child}`)).join('\n')}<Component Id="${cleanup}" Guid="${guid(path + '/directory')}" Win64="yes"><RemoveFolder Id="Remove_${key(path)}" On="uninstall" /><RegistryValue Root="HKCU" Key="Software\\SurFangTang\\Zhenjing\\Components" Name="${cleanup}" Type="integer" Value="1" KeyPath="yes" /></Component></Directory>`;
}
const directories = directory('components');
const licenses = `<DirectoryRef Id="LicensesDir">${licenseEntries.map(component).join('\n')}</DirectoryRef>`;
const refs = ids.map((id) => `<ComponentRef Id="${id}" />`).join('\n');
assert.equal(new Set(entries.map((entry) => entry.destination.toLowerCase())).size, entries.length);
const generated = template
  .replace('__COMPONENT_DIRECTORIES__', directories)
  .replace('__ADDITIONAL_LICENSES__', licenses)
  .replace('__COMPONENT_REFS__', refs)
  .replaceAll('__PROJECT_ROOT__', xml(resolve('.')));
assert.ok(!/__COMPONENT_|__ADDITIONAL_/u.test(generated));
await writeFile('.cache/msi/installer.wxs', generated);
await writeFile(
  '.cache/msi/installed-files.json',
  JSON.stringify(
    [...entries, ...licenseEntries].map((entry) => entry.destination),
    null,
    2,
  ),
);
console.log(`MSI 显式组件：${entries.length} 个文件，补全 ${licenseEntries.length} 份许可。`);
