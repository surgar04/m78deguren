import './check-environment.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID, createPublicKey, verify } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve, join, sep, isAbsolute } from 'node:path';
import { z } from 'zod';
import { msiExecutable } from './installer-format.ts';
import { materializeMsiLayout } from './msi-layout.ts';

const pkg = z
  .object({ version: z.string() })
  .parse(JSON.parse(await readFile('package.json', 'utf8')) as unknown);
const root = resolve('dist/desktop'),
  name = `zhenjing-${pkg.version}-windows-x64.msi`,
  installer = join(root, name);
assert.deepEqual(
  (await readdir(root)).sort(),
  [
    'build-info.json',
    'publisher.json',
    'SHA256SUMS.txt',
    'zhenjing-update.json',
    'INSTALL.md',
    name,
  ].sort(),
  '分发目录只能保留当前 MSI 及其配套元数据',
);
// 发布说明必须已替换实际版本，避免 Markdown 格式化改变占位符后静默漏替换。
const instructions = await readFile(join(root, 'INSTALL.md'), 'utf8');
assert.ok(instructions.includes(name) && instructions.includes(`臻境 ${pkg.version}`));
assert.doesNotMatch(instructions, /\{\{VERSION\}\}|__VERSION__|\*\*VERSION\*\*/u);
const hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
for (const line of (await readFile(join(root, 'SHA256SUMS.txt'), 'utf8')).trim().split(/\r?\n/u)) {
  const match = /^([a-f0-9]{64}) {2}([\p{L}\p{N}_.-]+)$/u.exec(line);
  assert.ok(match?.[1] && match[2]);
  assert.equal(hash(await readFile(join(root, match[2]))), match[1]);
}
const binary = await readFile(installer);
assert.equal(binary.subarray(0, 8).toString('hex'), 'd0cf11e0a1b11ae1');
const temporary = resolve('.cache/verification', `msi-extract-${randomUUID()}`);
assert.ok(temporary.startsWith(resolve('.cache/verification') + sep));
await mkdir(temporary, { recursive: false });
const seven = process.env['ZHENJING_SEVEN_ZIP'] ?? 'D:/7-Zip/7z.exe';
assert.match(seven, /^[dD]:[\\/]/u);
const run = (file: string, args: string[]) =>
  execFileSync(file, args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 120000,
    maxBuffer: 2 * 1024 * 1024,
  });
async function find(path: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    assert.ok(!entry.isSymbolicLink());
    assert.doesNotMatch(entry.name, /\.(?:pfx|p12|pem|secret)$/iu);
    const child = join(path, entry.name);
    if (entry.isDirectory()) result.push(...(await find(child)));
    else if (entry.name === 'MainExe' || entry.name === 'zhenjing.exe') result.push(child);
  }
  return result;
}
try {
  const metadata = join(temporary, 'msi.json');
  run('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    resolve('scripts/inspect-msi.ps1'),
    '-Path',
    installer,
    '-Output',
    metadata,
  ]);
  const row = z.object({ cells: z.array(z.string()) }).transform((value) => value.cells);
  const table = z
    .object({
      properties: z.record(z.string(), z.string()),
      files: z.array(row),
      directories: z.array(row),
      components: z.array(row),
      registry: z.array(row),
      template: z.string(),
    })
    .parse(JSON.parse(await readFile(metadata, 'utf8')) as unknown);
  assert.equal(table.properties['ProductVersion'], pkg.version);
  assert.equal(table.properties['Manufacturer'], 'Sur方糖');
  assert.equal(table.properties['ALLUSERS'], undefined);
  assert.match(table.template, /x64/u);
  assert.ok(table.registry.every((value) => value[0] === '1'));
  assert.ok(
    table.files.some((value) => value[0] === 'ProfileSeed'),
    'MSI 缺少 Unicode 档案引导种子',
  );
  assert.ok(
    table.registry.some((value) => value[2] === 'DataDir'),
    'MSI 缺少迁移后的数据位置登记',
  );
  assert.ok(
    table.properties['SecureCustomProperties']?.split(';').includes('PROFILEDIR'),
    'PROFILEDIR 必须为安全的 MSI 公共属性',
  );
  // HUD 的上游许可必须进入实际 MSI，不能仅存在于工作区或分发目录旁。
  for (const id of ['HudLicenseFile', 'EcpLicenseFile', 'InterLicenseFile'])
    assert.ok(
      table.files.some((value) => value[0] === id),
      `安装包缺少 HUD 许可：${id}`,
    );
  // 7-Zip 在 Windows 默认输出本地代码页；显式 UTF-8，避免中文工程路径被误判越界。
  const listing = run(seven, ['l', '-slt', '-sccUTF-8', installer]);
  for (const match of listing.matchAll(/^Path = (.+)\r?$/gmu)) {
    const path = match[1]?.trim();
    if (!path || path === installer) continue;
    assert.ok(
      !isAbsolute(path) && !path.includes(':') && !path.split(/[\\/]/u).includes('..'),
      '安装包包含越界路径',
    );
  }
  const extracted = join(temporary, 'files');
  run(seven, ['x', '-sccUTF-8', installer, `-o${extracted}`, '-y']);
  const images = await find(extracted);
  const installedDirectory = resolve('.cache/verification', `installed-layout-${randomUUID()}`);
  const installed = await materializeMsiLayout(table, extracted, installedDirectory);
  const componentManifest = z.object({ files: z.record(z.string(), z.string()) });
  for (const [manifestPath, componentRoot] of [
    ['src-tauri/resources/hardware-monitor/manifest.json', 'components/monitor'],
    ['src-tauri/resources/windows-bridge/manifest.json', 'components/windows-bridge'],
  ] as const) {
    const manifest = componentManifest.parse(
      JSON.parse(await readFile(manifestPath, 'utf8')) as unknown,
    );
    for (const [name, digest] of Object.entries(manifest.files)) {
      const file = installed.get(`${componentRoot}/${name}`);
      assert.ok(file, `MSI 未安装组件：${name}`);
      assert.equal(hash(await readFile(file)), digest, `包内组件摘要不匹配：${name}`);
    }
  }
  for (const name of [
    'licenses/MiSans-License.pdf',
    'licenses/Sysinfo-MIT.txt',
    'licenses/VC-Redist-License.rtf',
  ])
    assert.ok(installed.has(name), `MSI 缺少许可：${name}`);
  await writeFile(
    '.cache/verification/installed-layout.json',
    JSON.stringify({ path: installedDirectory, files: [...installed.keys()] }, null, 2),
  );
  assert.equal(images.length, 1);
  const image = images[0];
  assert.ok(image);
  const linked = await readFile('.cache/cargo/target/release/zhenjing.exe');
  assert.equal(
    hash(await readFile(image)),
    hash(msiExecutable(linked)),
    '除 Tauri 的三字节安装类型标记外，主程序必须与实际 Release 完全一致',
  );
  const channel = z
    .object({ publicKey: z.string() })
    .parse(JSON.parse(await readFile('src-tauri/release-channel.json', 'utf8')) as unknown);
  const publicKey = createPublicKey({
    key: Buffer.concat([
      Buffer.from('302a300506032b6570032100', 'hex'),
      Buffer.from(channel.publicKey, 'base64'),
    ]),
    type: 'spki',
    format: 'der',
  });
  const envelope = z
    .object({ payload: z.string(), signature: z.string() })
    .parse(JSON.parse(await readFile(join(root, 'zhenjing-update.json'), 'utf8')) as unknown);
  const payload = Buffer.from(envelope.payload, 'base64');
  assert.ok(verify(null, payload, publicKey, Buffer.from(envelope.signature, 'base64')));
  const release = z
    .object({ url: z.string(), version: z.string(), sha256: z.string(), bytes: z.number() })
    .parse(JSON.parse(payload.toString()) as unknown);
  assert.equal(release.version, pkg.version);
  assert.equal(
    release.url,
    `https://github.com/surgar04/m78deguren/releases/download/v${pkg.version}/${name}`,
  );
  assert.equal(release.sha256, hash(binary));
  assert.equal(release.bytes, binary.length);
  await writeFile(
    '.cache/verification/msi-artifact.json',
    JSON.stringify(
      {
        version: pkg.version,
        passed: true,
        format: 'msi',
        sha256: hash(binary),
        bytes: binary.length,
        linkedExeSha256: hash(linked),
        embeddedExeSha256: hash(await readFile(image)),
        publisher: 'Sur方糖',
        selfSigned: true,
        publiclyTrusted: false,
        updateManifestVerified: true,
        msiTablesVerified: true,
        explicitComponentsVerified: true,
        installedDirectory,
        installedFileCount: installed.size,
      },
      null,
      2,
    ),
  );
  console.log('MSI 数据库、更新清单签名、公开校验和及包内实际程序一致性检查通过。');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
