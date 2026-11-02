import { afterEach, expect, it, vi } from 'vitest';
import type { MusicTrack } from '@/lib/music-contracts';
import { musicPlayer } from './player';

const engine = vi.hoisted(() => vi.fn());
vi.mock('./engine', () => ({ musicEngine: engine }));
afterEach(() => vi.unstubAllGlobals());

it('快速切歌时旧解码回调不会覆盖新媒体信息，导入其他歌曲的歌词不会替换当前歌词', async () => {
  let release: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let plays = 0;
  class AudioFixture extends EventTarget {
    volume = 1;
    currentTime = 0;
    duration = 120;
    crossOrigin = '';
    preload = '';
    src = '';
    load() {}
    pause() {
      this.dispatchEvent(new Event('pause'));
    }
    play() {
      this.dispatchEvent(new Event('play'));
      return ++plays === 1 ? pending : Promise.resolve();
    }
  }
  class MetadataFixture {
    title: string;
    constructor(value: MediaMetadataInit) {
      this.title = value.title ?? '';
    }
  }
  const session = {
    metadata: null as MetadataFixture | null,
    playbackState: 'none',
    setActionHandler: vi.fn(),
    setPositionState: vi.fn(),
  };
  vi.stubGlobal('Audio', AudioFixture);
  vi.stubGlobal('MediaMetadata', MetadataFixture);
  vi.stubGlobal('navigator', { mediaSession: session });
  const lyrics = (title: string) => ({
    source: title,
    lines: [],
    wordTimed: false,
    isPureMusic: false,
  });
  engine.mockImplementation((method: string, [track]: [MusicTrack]) =>
    Promise.resolve(
      method === 'resolve'
        ? {
            url: `https://example.invalid/${track.id}`,
            preview: false,
            clipStartMs: 0,
            quality: 'standard',
          }
        : lyrics(track.title),
    ),
  );
  const make = (id: string): MusicTrack => ({
    key: `qq:${id}`,
    id,
    provider: 'qq',
    title: id,
    artists: [],
    album: '',
    durationMs: 120000,
    cover: null,
    matched: false,
  });
  const first = musicPlayer.play(make('first'));
  await vi.waitFor(() => expect(plays).toBe(1));
  await musicPlayer.play(make('second'));
  release?.();
  await first;
  expect(session.metadata?.title).toBe('second');
  await musicPlayer.loadLyrics(make('first'));
  expect(musicPlayer.snapshot().lyrics.source).toBe('second');
});
