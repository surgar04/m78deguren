import { expect, it } from 'vitest';
import { migrateMusicPreferences, MUSIC_PROVIDERS } from './preferences';
import {
  musicRequestSchema,
  onlineMusicProviderSchema,
  musicProviderSchema,
} from '@/lib/music-contracts';

it('旧平台选择只迁移到本地曲库，保留音量、主题及其他收藏', () => {
  const result = migrateMusicPreferences({
    provider: 'spotify',
    volume: 0.21,
    style: 'monet',
    favorites: ['spotify:old', 'local:own', 'qq:kept'],
  });
  expect(result).toMatchObject({
    provider: 'local',
    volume: 0.21,
    style: 'monet',
    matchProvider: 'netease',
    favorites: ['local:own', 'qq:kept'],
  });
  expect(MUSIC_PROVIDERS.map(([provider]) => provider)).toEqual(['netease', 'qq', 'ytm', 'local']);
});
it.each(['netease', 'qq', 'ytm'] as const)(
  '仍支持 %s 的账户与音源身份，不允许旧平台借用 IPC',
  (provider) => {
    expect(migrateMusicPreferences({ provider }).provider).toBe(provider);
    expect(onlineMusicProviderSchema.parse(provider)).toBe(provider);
    expect(musicProviderSchema.parse(provider)).toBe(provider);
    expect(
      musicRequestSchema.safeParse({
        operation: 'provider',
        provider: 'spotify',
        action: 'audio',
        params: {},
      }).success,
    ).toBe(false);
    expect(
      musicRequestSchema.safeParse({
        operation: 'api',
        provider: 'spotify',
        path: '/search',
        method: 'GET',
        params: {},
      }).success,
    ).toBe(false);
  },
);
