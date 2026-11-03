import { describe, expect, it, vi } from 'vitest';
import { providerPayload } from '../../../integrations/folia-engine/provider-payload';
import { requestProvider } from '../../../integrations/folia-engine/bridge';
import { musicRequestSchema } from '@/lib/music-contracts';

describe('Folia 到原生 JSON 的兼容边界', () => {
  it('首次读取 YouTube 歌单时省略 continuation，并保留嵌套的合法空值', async () => {
    const request = vi.fn((input: unknown) => {
      expect(musicRequestSchema.parse(input)).toMatchObject({
        params: { id: 'LM', variables: { enabled: false, offset: 0, value: null } },
      });
      return Promise.resolve({ ok: true, data: [] });
    });
    const input = {
      id: 'LM',
      continuation: undefined,
      variables: { enabled: false, offset: 0, value: null, cursor: undefined },
    };
    await expect(requestProvider(request, 'ytm', 'liked_songs', input)).resolves.toEqual({
      ok: true,
      data: [],
    });
    expect(request).toHaveBeenCalledOnce();
    expect(Object.hasOwn(input, 'continuation')).toBe(true);
  });
  it('数组空位转 null，共享子对象合法，危险数据不会被悄悄转换', () => {
    const shared = { id: 1 };
    expect(providerPayload({ list: [undefined, shared, shared] })).toEqual({
      list: [null, { id: 1 }, { id: 1 }],
    });
    const cycle: Record<string, unknown> = {};
    cycle.child = cycle;
    for (const value of [
      cycle,
      { a: Infinity },
      { a: BigInt(1) },
      { a: () => 1 },
      { a: new Date() },
    ])
      expect(() => providerPayload(value)).toThrow();
    const named = providerPayload(
      JSON.parse('{"__proto__":{"polluted":true}}') as Record<string, unknown>,
    );
    expect(Object.getPrototypeOf(named)).toBe(Object.prototype);
    expect(Object.hasOwn(named, '__proto__')).toBe(true);
  });
  it('原生连接失败返回可读原因，平台 Premium 等真实错误原样保留', async () => {
    const premium = {
      ok: false,
      error: { code: 'subscription-required', message: 'Spotify plays for Premium accounts only' },
    };
    await expect(requestProvider(() => Promise.resolve(premium), 'spotify', 'audio')).resolves.toBe(
      premium,
    );
    const result = await requestProvider(
      () => Promise.reject(Error('secret-not-for-display')),
      'ytm',
      'playlists',
    );
    expect(JSON.stringify(result)).toContain('无需安装');
    expect(JSON.stringify(result)).not.toContain('secret-not-for-display');
  });
  it('损坏协议和 JSON 参数错误都产生结构化提示，未知异常不透出到界面', async () => {
    await expect(
      requestProvider(() => Promise.resolve(null), 'ytm', 'web_login_start'),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-response', reason: 'protocol' },
    });
    await expect(
      requestProvider(
        () => Promise.reject(Error('音乐平台请求超时 secret-value')),
        'ytm',
        'web_login_check',
      ),
    ).resolves.toMatchObject({ ok: false, error: { reason: 'host-timeout' } });
    const result = await requestProvider(() => Promise.resolve({}), 'ytm', 'web_login_start', {
      value: BigInt(1),
    });
    expect(result).toMatchObject({ ok: false, error: { reason: 'invalid-request' } });
    expect(JSON.stringify(result)).not.toContain('BigInt');
  });
});
