import type { ReactNode } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import MusicPage from './MusicPage';
import { useMusicPreferences } from './preferences';

const fixture = vi.hoisted(() => ({ engine: vi.fn(), bridge: vi.fn(), play: vi.fn() }));
vi.mock('./engine', () => ({ musicEngine: fixture.engine }));
vi.mock('@/lib/desktop', () => ({
  isDesktop: () => true,
  executeMusic: fixture.bridge,
  errorMessage: (error: unknown) => (error instanceof Error ? error.message : 'fixture error'),
}));
vi.mock('@/features/home/useGameWorkspace', () => ({ useGameWorkspace: () => ({}) }));
vi.mock('@/features/home/components/WorkspaceLayout', () => ({
  WorkspaceLayout: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('./MusicPlayback', () => ({
  MusicNowPlaying: () => null,
  MusicControls: () => null,
  MusicEffects: () => null,
}));
vi.mock('./desktop-lyrics/DesktopLyricsControls', () => ({ DesktopLyricsControls: () => null }));
vi.mock('./MusicCover', () => ({ MusicCover: () => null }));
vi.mock('./player', () => ({
  useMusicTrack: () => null,
  useMusicPlaying: () => false,
  musicPlayer: { play: fixture.play },
}));

const song = (provider: string) => ({
  key: `${provider}:fixture`,
  id: 'fixture',
  provider,
  title: provider === 'local' ? '本地测试歌曲' : `${provider}测试歌曲`,
  artists: ['测试歌手'],
  album: '测试专辑',
  cover: null,
  durationMs: 180000,
  matched: false,
});
const local = { tracks: [song('local')], importing: false, processed: 1, skipped: 0, message: '' };
beforeEach(() => {
  fixture.engine.mockReset();
  fixture.bridge.mockReset();
  fixture.play.mockReset();
  useMusicPreferences
    .getState()
    .patch({ provider: 'netease', matchProvider: 'netease', favorites: [] });
  fixture.bridge.mockResolvedValue(local);
  fixture.engine.mockImplementation((operation: string, [provider]: unknown[]) =>
    Promise.resolve(
      operation === 'account'
        ? { provider, connected: false, nickname: '', avatar: null, premium: false }
        : operation === 'library'
          ? [{ provider, id: 'list', title: `${String(provider)}歌单`, count: 1, cover: null }]
          : { items: [song(String(provider))], hasMore: false, nextOffset: 1 },
    ),
  );
});
function view() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MusicPage />
    </QueryClientProvider>,
  );
}
it('第四入口为本地曲库，独立显示导入/收藏/播放且不请求本地账号', async () => {
  view();
  fireEvent.click(screen.getByRole('button', { name: '本地曲库' }));
  await screen.findByText('本地测试歌曲');
  expect(screen.queryByText('Spotify')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '连接账号' })).not.toBeInTheDocument();
  expect(screen.queryByRole('tab', { name: '在线搜索' })).not.toBeInTheDocument();
  expect(screen.getByRole('tab', { name: '本地收藏' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '播放 本地测试歌曲' }));
  expect(fixture.play).toHaveBeenCalledWith(local.tracks[0], local.tracks);
  fireEvent.click(screen.getByRole('button', { name: '添加歌曲' }));
  await waitFor(() =>
    expect(fixture.bridge).toHaveBeenCalledWith(
      { operation: 'local-import', folder: false },
      expect.anything(),
    ),
  );
  expect(
    fixture.engine.mock.calls.some(
      ([operation, args]) => operation === 'account' && Array.isArray(args) && args[0] === 'local',
    ),
  ).toBe(false);
});
it.each([
  ['netease', '网易云音乐'],
  ['qq', 'QQ 音乐'],
  ['ytm', 'YouTube Music'],
] as const)('%s 搜索与歌单继续调用各自平台，切回本地后可再次返回', async (provider, label) => {
  view();
  fireEvent.click(screen.getByRole('button', { name: label }));
  fireEvent.change(screen.getByRole('textbox', { name: '搜索音乐' }), {
    target: { value: '测试' },
  });
  fireEvent.click(screen.getByRole('button', { name: '搜索' }));
  await waitFor(() =>
    expect(fixture.engine).toHaveBeenCalledWith('search', [provider, '测试', 0], expect.anything()),
  );
  fireEvent.click(screen.getByRole('tab', { name: '我的歌单' }));
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(`${provider}歌单`) }));
  await waitFor(() =>
    expect(fixture.engine).toHaveBeenCalledWith(
      'playlist',
      [provider, 'list', 0],
      expect.anything(),
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: '本地曲库' }));
  expect(await screen.findByText('本地测试歌曲')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: label }));
  expect(screen.getByRole('tab', { name: '在线搜索' })).toHaveAttribute('aria-selected', 'true');
});
