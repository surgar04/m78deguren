import { useSyncExternalStore } from 'react';
import { executeMusic, errorMessage } from '@/lib/desktop';
import {
  musicAudioSchema,
  musicLyricsSchema,
  musicRawLyricSchema,
  type MusicLyrics,
  type MusicTrack,
} from '@/lib/music-contracts';
import { musicEngine } from './engine';
import { useMusicPreferences } from './preferences';
import { playbackMessage, playbackStep } from './playback-guard';
import { recordDiagnostic } from '@/lib/diagnostics';

const EMPTY: MusicLyrics = { lines: [], source: '', wordTimed: false, isPureMusic: false };
interface Playback {
  track: MusicTrack | null;
  queue: MusicTrack[];
  index: number;
  playing: boolean;
  position: number;
  duration: number;
  loading: boolean;
  lyrics: MusicLyrics;
  error: string;
  preview: boolean;
  clipStart: number;
}
/** 单一音频时钟跨页面存活；高频 FFT 不放 React 或 Query，退出演绎即断开分析节点。 */
export class MusicPlayer {
  private value: Playback = {
    track: null,
    queue: [],
    index: -1,
    playing: false,
    position: 0,
    duration: 0,
    loading: false,
    lyrics: EMPTY,
    error: '',
    preview: false,
    clipStart: 0,
  };
  private listeners = new Set<() => void>();
  private audio: HTMLAudioElement | null = null;
  private epoch = 0;
  private wantPlay = false;
  private attempt: AbortController | null = null;
  // 表示本次选曲的 URL 已交给 audio，不代表浏览器已完成缓冲或解码。
  private sourceReady = false;
  private stallTimer: ReturnType<typeof setTimeout> | undefined;
  private context: AudioContext | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private spectrum: Uint8Array<ArrayBuffer> = new Uint8Array(1024);
  private analysis = false;
  subscribe = (callback: () => void) => {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  };
  snapshot = () => this.value;
  private update(patch: Partial<Playback>) {
    // 只记录播放状态和错误，不记录歌曲名称、账号或音源 URL；timeupdate 不产生逐帧日志。
    if (patch.error && patch.error !== this.value.error)
      recordDiagnostic({
        level: 'error',
        event: 'media.error',
        operation: this.value.track?.provider ?? 'music',
        trace: null,
        durationMs: null,
        message: patch.error,
      });
    if (typeof patch.playing === 'boolean' && patch.playing !== this.value.playing)
      recordDiagnostic({
        level: 'info',
        event: 'media.state',
        operation: patch.playing ? 'play' : 'pause',
        trace: null,
        durationMs: null,
        message: null,
      });
    this.value = { ...this.value, ...patch };
    this.listeners.forEach((callback) => callback());
  }
  private element() {
    if (this.audio) return this.audio;
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.crossOrigin = 'anonymous';
    audio.volume = useMusicPreferences.getState().volume;
    audio.addEventListener('play', () => {
      this.update({ playing: true });
      this.mediaState();
    });
    audio.addEventListener('pause', () => {
      clearTimeout(this.stallTimer);
      this.update({ playing: false });
      this.mediaState();
    });
    audio.addEventListener('timeupdate', () => {
      clearTimeout(this.stallTimer);
      this.update({ position: audio.currentTime });
      this.mediaState();
    });
    audio.addEventListener('durationchange', () => {
      if (Number.isFinite(audio.duration)) this.update({ duration: audio.duration });
    });
    audio.addEventListener('error', () => {
      // 切歌解析期间，旧音源迟到的事件不得取消新请求。
      if (!this.sourceReady || !audio.error || (audio.currentSrc && audio.currentSrc !== audio.src))
        return;
      clearTimeout(this.stallTimer);
      this.wantPlay = false;
      this.attempt?.abort();
      this.sourceReady = false;
      this.update({
        error:
          audio.error?.code === 2
            ? '音频传输失败，请重试或检查网络。'
            : audio.error?.code === 3
              ? '音频解码失败，平台返回的音源可能无效或系统不支持此格式。'
              : '音源无法播放或已失效，请重新播放；部分格式需系统解码器支持。',
        loading: false,
        playing: false,
      });
    });
    const stalled = () => {
      clearTimeout(this.stallTimer);
      if (!this.wantPlay || !this.sourceReady) return;
      this.stallTimer = setTimeout(() => {
        if (!this.wantPlay) return;
        this.wantPlay = false;
        this.attempt?.abort();
        this.sourceReady = false;
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
        this.update({
          loading: false,
          playing: false,
          error: '音频缓冲超过 20 秒，已停止等待。请点击播放重试或检查平台网络。',
        });
      }, 20000);
    };
    audio.addEventListener('waiting', stalled);
    audio.addEventListener('stalled', stalled);
    audio.addEventListener('playing', () => clearTimeout(this.stallTimer));
    audio.addEventListener('ended', () => {
      void this.next(1, true);
    });
    if ('mediaSession' in navigator) {
      navigator.mediaSession.setActionHandler('play', () => {
        void this.toggle(true);
      });
      navigator.mediaSession.setActionHandler('pause', () => {
        void this.toggle(false);
      });
      navigator.mediaSession.setActionHandler('previoustrack', () => {
        void this.next(-1);
      });
      navigator.mediaSession.setActionHandler('nexttrack', () => {
        void this.next(1);
      });
      navigator.mediaSession.setActionHandler('seekto', (details) => {
        if (details.seekTime !== undefined) this.seek(details.seekTime);
      });
    }
    this.audio = audio;
    return audio;
  }
  private mediaState() {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = this.value.playing ? 'playing' : 'paused';
    if (this.value.duration > 0) {
      try {
        navigator.mediaSession.setPositionState({
          duration: this.value.duration,
          position: Math.min(this.value.position, this.value.duration),
          playbackRate: 1,
        });
      } catch {
        /* 元数据切歌期间浏览器可能尚未接纳 duration；下一次 timeupdate 会重试。 */
      }
    }
  }
  async play(track: MusicTrack, queue: MusicTrack[] = [track]) {
    this.attempt?.abort();
    const attempt = new AbortController();
    this.attempt = attempt;
    this.sourceReady = false;
    this.wantPlay = true;
    const epoch = ++this.epoch,
      audio = this.element();
    audio.pause();
    // 恢复 WebAudio 必须在点击调用栈内发起，不能等远端音源解析后才请求用户激活。
    // 普通模式没有 AudioContext；演绎留下的 context 也不得无限阻塞后续平台播放。
    const output = this.resumeOutput(attempt.signal);
    void output.catch(() => {});
    this.update({
      track,
      queue,
      index: Math.max(
        0,
        queue.findIndex((row) => row.key === track.key),
      ),
      position: 0,
      duration: track.durationMs / 1000,
      loading: true,
      error: '',
      lyrics: EMPTY,
      preview: false,
      clipStart: 0,
    });
    try {
      const [source] = await Promise.all([
        playbackStep(
          musicEngine('resolve', [track, useMusicPreferences.getState().quality], musicAudioSchema),
          attempt.signal,
          60000,
          '平台音源解析超过 60 秒，请点击播放重试。',
        ),
        output,
      ]);
      if (epoch !== this.epoch) return;
      audio.src = source.url;
      audio.load();
      this.sourceReady = true;
      this.update({ preview: source.preview, clipStart: source.clipStartMs / 1000 });
      if (epoch !== this.epoch) return;
      if (this.wantPlay)
        await playbackStep(
          audio.play(),
          attempt.signal,
          20000,
          '音频未能开始播放，已停止等待。请点击播放重试。',
        );
      // 切歌可能发生在解码器准备期间，迟到的播放 Promise 不得覆盖新歌曲的元数据。
      if (epoch !== this.epoch) return;
      if (!this.wantPlay) audio.pause();
      if ('mediaSession' in navigator)
        navigator.mediaSession.metadata = new MediaMetadata({
          title: track.title,
          artist: track.artists.join(' / '),
          album: track.album,
          ...(track.cover ? { artwork: [{ src: track.cover }] } : {}),
        });
      this.update({ loading: false });
      void this.loadLyrics(track, epoch);
    } catch (cause) {
      if (epoch === this.epoch && !attempt.signal.aborted) {
        this.wantPlay = false;
        attempt.abort();
        this.sourceReady = false;
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
        this.update({ error: playbackMessage(cause), loading: false, playing: false });
      }
    }
  }
  async loadLyrics(track = this.value.track, epoch = this.epoch, choose = false) {
    if (!track) return;
    try {
      const lyrics =
        track.provider === 'local'
          ? await this.localLyrics(track, choose)
          : await musicEngine('lyrics', [track], musicLyricsSchema);
      if (epoch === this.epoch && this.value.track?.key === track.key) this.update({ lyrics });
    } catch (cause) {
      if (epoch === this.epoch && this.value.track?.key === track.key && !this.value.error)
        this.update({ error: `歌词：${errorMessage(cause)}` });
    }
  }
  private async localLyrics(track: MusicTrack, choose: boolean) {
    const raw = await executeMusic(
      { operation: 'local-lyrics', id: track.id, choose },
      musicRawLyricSchema,
    );
    if (raw.text) return musicEngine('parseLyrics', [raw.text, raw.format], musicLyricsSchema);
    if (track.matchSource)
      return musicEngine(
        'lyrics',
        [
          {
            ...track,
            provider: track.matchSource.provider,
            id: track.matchSource.id,
            key: `${track.matchSource.provider}:${track.matchSource.id}`,
          },
        ],
        musicLyricsSchema,
      );
    return EMPTY;
  }
  async matchedLyrics(track: MusicTrack) {
    const epoch = this.epoch,
      result = await musicEngine('lyrics', [track], musicLyricsSchema);
    if (epoch === this.epoch) this.update({ lyrics: result });
  }
  private resumeOutput(signal: AbortSignal): Promise<void> {
    return this.context?.state === 'suspended'
      ? playbackStep(
          this.context.resume(),
          signal,
          5000,
          '音频输出未能恢复，请再次点击播放；如仍失败请退出沉浸演绎重试。',
        )
      : Promise.resolve();
  }
  async toggle(play = !(this.value.playing || this.value.loading)) {
    this.wantPlay = play;
    if (this.value.loading) {
      if (!play) {
        ++this.epoch;
        this.attempt?.abort();
        this.audio?.pause();
        this.audio?.removeAttribute('src');
        this.audio?.load();
        this.sourceReady = false;
        this.update({ loading: false, playing: false, error: '' });
      }
      return;
    }
    try {
      if (play) {
        if (!this.sourceReady && this.value.track)
          return this.play(this.value.track, this.value.queue);
        this.attempt?.abort();
        const attempt = new AbortController();
        this.attempt = attempt;
        await this.resumeOutput(attempt.signal);
        if (!this.wantPlay || attempt.signal.aborted) return;
        await playbackStep(
          this.element().play(),
          attempt.signal,
          20000,
          '音频未能开始播放，请重试。',
        );
        if (!this.wantPlay || attempt.signal.aborted) {
          this.audio?.pause();
          return;
        }
        this.update({ error: '' });
      } else {
        this.attempt?.abort();
        this.audio?.pause();
      }
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) {
        this.wantPlay = false;
        this.audio?.pause();
        this.update({ error: playbackMessage(cause), playing: false });
      }
    }
  }
  async next(direction: number, ended = false) {
    const state = this.value,
      preferences = useMusicPreferences.getState();
    if (!state.queue.length) return;
    let index = state.index + direction;
    if (ended && preferences.repeat === 'one') index = state.index;
    else if (preferences.shuffle && state.queue.length > 1) {
      index = Math.floor(Math.random() * (state.queue.length - 1));
      if (index >= state.index) index++;
    }
    if (index >= state.queue.length && preferences.repeat === 'off') return;
    index = (index + state.queue.length) % state.queue.length;
    const track = state.queue[index];
    if (track) await this.play(track, state.queue);
  }
  seek(seconds: number) {
    if (this.audio && Number.isFinite(seconds)) {
      this.audio.currentTime = Math.max(0, Math.min(seconds, this.value.duration));
      this.update({ position: this.audio.currentTime });
    }
  }
  seekLyric(seconds: number) {
    this.seek(seconds - this.value.clipStart);
  }
  applyMetadata(track: MusicTrack) {
    if (this.value.track?.key !== track.key) return;
    this.update({
      track,
      queue: this.value.queue.map((item) => (item.key === track.key ? track : item)),
    });
    if ('mediaSession' in navigator)
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: track.artists.join(' / '),
        album: track.album,
        ...(track.cover ? { artwork: [{ src: track.cover }] } : {}),
      });
  }
  volume(value: number) {
    const volume = Math.max(0, Math.min(value, 1));
    this.element().volume = volume;
    useMusicPreferences.getState().patch({ volume });
  }
  /** 只在用户明确进入演绎时创建 WebAudio；普通模式保留直连声音输出。 */
  async enableAnalysis(enabled: boolean) {
    this.analysis = enabled;
    if (enabled && !this.context) {
      const context = new AudioContext();
      this.context = context;
      this.source = context.createMediaElementSource(this.element());
      this.analyser = context.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.6;
    }
    this.source?.disconnect();
    this.analyser?.disconnect();
    if (this.source && this.context) {
      if (enabled && this.analyser) {
        this.source.connect(this.analyser);
        this.analyser.connect(this.context.destination);
      } else this.source.connect(this.context.destination);
      if (this.context.state === 'suspended') await this.resumeOutput(new AbortController().signal);
    }
  }
  /** 仅时间投影，不运行 FFT；供低频桌面歌词 IPC 使用。 */
  lyricClock() {
    return {
      positionMs: ((this.audio?.currentTime ?? this.value.position) + this.value.clipStart) * 1000,
      paused: !this.value.playing,
    };
  }
  clock() {
    if (this.analysis && this.analyser && this.value.playing)
      this.analyser.getByteFrequencyData(this.spectrum);
    else this.spectrum.fill(0);
    const sampleRate = this.context?.sampleRate ?? 48000,
      bin = sampleRate / 2048;
    const mean = (low: number, high: number) => {
      const start = Math.max(0, Math.floor(low / bin)),
        end = Math.min(this.spectrum.length - 1, Math.floor(high / bin));
      let sum = 0;
      for (let i = start; i <= end; i++) sum += this.spectrum[i] ?? 0;
      return end >= start ? sum / (end - start + 1) : 0;
    };
    // 与上游同样的五频段、非线性增益和 0..255 约定；用实际采样率换算 FFT 频率。
    const bass = mean(20, 150),
      lowMid = mean(150, 400),
      mid = mean(400, 1200),
      vocal = mean(1000, 3500),
      treble = mean(3500, 12000);
    const processBand = (value: number, boost: number) => Math.pow(value / 255, boost) * 255;
    const breath = (Math.sin(Date.now() / 2000) + 1) * 20;
    return {
      kind: 'clock',
      seconds: (this.audio?.currentTime ?? 0) + this.value.clipStart,
      paused: !this.value.playing,
      power: this.value.playing ? processBand((bass + lowMid) / 2, 3) : breath,
      bands: this.value.playing
        ? [
            processBand(bass, 1.8),
            processBand(lowMid, 2),
            processBand(mid, 2),
            processBand(vocal, 1.5),
            processBand(treble, 2),
          ]
        : [breath, breath, breath, breath, breath],
      spectrum: this.value.playing ? Array.from(this.spectrum) : [],
    };
  }
}
export const musicPlayer = new MusicPlayer();
export function useMusicPlayer() {
  return useSyncExternalStore(musicPlayer.subscribe, musicPlayer.snapshot);
}
export function useMusicTrack() {
  return useSyncExternalStore(musicPlayer.subscribe, () => musicPlayer.snapshot().track);
}
export function useMusicPlaying() {
  return useSyncExternalStore(musicPlayer.subscribe, () => musicPlayer.snapshot().playing);
}
