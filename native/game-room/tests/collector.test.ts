// @vitest-environment node
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { z } from 'zod';
import { expect, it } from 'vitest';

/** 在隔离的脚本上下文执行实际采集模板；不登录私人账号、不向官方或社区发送请求。 */
async function collect(kind: 'refresh' | 'season', rejected = false) {
  const template = await readFile('src-tauri/src/services/game_room/wegame.js.txt', 'utf8');
  const calls: string[] = [];
  const context: Record<string, unknown> = {
    window: {},
    document: { cookie: 'tgp_user_type=1' },
    AbortController,
    setTimeout,
    clearTimeout,
    console,
    fetch: (url: string) => {
      calls.push(url);
      const method = url.split('/').at(-1);
      const data =
        method === 'GetRoleInfo'
          ? {
              result: { error_code: rejected ? 1 : 0 },
              role_info: {
                openid: 'private-openid',
                name: '测试角色',
                level: 12,
                tgp_id: 'private-id',
              },
            }
          : method === 'GetBattleList'
            ? {
                result: { error_code: 0 },
                sols: [{ roomId: 'r1', startTime: 1, killCnt: 2, openid: 'nested-secret' }],
                tdms: [],
              }
            : method === 'query'
              ? { items: [{ season_id: '12', season_name: 'S12' }] }
              : {
                  result: { error_code: 0 },
                  season: { stats: { total_fight: 3 } },
                  cookie: 'secret',
                  token: 'secret',
                };
      return Promise.resolve(new Response(JSON.stringify(data), { status: 200 }));
    },
  };
  vm.runInNewContext(
    template
      .replace('__SLOT__', '"fixtureSlot"')
      .replace(
        '__COMMAND__',
        JSON.stringify({ kind, sid: '12', queue: 'sol', roomId: '__SLOT__' }),
      ),
    context,
    { timeout: 1000 },
  );
  for (let attempt = 0; attempt < 100; attempt++) {
    const window = z.record(z.string(), z.unknown()).parse(context['window']);
    const result = z.object({ ready: z.boolean() }).passthrough().safeParse(window['fixtureSlot']);
    if (result.success && result.data.ready) return { result: result.data, calls };
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw Error('采集模板未完成');
}
it('实际模板采集两种模式并剥离嵌套账号标识与凭据', async () => {
  const { result, calls } = await collect('refresh');
  expect(result['ok']).toBe(true);
  expect(calls.filter((url) => url.endsWith('GetBattleList'))).toHaveLength(2);
  const serialized = JSON.stringify(result);
  for (const secret of ['private-openid', 'private-id', 'nested-secret', '"token"', '"cookie"'])
    expect(serialized).not.toContain(secret);
  expect(serialized).toContain('测试角色');
  expect(serialized).toContain('maps_sol');
});
it('无有效角色时返回可识别授权错误，不生成空战绩冒充成功', async () => {
  const { result } = await collect('refresh', true);
  expect(result['ok']).toBe(false);
  expect(result['code']).toBe('authorization');
});
it('赛季更新保留请求身份，防止前端把上一赛季数据当作新赛季', async () => {
  const { result } = await collect('season');
  expect(JSON.stringify(result)).toContain('report_sol_sid');
  expect(JSON.stringify(result)).toContain('maps_sol_sid');
  expect(JSON.stringify(result)).toContain('12');
});
