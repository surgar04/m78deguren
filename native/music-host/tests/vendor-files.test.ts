// @vitest-environment node
import { expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { musicVendorFileAllowed } from '../../../scripts/music-vendor-files.ts';
import { musicUrl } from '../network.ts';

it('部署闭包保留 YouTube 与网易云 worker 的跨目录依赖，排除撤下的平台和 Electron 入口', () => {
  for (const path of [
    'electron/ytm/ytmApiBridge.cjs',
    'electron/ytm/webSignIn.cjs',
    'electron/transcode/protocol.cjs',
    'electron/netease/neteaseApiWorker.cjs',
    'electron/backendLifecycle.cjs',
    'electron/networkRecorder.cjs',
    'shared/networkErrorText.cjs',
    'LICENSE',
  ])
    expect(musicVendorFileAllowed(path)).toBe(true);
  for (const path of [
    'electron/spotify',
    'electron/spotify/audio.cjs',
    'electron/main.cjs',
    'electron/preload.cjs',
    '../private',
  ])
    expect(musicVendorFileAllowed(path)).toBe(false);
});
it('其余平台域名保持可达，旧音源域名在 DNS 与请求之前拒绝', () => {
  for (const url of [
    'https://u.y.qq.com/cgi-bin/musicu.fcg',
    'https://music.163.com/api',
    'https://m10.music.126.net/file',
    'https://music.youtube.com/youtubei/v1/browse',
    'https://r1.googlevideo.com/audio',
  ])
    expect(musicUrl(url).href).toBe(url);
  for (const url of ['https://api.spotify.com/test', 'https://fixture.scdn.co/audio'])
    expect(() => musicUrl(url)).toThrow();
});
it('锁定依赖中不再包含已撤下的原生插件', async () => {
  expect(await readFile('pnpm-lock.yaml', 'utf8')).not.toContain('@lox-audioserver/node-librespot');
});
