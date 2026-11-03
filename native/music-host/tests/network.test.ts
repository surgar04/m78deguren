// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const network = vi.hoisted(() => ({ lookup: vi.fn(), route: vi.fn(), fetch: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: network.lookup }));
vi.mock('../network-route.ts', async (original) => ({
  ...(await original<object>()),
  musicRoute: network.route,
  proxyDispatcher: () => ({}),
  directDispatcher: () => ({}),
}));
import { platformFetch } from '../network.ts';
beforeEach(() => {
  network.lookup.mockReset().mockResolvedValue([{ address: '93.184.215.14' }]);
  network.route.mockReset().mockResolvedValue({ mode: 'direct' });
  network.fetch.mockReset().mockResolvedValue(new Response('{}'));
  vi.stubGlobal('fetch', network.fetch);
});
afterEach(() => vi.unstubAllGlobals());
it('系统代理/PAC 路由已解析时不再依赖本机 DNS，保留 POST 的头和正文', async () => {
  network.route.mockResolvedValue({ mode: 'proxy', proxy: 'http://127.0.0.1:18080/' });
  network.lookup.mockRejectedValue(Error('local DNS unavailable'));
  await platformFetch(
    new Request('https://music.youtube.com/youtubei/v1/browse', {
      method: 'POST',
      headers: { authorization: 'fixture', 'content-type': 'application/json' },
      body: '{"fixture":true}',
    }),
  );
  expect(network.lookup).not.toHaveBeenCalled();
  const options = network.fetch.mock.calls[0]?.[1] as RequestInit;
  expect(options.method).toBe('POST');
  expect(new Headers(options.headers).get('authorization')).toBe('fixture');
  expect(
    new TextDecoder().decode(options.body instanceof ArrayBuffer ? options.body : undefined),
  ).toBe('{"fixture":true}');
});
it('鉴权要求拒绝重定向时不跟随，避免 Cookie 和 Google 头被转发', async () => {
  network.fetch.mockResolvedValue(
    new Response('', { status: 302, headers: { location: 'https://accounts.google.com/' } }),
  );
  await expect(
    platformFetch(
      new Request('https://www.youtube.com/youtubei/v1/browse', {
        redirect: 'error',
        headers: { cookie: 'fixture', 'x-goog-pageid': 'fixture' },
      }),
    ),
  ).rejects.toThrow('重定向');
  expect(network.fetch).toHaveBeenCalledOnce();
});
it('普通跨域重定向剥离全部账号头，显式 manual 不自动跟随', async () => {
  network.fetch
    .mockResolvedValueOnce(
      new Response('', { status: 302, headers: { location: 'https://music.youtube.com/' } }),
    )
    .mockResolvedValueOnce(new Response('{}'));
  await platformFetch('https://www.youtube.com/', {
    headers: {
      cookie: 'fixture',
      authorization: 'fixture',
      'x-goog-authuser': 'fixture',
      'x-goog-pageid': 'fixture',
    },
  });
  const options = network.fetch.mock.calls[1]?.[1] as RequestInit;
  expect([...new Headers(options.headers).keys()]).toHaveLength(0);
  network.fetch.mockResolvedValueOnce(
    new Response('', { status: 302, headers: { location: 'https://music.youtube.com/' } }),
  );
  expect((await platformFetch('https://www.youtube.com/', { redirect: 'manual' })).status).toBe(
    302,
  );
  expect(network.fetch).toHaveBeenCalledTimes(3);
});
it('系统代理失败不静默直连，直连 DNS 失败/私网解析均有明确错误', async () => {
  network.route.mockRejectedValueOnce(Error('PAC unavailable'));
  await expect(platformFetch('https://music.youtube.com/')).rejects.toThrow('PAC unavailable');
  expect(network.fetch).not.toHaveBeenCalled();
  network.lookup.mockRejectedValueOnce(Error('dns'));
  await expect(platformFetch('https://music.youtube.com/')).rejects.toMatchObject({ code: 'dns' });
  network.lookup.mockResolvedValueOnce([{ address: '127.0.0.1' }]);
  await expect(platformFetch('https://music.youtube.com/')).rejects.toThrow('本地或内网');
});
