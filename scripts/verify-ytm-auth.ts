import './check-environment.ts';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createYtmAuth } from '../native/music-host/ytm-auth.ts';
import { musicRoute, closeMusicNetwork } from '../native/music-host/network-route.ts';

// 使用本机实际浏览器及实际 C# 桥，但仅创建全新 D 盘档案，不打开网页、不登录、不读私人配置。
const root = resolve('.cache/verification', `ytm-native-${randomUUID()}`);
await mkdir(root, { recursive: true });
process.env['ZHENJING_MUSIC_VAULT'] = resolve(
  'src-tauri/resources/hardware-monitor/runtime/ZhenjingMonitor.exe',
);
process.env['ZHENJING_MUSIC_SYSTEM_PROXY'] = '0';
process.env['HTTPS_PROXY'] = 'http://127.0.0.1:18991';
process.env['HTTP_PROXY'] = 'http://127.0.0.1:18991';
process.env['NO_PROXY'] = '';
const checks: string[] = [];
const route = await musicRoute(new URL('https://music.youtube.com/'));
assert.equal(route.mode, 'proxy');
if (route.mode === 'proxy') assert.equal(new URL(route.proxy).port, '18991');
checks.push('actual-dotnet-proxy-resolution-with-process-only-fixture');
const auth = createYtmAuth(root);
const browser = auth.browser.findBrowser();
if (browser) {
  assert.match((await auth.browserIdentity()) ?? '', /Chrome\/\d+\.0\.0\.0/u);
  checks.push('read-only-browser-version');
  const profile = join(root, 'empty-profile');
  await mkdir(profile);
  await writeFile(join(profile, 'folia-sign-in-folder'), '');
  auth.begin();
  try {
    // 空档案必须明确拒绝，不能误报成功、泛化为二维码过期或遗留浏览器。
    await assert.rejects(
      auth.browser.readCookies(browser, profile),
      (cause: unknown) =>
        cause instanceof Error && 'reason' in cause && cause.reason === 'session-missing',
    );
    checks.push('actual-browser-empty-session-retries-and-readable-error');
  } finally {
    await auth.browser.endLeftBrowsers(profile);
    assert.equal(await auth.browser.removeProfile(profile), true);
    checks.push('owned-browser-profile-cleaned');
    await auth.flushed();
  }
} else {
  checks.push('browser-not-installed-no-private-session-tested');
}
await closeMusicNetwork();
await writeFile(
  join(root, 'result.json'),
  JSON.stringify(
    { passed: true, checks, googleAccountUsed: false, systemSettingsChanged: false },
    null,
    2,
  ),
);
console.log(`YouTube 授权原生回归通过：${root}`);
