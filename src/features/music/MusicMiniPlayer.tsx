import { useLocation, useNavigate } from 'react-router-dom';
import { faMusic, faPause, faPlay, faForwardStep } from '@fortawesome/free-solid-svg-icons';
import { Icon } from '@/features/home/components/Icon';
import { musicPlayer, useMusicPlayer } from './player';
import './music.css';

/** 切换工具或游戏库不销毁音频；跨页只保留轻量控制，不挂载歌词画布。 */
export default function MusicMiniPlayer() {
  const player = useMusicPlayer(),
    location = useLocation(),
    navigate = useNavigate();
  if (!player.track || location.pathname === '/music') return null;
  return (
    <aside className="music-global-mini glass" aria-label="音乐正在后台播放">
      <button
        type="button"
        onClick={() => {
          void navigate('/music');
        }}
      >
        <Icon icon={faMusic} />
        <span>{player.track.title}</span>
      </button>
      <button
        type="button"
        aria-label={player.playing ? '暂停音乐' : '继续播放音乐'}
        onClick={() => {
          void musicPlayer.toggle();
        }}
      >
        <Icon icon={player.playing ? faPause : faPlay} />
      </button>
      <button
        type="button"
        aria-label="下一首音乐"
        onClick={() => {
          void musicPlayer.next(1);
        }}
      >
        <Icon icon={faForwardStep} />
      </button>
    </aside>
  );
}
