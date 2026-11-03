import './check-environment.ts';
import assert from 'node:assert/strict';
import {
  generateKeyPairSync,
  createPrivateKey,
  createPublicKey,
  randomUUID,
  sign,
  verify,
} from 'node:crypto';
import { readFile, writeFile, lstat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { z } from 'zod';

/** 维护者离线签发工具；不属于应用资源。私钥和首批身份均只保存在 D 盘忽略目录。 */
const email = z.email().max(254).parse(process.argv[2]?.trim().toLowerCase());
assert.ok(/^[\x21-\x7e]+$/u.test(email));
execFileSync(
  'powershell.exe',
  [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    resolve('scripts/protect-developer-identity.ps1'),
  ],
  { stdio: 'pipe', windowsHide: true },
);
const directory = resolve('.local/developer-identity');
const privatePath = resolve(directory, 'issuer-private.pem');
const exists = await lstat(privatePath).catch(() => null);
if (!exists) {
  const pair = generateKeyPairSync('ed25519');
  await writeFile(privatePath, pair.privateKey.export({ format: 'pem', type: 'pkcs8' }), {
    flag: 'wx',
  });
  await writeFile(
    resolve(directory, 'issuer.json'),
    JSON.stringify({ allowedEmails: [email] }, null, 2),
    { flag: 'wx' },
  );
}
const identity = z
  .object({ allowedEmails: z.array(z.email()).length(1) })
  .strict()
  .parse(JSON.parse(await readFile(resolve(directory, 'issuer.json'), 'utf8')));
assert.ok(identity.allowedEmails.includes(email), '当前批次未授权此邮箱，拒绝签发。');
const key = createPrivateKey(await readFile(privatePath));
const publicKey = createPublicKey(key);
const publicConfig =
  JSON.stringify(
    {
      algorithm: 'Ed25519',
      publicKey: publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64'),
    },
    null,
    2,
  ) + '\n';
const publicPath = resolve('src-tauri/developer-channel.json');
const previous = await readFile(publicPath, 'utf8').catch(() => null);
assert.ok(
  previous === null || previous === publicConfig,
  '已有开发者公钥不匹配；不能静默更换信任根。',
);
if (previous === null) await writeFile(publicPath, publicConfig, { flag: 'wx' });
const credentialPath = resolve(directory, 'initial-credential.json');
assert.equal(
  await lstat(credentialPath).catch(() => null),
  null,
  '首批凭据已存在，拒绝意外覆盖；请从私有文件读取。',
);
const issuedAt = Math.floor(Date.now() / 1000);
const expiresAt = issuedAt + 365 * 86400;
const payload = Buffer.from(
  JSON.stringify({
    v: 1,
    aud: 'dev.zhenjing.desktop.developer',
    email,
    jti: randomUUID(),
    iat: issuedAt,
    exp: expiresAt,
  }),
);
const signature = sign(null, payload, key);
assert.ok(verify(null, payload, publicKey, signature));
const stoken = `zjdev1.${payload.toString('base64url')}.${signature.toString('base64url')}`;
await writeFile(
  credentialPath,
  JSON.stringify({ email, stoken, issuedAt, expiresAt }, null, 2) + '\n',
  { flag: 'wx' },
);
console.log(
  `开发者凭据已保存：${credentialPath}\n有效期至 ${new Date(expiresAt * 1000).toISOString()}；未输出私钥或 stoken。`,
);
