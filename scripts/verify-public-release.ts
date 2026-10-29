import './check-environment.ts';
import assert from 'node:assert/strict';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { z } from 'zod';

// 手动发布后的只读核对，不需要令牌：latest、全部资产摘要、远端清单签名必须同时一致。
const repo = 'surgar04/m78deguren';
const version = z
  .object({ version: z.string().regex(/^\d+\.\d+\.\d+$/u) })
  .parse(JSON.parse(await readFile('package.json', 'utf8')) as unknown).version;
const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
  headers: { Accept: 'application/vnd.github+json' },
  signal: AbortSignal.timeout(30000),
  redirect: 'error',
});
assert.ok(response.ok, `GitHub latest 尚不可用：HTTP ${response.status}`);
const release = z
  .object({
    tag_name: z.string(),
    html_url: z.string(),
    draft: z.boolean(),
    prerelease: z.boolean(),
    assets: z.array(
      z.object({ name: z.string(), size: z.number(), digest: z.string().nullable().optional() }),
    ),
  })
  .parse(await response.json());
assert.equal(
  release.tag_name,
  `v${version}`,
  `发布标签必须为 v${version}，当前为 ${release.tag_name}；否则签名下载地址会返回 404。`,
);
assert.equal(release.html_url, `https://github.com/${repo}/releases/tag/v${version}`);
assert.equal(release.draft, false);
assert.equal(release.prerelease, false);
const names = [
  `zhenjing-${version}-windows-x64.msi`,
  'zhenjing-update.json',
  'SHA256SUMS.txt',
  'publisher.json',
  'build-info.json',
  'INSTALL.md',
];
for (const name of names) {
  const bytes = await readFile(`dist/desktop/${name}`),
    asset = release.assets.find((asset) => asset.name === name);
  assert.ok(asset, `Release 缺少 ${name}`);
  assert.equal(asset.size, bytes.length);
  assert.equal(
    asset.digest,
    `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    `远端资产摘要不一致：${name}`,
  );
}
let url = new URL(`https://github.com/${repo}/releases/latest/download/zhenjing-update.json`),
  envelope: unknown;
for (let redirect = 0; redirect < 8; redirect++) {
  assert.ok(
    url.protocol === 'https:' &&
      [
        'github.com',
        'release-assets.githubusercontent.com',
        'objects.githubusercontent.com',
      ].includes(url.hostname),
    '更新清单重定向越过 GitHub 白名单',
  );
  const result = await fetch(url, { signal: AbortSignal.timeout(30000), redirect: 'manual' });
  if ([301, 302, 303, 307, 308].includes(result.status)) {
    const location = result.headers.get('location');
    assert.ok(location);
    url = new URL(location, url);
    continue;
  }
  assert.ok(result.ok, `公开更新清单尚不可用：HTTP ${result.status}`);
  const bytes = await result.bytes();
  assert.ok(bytes.length <= 131072);
  envelope = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
  break;
}
const signed = z
  .object({ payload: z.string().max(100000), signature: z.string().max(128) })
  .strict()
  .parse(envelope);
const channel = z
  .object({ publicKey: z.string() })
  .parse(JSON.parse(await readFile('src-tauri/release-channel.json', 'utf8')) as unknown);
const key = createPublicKey({
  key: Buffer.concat([
    Buffer.from('302a300506032b6570032100', 'hex'),
    Buffer.from(channel.publicKey, 'base64'),
  ]),
  format: 'der',
  type: 'spki',
});
assert.ok(
  verify(null, Buffer.from(signed.payload, 'base64'), key, Buffer.from(signed.signature, 'base64')),
  '公开更新清单签名不正确',
);
const payload = z
  .object({ version: z.string(), url: z.string() })
  .parse(JSON.parse(Buffer.from(signed.payload, 'base64').toString('utf8')) as unknown);
assert.equal(payload.version, version);
assert.equal(
  payload.url,
  `https://github.com/${repo}/releases/download/v${version}/zhenjing-${version}-windows-x64.msi`,
);
await writeFile(
  '.cache/verification/github-public-release.json',
  JSON.stringify(
    { passed: true, version, url: release.html_url, assets: names, updateSignatureVerified: true },
    null,
    2,
  ),
);
console.log(`公开 Release、全部资产摘要及更新清单签名核对通过：${release.html_url}`);
