import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { MusicTrack } from '@/lib/music-contracts';
import { MusicPlayer } from './player';
import { playbackMessage } from './playback-guard';

const engine = vi.hoisted(() => vi.fn());
vi.mock('./engine', () => ({ musicEngine: engine }));
const track: MusicTrack = {
  key: 'spotify:track',
  provider: 'spotify',
  id: 'track',
  title: '测试歌曲',
  artists: [],
  album: '',
  durationMs: 180000,
  cover: null,
  matched: false,
};
let pendingPlay = false;
class AudioFixture extends EventTarget {
  static current: AudioFixture | undefined;
  constructor() {
    super();
    AudioFixture.current = this;
  }
  volume = 1;
  currentTime = 0;
  duration = 180;
  crossOrigin = '';
  preload = '';
  src = '';
  load() {}
  removeAttribute() {
    this.src = '';
  }
  pause() {
    this.dispatchEvent(new Event('pause'));
  }
  play() {
    if (pendingPlay) return new Promise<void>(() => {});
    this.dispatchEvent(new Event('play'));
    return Promise.resolve();
  }
}
beforeEach(() => {
  vi.useFakeTimers();
  pendingPlay = false;
  vi.stubGlobal('Audio', AudioFixture);
  vi.stubGlobal('navigator', {});
  engine.mockImplementation((operation: string) =>
    Promise.resolve(
      operation === 'resolve'
        ? {
            url: 'http://zhenjing-music.localhost/media/fixture',
            preview: false,
            clipStartMs: 0,
            quality: 'high',
          }
        : { lines: [], source: '', wordTimed: false, isPureMusic: false },
    ),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('解码器永不开始时退出等待并显示原因，再次播放会重新解析音源', async () => {
  const player = new MusicPlayer();
  pendingPlay = true;
  const first = player.play(track);
  await vi.advanceTimersByTimeAsync(20001);
  await first;
  expect(player.snapshot()).toMatchObject({ loading: false, playing: false });
  expect(player.snapshot().error).toContain('未能开始播放');
  pendingPlay = false;
  await player.toggle();
  expect(engine.mock.calls.filter(([operation]) => operation === 'resolve')).toHaveLength(2);
  expect(player.snapshot()).toMatchObject({ playing: true, error: '' });
});

it('加载期间可以取消，迟到的解析结果不会启动播放', async () => {
  let finish: ((value: unknown) => void) | undefined;
  engine.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const player = new MusicPlayer();
  const first = player.play(track);
  await player.toggle();
  finish?.({ url: 'late', preview: false, clipStartMs: 0, quality: 'high' });
  await first;
  expect(player.snapshot()).toMatchObject({ loading: false, playing: false, error: '' });
});

it('挂起的 WebAudio 恢复不会永久锁住普通播放器', async () => {
  class ContextFixture {
    state = 'suspended';
    destination = {};
    createMediaElementSource() {
      return { connect() {}, disconnect() {} };
    }
    createAnalyser() {
      return { fftSize: 0, smoothingTimeConstant: 0, connect() {}, disconnect() {} };
    }
    resume() {
      return new Promise<void>(() => {});
    }
  }
  vi.stubGlobal('AudioContext', ContextFixture);
  const player = new MusicPlayer();
  const analysis = player.enableAnalysis(true).catch(() => {});
  await vi.advanceTimersByTimeAsync(5001);
  await analysis;
  const playing = player.play(track);
  await vi.advanceTimersByTimeAsync(5001);
  await playing;
  expect(player.snapshot().loading).toBe(false);
  expect(player.snapshot().error).toContain('音频输出未能恢复');
});

it('Premium 限制、密钥拒绝和网络连接错误有不同的提示', () => {
  expect(playbackMessage(Error('Spotify plays for Premium accounts only'))).toContain('Premium');
  expect(playbackMessage(Error('Spotify gives this account no audio key'))).toContain('拒绝');
  expect(playbackMessage(Error('Spotify playback could not connect'))).toContain('音频连接');
});

it('重新选曲解析期间旧音源的失败和缓冲事件不会取消新请求', async () => {
  const player = new MusicPlayer();
  await player.play(track);
  let finish: ((value: unknown) => void) | undefined;
  engine.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const next = player.play({ ...track, key: 'spotify:second', title: '新歌曲' });
  AudioFixture.current?.dispatchEvent(new Event('error'));
  AudioFixture.current?.dispatchEvent(new Event('waiting'));
  await vi.advanceTimersByTimeAsync(20001);
  expect(player.snapshot()).toMatchObject({ loading: true, error: '' });
  finish?.({
    url: 'http://zhenjing-music.localhost/media/second',
    preview: false,
    clipStartMs: 0,
    quality: 'high',
  });
  await next;
  expect(player.snapshot()).toMatchObject({ playing: true, loading: false, error: '' });
});
