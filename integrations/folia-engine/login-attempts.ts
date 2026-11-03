import type { OnlineMusicProvider } from '../../src/lib/music-contracts';

/** 平台授权串可能包含长的签名载荷。界面只持有短票据，不将原始内容放进查询键或展示状态。 */
export function createLoginAttempts(
  cancel: (provider: OnlineMusicProvider, key: string) => Promise<void>,
  now: () => number = Date.now,
) {
  const entries = new Map<
    string,
    { provider: OnlineMusicProvider; key: string; expires: number }
  >();
  const discard = (id: string) => {
    const held = entries.get(id);
    if (!held) return;
    entries.delete(id);
    void cancel(held.provider, held.key).catch(() => {});
  };
  return {
    register(provider: OnlineMusicProvider, key: string) {
      if (!key || key.length > 65536) throw Error('平台授权标识无效，请重新生成');
      for (const [id, entry] of entries) if (entry.expires <= now()) discard(id);
      while (entries.size >= 8) {
        const first = entries.keys().next().value;
        if (!first) break;
        discard(first);
      }
      const id = crypto.randomUUID();
      // YouTube 浏览器最多等待十分钟，之后仍需读取档案并验证账号，不能在此抢先取消。
      entries.set(id, { provider, key, expires: now() + (provider === 'ytm' ? 12 : 10) * 60_000 });
      return id;
    },
    resolve(provider: OnlineMusicProvider, id: string) {
      const entry = entries.get(id);
      if (!entry || entry.provider !== provider) throw Error('授权尝试不存在，请重新生成');
      if (entry.expires <= now()) {
        discard(id);
        throw Error('授权尝试已过期，请重新生成');
      }
      return entry.key;
    },
    complete(id: string) {
      entries.delete(id);
    },
    async cancel(provider: OnlineMusicProvider, id: string) {
      const entry = entries.get(id);
      if (!entry) return;
      if (entry.provider !== provider) throw Error('授权平台不匹配');
      entries.delete(id);
      await cancel(provider, entry.key);
    },
  };
}
