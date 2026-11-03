import { z } from 'zod';
import {
  faPlay,
  faPause,
  faBackwardStep,
  faForwardStep,
  faWandMagicSparkles,
  faVolumeHigh,
} from '@fortawesome/free-solid-svg-icons';
import { Icon } from '@/features/home/components/Icon';
import { musicStyleSchema, type MusicTrack } from '@/lib/music-contracts';
import { musicPlayer, useMusicPlayer } from './player';
import { useMusicPreferences, MUSIC_STYLES } from './preferences';
import { MusicCover as Cover } from './MusicCover';
import { minute, providerLabel } from './model';

/** 进度、歌词只在播放面板订阅时钟，不让曲库列表随每次 timeupdate 重绘。 */
export function MusicNowPlaying({
  onMatch,
  onSettings,
}: {
  onMatch: (track: MusicTrack) => void;
  onSettings: () => void;
}) {
  const playback = useMusicPlayer();
  return (
    <aside className="music-now glass">
      <div className="music-now-top">
        <span>正在聆听</span>
        <span>{playback.track ? providerLabel(playback.track.provider) : '等待播放'}</span>
      </div>
      <Cover track={playback.track} large />
      <h2>{playback.track?.title ?? '让音乐陪你片刻'}</h2>
      <p>{playback.track?.artists.join(' / ') || '选择一首歌曲，开始播放'}</p>
      {playback.preview && <span className="music-preview">平台提供的试听片段</span>}
      <div className="music-lyric-preview" aria-label="当前歌词">
        {playback.lyrics.lines.length ? (
          playback.lyrics.lines
            .filter(
              (line) =>
                line.startTime <= playback.position + playback.clipStart + 8 &&
                line.endTime >= playback.position + playback.clipStart - 8,
            )
            .slice(-4)
            .map((line, index) => (
              <button
                key={`${line.startTime}:${index}`}
                type="button"
                className={
                  line.startTime <= playback.position + playback.clipStart &&
                  line.endTime >= playback.position + playback.clipStart
                    ? 'active'
                    : ''
                }
                onClick={() => musicPlayer.seekLyric(line.startTime)}
              >
                {line.fullText}
              </button>
            ))
        ) : (
          <p>
            {playback.track ? '暂无同步歌词，可使用在线匹配或导入本地歌词' : '歌词会在这里轻轻展开'}
          </p>
        )}
      </div>
      {playback.track && (
        <button
          type="button"
          className="music-match-button"
          onClick={() => {
            if (playback.track) onMatch(playback.track);
          }}
        >
          <Icon icon={faWandMagicSparkles} />
          匹配封面与歌词
        </button>
      )}
      <button type="button" className="music-now-settings" onClick={onSettings}>
        播放与演绎设置
      </button>
    </aside>
  );
}
export function MusicEffects({ onTheme }: { onTheme: () => void }) {
  const preferences = useMusicPreferences();
  return (
    <>
      <div className="music-performance">
        <label>
          渲染策略
          <select
            aria-label="渲染策略"
            value={preferences.renderPolicy}
            onChange={(event) =>
              preferences.patch({
                renderPolicy: z.enum(['auto', 'original', 'efficient']).parse(event.target.value),
              })
            }
          >
            <option value="auto">自动适配显卡</option>
            <option value="original">原画效果</option>
            <option value="efficient">低开销</option>
          </select>
        </label>
        <label>
          音质
          <select
            aria-label="音质"
            value={preferences.quality}
            onChange={(event) =>
              preferences.patch({
                quality: z
                  .enum(['standard', 'high', 'lossless', 'hires'])
                  .parse(event.target.value),
              })
            }
          >
            <option value="standard">标准</option>
            <option value="high">高音质</option>
            <option value="lossless">无损</option>
            <option value="hires">Hi-Res</option>
          </select>
        </label>
        <label>
          演绎样式
          <select
            value={preferences.style}
            onChange={(event) => {
              const style = musicStyleSchema.safeParse(event.target.value);
              if (style.success) preferences.patch({ style: style.data });
            }}
          >
            {MUSIC_STYLES.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          配色
          <select
            value={preferences.themeSource}
            onChange={(event) => {
              const themeSource = z.enum(['default', 'cover', 'custom']).parse(event.target.value);
              preferences.patch({ themeSource });
            }}
          >
            <option value="default">Folia 原版默认</option>
            <option value="cover">封面提取</option>
            <option value="custom" disabled={!preferences.customTheme}>
              自定义
            </option>
          </select>
        </label>
        <label>
          明暗
          <select
            value={preferences.daylight ? 'light' : 'dark'}
            onChange={(event) => preferences.patch({ daylight: event.target.value === 'light' })}
          >
            <option value="dark">午夜墨染</option>
            <option value="light">日光素白</option>
          </select>
        </label>
        <button type="button" onClick={() => onTheme()}>
          编辑主题
        </button>
      </div>
      <small className="music-help">
        动画默认关闭；点击“沉浸演绎”后才加载全屏效果。Esc 返回普通播放器。
      </small>
    </>
  );
}
export function MusicControls() {
  const playback = useMusicPlayer(),
    preferences = useMusicPreferences();
  return (
    <section className="music-controls glass" aria-label="播放控制">
      <div className="music-mini-track">
        <Cover track={playback.track} />
        <span>
          <b>{playback.track?.title ?? '尚未播放'}</b>
          <small>
            {playback.error ||
              (playback.loading
                ? '正在连接音源…'
                : playback.track?.artists.join(' / ') || '本地与在线音乐，汇聚于此')}
          </small>
        </span>
      </div>
      <div className="music-transport">
        <div>
          <button
            type="button"
            aria-label="上一曲"
            disabled={!playback.track}
            onClick={() => {
              void musicPlayer.next(-1);
            }}
          >
            <Icon icon={faBackwardStep} />
          </button>
          <button
            className="music-play"
            type="button"
            aria-label={playback.loading ? '取消加载' : playback.playing ? '暂停' : '播放'}
            disabled={!playback.track}
            onClick={() => {
              void musicPlayer.toggle();
            }}
          >
            <Icon icon={playback.playing ? faPause : faPlay} />
          </button>
          <button
            type="button"
            aria-label="下一曲"
            disabled={!playback.track}
            onClick={() => {
              void musicPlayer.next(1);
            }}
          >
            <Icon icon={faForwardStep} />
          </button>
          <button
            className="music-repeat"
            type="button"
            onClick={() =>
              preferences.patch({
                repeat:
                  preferences.repeat === 'queue'
                    ? 'one'
                    : preferences.repeat === 'one'
                      ? 'off'
                      : 'queue',
              })
            }
          >
            {{ queue: '列表循环', one: '单曲循环', off: '顺序播放' }[preferences.repeat]}
          </button>
        </div>
        <div className="music-seek">
          <small>{minute(playback.position)}</small>
          <input
            type="range"
            aria-label="播放进度"
            min={0}
            max={playback.duration || 1}
            step={0.1}
            value={Math.min(playback.position, playback.duration || 1)}
            disabled={!playback.track}
            onChange={(event) => musicPlayer.seek(Number(event.target.value))}
          />
          <small>{minute(playback.duration)}</small>
        </div>
      </div>
      <div className="music-volume">
        <Icon icon={faVolumeHigh} />
        <input
          type="range"
          aria-label="音量"
          min={0}
          max={1}
          step={0.01}
          value={preferences.volume}
          onChange={(event) => musicPlayer.volume(Number(event.target.value))}
        />
      </div>
      {playback.error && (
        <div className="music-playback-error" role="alert">
          <span>{playback.error}</span>
          {playback.track && (
            <button
              type="button"
              onClick={() => {
                if (playback.track) void musicPlayer.play(playback.track, playback.queue);
              }}
            >
              重试播放
            </button>
          )}
        </div>
      )}
    </section>
  );
}
