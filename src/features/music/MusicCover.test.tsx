import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { MusicCover } from './MusicCover';
import { musicEngine } from './engine';
vi.mock('./engine', () => ({ musicEngine: vi.fn() }));

it('封面失败后仍有占位图，并重新获取详情，不永久隐藏图片', async () => {
  vi.mocked(musicEngine).mockResolvedValue({
    cover: 'http://zhenjing-music.localhost/media/recovered',
  });
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={cache}>
      <MusicCover
        track={{
          title: '曲目',
          provider: 'qq',
          id: '123',
          cover: 'http://zhenjing-music.localhost/media/old',
        }}
      />
    </QueryClientProvider>,
  );
  fireEvent.error(screen.getByAltText('曲目 封面'));
  await waitFor(() =>
    expect(screen.getByAltText('曲目 封面')).toHaveAttribute(
      'src',
      'http://zhenjing-music.localhost/media/recovered',
    ),
  );
  expect(musicEngine).toHaveBeenCalledWith(
    'refreshCover',
    ['qq', '123', 'track'],
    expect.anything(),
  );
  expect(document.querySelector('.music-cover-fallback')).not.toBeNull();
  cache.clear();
});
