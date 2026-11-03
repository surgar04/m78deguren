// @vitest-environment node
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createYtmAuth } from '../ytm-auth.ts';
const require = createRequire(import.meta.url);
const source = z
  .object({
    createYtmWebSignIn: z.custom<
      (options: object) => {
        start: () => Promise<void>;
        check: () => unknown;
        quit: () => Promise<void>;
      }
    >((v) => typeof v === 'function'),
  })
  .parse(require('../upstream/electron/ytm/webSignIn.cjs') as unknown);
let root = '';
const flushes: (() => Promise<void>)[] = [];
beforeEach(async () => {
  await mkdir(resolve('.cache/verification'), { recursive: true });
  root = await mkdtemp(resolve('.cache/verification/ytm-auth-'));
});
afterEach(async () => {
  await Promise.all(flushes.splice(0).map((flush) => flush()));
  if (!root.startsWith(resolve('.cache/verification') + '\\')) throw Error('fixture boundary');
  await rm(root, { force: true, recursive: true, maxRetries: 3 });
});
const cookie = {
  name: 'SAPISID',
  value: 'fixture-private-value',
  domain: '.youtube.com',
  path: '/',
};
function fixture(read = vi.fn(() => Promise.resolve([cookie]))) {
  let close: (state: string) => void = () => {};
  const closed = new Promise<string>((done) => {
    close = done;
  });
  const browser = {
    findBrowser: () => 'fixture.exe',
    openSignIn: () => ({ closed, stop() {} }),
    readCookies: read,
    endLeftBrowsers: vi.fn(() => Promise.resolve(true)),
    removeProfile: () => Promise.resolve(true),
  };
  const auth = createYtmAuth(root, { browser, pause: () => Promise.resolve() });
  flushes.push(auth.flushed);
  auth.begin();
  return { auth, browser, close };
}
it('真实上游生命周期在关闭后读取、验证并完成；诊断不包含会话或账号', async () => {
  const { auth, close } = fixture();
  const keep = vi.fn();
  const login = source.createYtmWebSignIn({
    browser: auth.browser,
    profileDir: () => root,
    exists: () => false,
    browserName: () => 'fixture',
    accountOf: () =>
      Promise.resolve({ id: 'fixture-account-private', nickname: 'fixture-user-private' }),
    keep,
    log() {},
    warn() {},
  });
  await login.start();
  expect(auth.snapshot().phase).toBe('browser');
  expect(keep).not.toHaveBeenCalled();
  close('closed');
  await new Promise<void>((done) => setImmediate(done));
  auth.note({ ok: true, data: login.check() });
  expect(auth.snapshot().phase).toBe('confirmed');
  expect(keep).toHaveBeenCalledOnce();
  await auth.flushed();
  const log = await readFile(join(root, 'ytm-auth-diagnostics.json'), 'utf8');
  expect(log).not.toMatch(/fixture-private|fixture-account|fixture-user|SAPISID|cookie|https?:/iu);
  await login.quit();
});
it('浏览器档案短暂占用后会有限重试，不需要重启应用', async () => {
  const read = vi
    .fn(() => Promise.resolve([cookie]))
    .mockRejectedValueOnce(Object.assign(Error('sensitive-private-message'), { code: 'exited' }));
  const { auth, browser } = fixture(read);
  const cookies = await auth.browser.readCookies('fixture.exe', root);
  expect(cookies).toEqual([cookie]);
  expect(read).toHaveBeenCalledTimes(2);
  expect(browser.endLeftBrowsers).toHaveBeenCalledOnce();
  expect(auth.snapshot().phase).toBe('verifying');
  await auth.flushed();
});
it('没有音乐会话时返回明确错误，不再伪装成二维码过期', async () => {
  const read = vi.fn(() => Promise.resolve([]));
  const { auth } = fixture(read);
  await expect(auth.browser.readCookies('fixture.exe', root)).rejects.toMatchObject({
    reason: 'session-missing',
  });
  expect(read).toHaveBeenCalledTimes(2);
  await auth.flushed();
});
it('取消后的迟到读取不会被标记为验证成功', async () => {
  let done: (value: (typeof cookie)[]) => void = () => {};
  const read = vi.fn(
    () =>
      new Promise<(typeof cookie)[]>((resolve) => {
        done = resolve;
      }),
  );
  const { auth } = fixture(read);
  const pending = auth.browser.readCookies('fixture.exe', root);
  auth.cancel();
  done([cookie]);
  await expect(pending).rejects.toMatchObject({ reason: 'cancelled' });
  expect(auth.snapshot().phase).toBe('cancelled');
  await auth.flushed();
});
it('保留可信失败分类，未知错误和网络原文不会进入诊断', async () => {
  const { auth } = fixture();
  auth.note({ ok: true, data: { state: 'error', reason: 'not-taken', message: 'SECRET-ACCOUNT' } });
  expect(auth.snapshot().code).toBe('not-taken');
  auth.network('dns');
  auth.note({ ok: true, data: { state: 'error', reason: 'no-answer' } });
  expect(auth.snapshot().code).toBe('dns');
  auth.network('');
  auth.note({ ok: false, error: { code: 'https://sensitive-private.invalid' } });
  expect(auth.snapshot().code).toBe('unavailable');
  expect(auth.snapshot().diagnostics).not.toMatch(/SECRET|private/iu);
  await auth.flushed();
});
