import { expect, it, vi } from 'vitest';
import { createMusicEngine } from '../api';

const platform = vi.hoisted(() => ({
  readAccount: vi.fn(() => Promise.resolve('authenticated')),
  checkLogin: vi.fn(() => Promise.resolve({ state: 'confirmed' })),
  startLogin: vi.fn(() => Promise.resolve({ key: 'owned-browser-attempt', imageUrl: '' })),
  confirmsLoginInBrowser: () => false,
}));
vi.mock('../upstream/src/services/onlineMusic/omni', () => ({
  omni: platform,
}));
vi.mock('../upstream/src/services/onlineMusic/songMetadata', () => ({
  getProviderSongMetadata: vi.fn(),
}));
vi.mock('../upstream/src/utils/appPlaybackGuards', () => ({
  getPlaybackSourceRef: vi.fn(),
}));
vi.mock('../upstream/src/utils/lyrics/LyricParserFactory', () => ({
  LyricParserFactory: {},
}));
vi.mock('../upstream/src/stores/useOnlineProviderAccountStore', () => ({
  useOnlineProviderAccountStore: {
    getState: () => ({
      accounts: { ytm: { status: 'authenticated', user: { nickname: '授权测试', vipType: 1 } } },
    }),
  },
}));

it('浏览器确认授权后切换上游账号代次，后续账户读取加入新查询而不复用访客查询', async () => {
  const engine = await createMusicEngine((request) =>
    Promise.resolve(
      request.operation === 'provider' && request.action === 'auth_progress'
        ? { ok: true, data: { phase: 'confirmed', code: '', diagnostics: 'fixture confirmed' } }
        : { available: true },
    ),
  );
  const attempt = await engine.loginStart('ytm');
  expect(attempt.key).not.toBe('owned-browser-attempt');
  await expect(engine.loginCheck('ytm', attempt.key)).resolves.toMatchObject({
    state: 'confirmed',
  });
  expect(platform.readAccount).toHaveBeenNthCalledWith(1, 'ytm', 'sign-in');
  await expect(engine.account('ytm')).resolves.toMatchObject({
    connected: true,
    nickname: '授权测试',
  });
  expect(platform.readAccount).toHaveBeenNthCalledWith(2, 'ytm', 'sync');
});
