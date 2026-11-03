import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { MusicControls } from './MusicPlayback';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const fixture = vi.hoisted(() => ({
  playback: {
    track: {
      key: 'qq:fixture',
      id: 'fixture',
      provider: 'qq',
      title: '测试歌曲',
      artists: ['测试'],
      album: '',
      durationMs: 180000,
      cover: 'http://zhenjing-music.localhost/media/fixture-cover',
      matched: false,
    },
    queue: [],
    loading: false,
    playing: false,
    error: '',
    position: 0,
    duration: 180,
  },
  toggle: vi.fn(),
  play: vi.fn(),
  next: vi.fn(),
  seek: vi.fn(),
  volume: vi.fn(),
}));
vi.mock('./player', () => ({
  useMusicPlayer: () => fixture.playback,
  musicPlayer: fixture,
}));
beforeEach(() => {
  fixture.playback.loading = false;
  fixture.playback.error = '';
});
const renderControls = () =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { enabled: false, retry: false, gcTime: 0 } },
        })
      }
    >
      <MusicControls />
    </QueryClientProvider>,
  );

it('加载期间仍能取消，不再把唯一播放操作禁用', () => {
  fixture.playback.loading = true;
  renderControls();
  const cancel = screen.getByRole('button', { name: '取消加载' });
  expect(cancel).toBeEnabled();
  fireEvent.click(cancel);
  expect(fixture.toggle).toHaveBeenCalledOnce();
});

it('完整错误独立呈现并提供重新解析音源的操作', () => {
  fixture.playback.error = 'QQ 音乐音频连接未建立，请检查网络或点击重试。';
  renderControls();
  expect(screen.getByRole('alert')).toHaveTextContent(fixture.playback.error);
  fireEvent.click(screen.getByRole('button', { name: '重试播放' }));
  expect(fixture.play).toHaveBeenCalledWith(fixture.playback.track, fixture.playback.queue);
});
