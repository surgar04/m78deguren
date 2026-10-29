import './check-environment.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';

/** 先建立草稿，全部资产回读校验后再发布；任何一步失败都不能报告“更新已上线”。 */
const root = resolve('dist/desktop');
const repo = 'surgar04/m78deguren';
const version = z
  .string()
  .regex(/^\d+\.\d+\.\d+$/u)
  .parse((JSON.parse(await readFile('package.json', 'utf8')) as { version?: unknown }).version);
// 标签是签名 URL 的一部分。拒绝在同版本的无 v Release 旁再创建一个重复版本。
async function rejectMismatchedTag() {
  if ((await api(`/releases/tags/${version}`)) !== null)
    throw Error(
      `存在标签 ${version}；签名更新要求 v${version}。请先修正现有 Release 标签，再发布，不要重复创建版本。`,
    );
}
let token = process.env['GH_TOKEN'] ?? process.env['GITHUB_TOKEN'];
if (!token) {
  const file = await lstat('.local/github-release-token.txt').catch(() => null);
  if (file) {
    assert.ok(
      file.isFile() && !file.isSymbolicLink() && file.size <= 4096,
      '发布令牌文件无效或过大',
    );
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        resolve('scripts/protect-release-token.ps1'),
      ],
      { stdio: 'pipe', windowsHide: true },
    );
    token = (await readFile('.local/github-release-token.txt', 'utf8')).trim();
  }
}
assert.ok(
  token && token.length <= 4096 && !/\s/u.test(token),
  '缺少 GitHub 发布令牌：使用 GH_TOKEN 或 .local/github-release-token.txt；不要将令牌放入源码或聊天。',
);
if (process.argv.includes('--preflight')) {
  const access = z
    .object({ full_name: z.literal(repo), permissions: z.object({ push: z.boolean() }) })
    .parse(await api(''));
  assert.ok(access.permissions.push, '发布令牌没有当前仓库的写权限。');
  await rejectMismatchedTag();
  const previous = await api(`/releases/tags/v${version}`);
  if (previous !== null)
    assert.ok(
      z.object({ draft: z.boolean() }).parse(previous).draft,
      '当前版本已正式发布，请先提升版本号；资产恢复使用 release:publish。',
    );
  console.log(`GitHub ${repo} 发布权限预检通过。`);
  process.exit(0);
}
// 复用实际 MSI、Ed25519 签名、许可和主程序一致性检查，禁止上传旧包或旁路测试。
execFileSync(process.execPath, [resolve('scripts/verify-installer.ts')], {
  stdio: 'inherit',
  windowsHide: true,
});
const hash = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
async function api(path: string, method = 'GET', body?: unknown) {
  const result = await fetch(`https://api.github.com/repos/${repo}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(60000),
    redirect: 'error',
  });
  if (result.status === 404 && method === 'GET') return null;
  if (!result.ok)
    throw Error(
      `GitHub ${method} ${path}: HTTP ${result.status}；请检查令牌权限或网络，令牌不会写入日志。`,
    );
  return result.status === 204 ? null : ((await result.json()) as unknown);
}
const assetSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  size: z.number(),
  digest: z.string().nullable().optional(),
});
const releaseSchema = z.object({
  id: z.number().int().positive(),
  draft: z.boolean(),
  tag_name: z.string(),
  html_url: z.url(),
  assets: z.array(assetSchema),
});
const tag = `v${version}`;
await rejectMismatchedTag();
const existing = await api(`/releases/tags/${tag}`);
let release = releaseSchema.parse(
  existing ??
    (await api('/releases', 'POST', {
      tag_name: tag,
      target_commitish: 'main',
      name: `臻境 ${version}`,
      body: await readFile('CHANGELOG.md', 'utf8'),
      draft: true,
      prerelease: false,
    })),
);
assert.equal(release.tag_name, tag);
const names = [
  `zhenjing-${version}-windows-x64.msi`,
  'zhenjing-update.json',
  'SHA256SUMS.txt',
  'publisher.json',
  'build-info.json',
  'INSTALL.md',
];
for (const name of names) {
  const bytes = await readFile(resolve(root, name));
  const digest = `sha256:${hash(bytes)}`;
  let asset = release.assets.find((entry) => entry.name === name);
  if (asset && (asset.digest !== digest || asset.size !== bytes.length)) {
    assert.ok(release.draft, `已发布版本的资产不匹配，拒绝覆盖：${name}；请提升版本号。`);
    await api(`/releases/assets/${asset.id}`, 'DELETE');
    asset = undefined;
  }
  if (!asset) {
    assert.ok(release.draft, `已发布版本缺少 ${name}，拒绝悄悄修改正式版本。`);
    const upload = await fetch(
      `https://uploads.github.com/repos/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': name.endsWith('.msi') ? 'application/x-msi' : 'application/octet-stream',
        },
        body: bytes,
        signal: AbortSignal.timeout(600000),
        redirect: 'error',
      },
    );
    if (!upload.ok) throw Error(`上传 ${name} 失败：HTTP ${upload.status}；草稿保留以便重试。`);
    asset = assetSchema.parse(await upload.json());
  }
  assert.equal(asset.name, name, `GitHub 改写了资产名称：${name}；拒绝发布不完整的下载地址。`);
  assert.equal(asset.digest, digest, `GitHub 回读摘要不匹配：${name}`);
  assert.equal(asset.size, bytes.length);
  console.log(`已核对资产：${name}`);
}
if (release.draft)
  release = releaseSchema.parse(
    await api(`/releases/${release.id}`, 'PATCH', { draft: false, make_latest: 'true' }),
  );
assert.equal(release.draft, false);
const latest = releaseSchema.parse(await api('/releases/latest'));
assert.equal(latest.tag_name, tag, 'GitHub latest 尚未指向当前版本，不宣称自动更新已生效。');
await writeFile(
  '.cache/verification/github-release.json',
  JSON.stringify(
    {
      version,
      tag,
      url: release.html_url,
      uploadedAssets: names,
      verified: true,
      publishedAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);
console.log(`已发布并确认 latest：${release.html_url}`);
