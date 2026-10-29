import './check-environment.ts';
import assert from 'node:assert/strict';
import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { z } from 'zod';

// 更新清单使用独立的 Ed25519 密钥，不能用自签名证书替代客户端已有的发布信任。
const pkg = z
  .object({ version: z.string().regex(/^\d+\.\d+\.\d+$/u) })
  .parse(JSON.parse(await readFile('package.json', 'utf8')) as unknown);
const channel = z
  .object({ repository: z.literal('surgar04/m78deguren'), publicKey: z.string() })
  .parse(JSON.parse(await readFile('src-tauri/release-channel.json', 'utf8')) as unknown);
const key = createPrivateKey(await readFile('.local/release-signing/ed25519-private.pem'));
const publicKey = createPublicKey(key);
assert.equal(
  publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64'),
  channel.publicKey,
);
const root = 'dist/desktop',
  name = `zhenjing-${pkg.version}-windows-x64.msi`;
const binary = await readFile(`${root}/${name}`);
assert.equal(binary.subarray(0, 8).toString('hex'), 'd0cf11e0a1b11ae1');
assert.ok(binary.length > 1048576 && binary.length <= 268435456);
const digest = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
const sha256 = digest(binary);
const payload = Buffer.from(
  JSON.stringify({
    appId: 'dev.zhenjing.desktop',
    version: pkg.version,
    platform: 'windows-x86_64',
    channel: 'stable',
    url: `https://github.com/${channel.repository}/releases/download/v${pkg.version}/${name}`,
    sha256,
    bytes: binary.length,
    changelog: await readFile('CHANGELOG.md', 'utf8'),
    releaseUrl: `https://github.com/${channel.repository}/releases/tag/v${pkg.version}`,
  }),
);
const signature = sign(null, payload, key);
assert.ok(verify(null, payload, publicKey, signature));
await writeFile(
  `${root}/zhenjing-update.json`,
  JSON.stringify(
    { payload: payload.toString('base64'), signature: signature.toString('base64') },
    null,
    2,
  ) + '\n',
);
const sums = [`${sha256}  ${name}`];
for (const file of ['publisher.json', 'INSTALL.md'])
  sums.push(`${digest(await readFile(`${root}/${file}`))}  ${file}`);
await writeFile(`${root}/SHA256SUMS.txt`, sums.join('\n') + '\n');
await writeFile(
  `${root}/build-info.json`,
  JSON.stringify(
    {
      version: pkg.version,
      profile: 'release',
      format: 'msi',
      publisher: 'Sur方糖',
      selfSigned: true,
      publiclyTrusted: false,
      name,
      sha256,
      bytes: binary.length,
      mainExeSha256: digest(await readFile('.cache/cargo/target/release/zhenjing.exe')),
    },
    null,
    2,
  ) + '\n',
);
console.log(`MSI ${name}\nSHA256 ${sha256}`);
