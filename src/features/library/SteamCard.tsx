import { useState } from 'react';
import { faHeart, faPlay, faDownload } from '@fortawesome/free-solid-svg-icons';
import { faHeart as faHeartOutline } from '@fortawesome/free-regular-svg-icons';
import { Icon } from '@/features/home/components/Icon';
import type { SteamGame } from '@/lib/steam-contracts';
import { useSteamImage } from './repository';
import { playtimeText, playedText } from './steam-model';
export function SteamCard({
  game,
  favorite,
  onFavorite,
  onDetails,
  onLaunch,
  disabled,
}: {
  game: SteamGame;
  favorite: boolean;
  onFavorite: () => void;
  onDetails: () => void;
  onLaunch: () => void;
  disabled: boolean;
}) {
  const image = useSteamImage('game', String(game.appId));
  const [remoteFailed, setRemoteFailed] = useState(false);
  const [localFailed, setLocalFailed] = useState(false);
  // 先使用本机封面缓存；远程仅允许 Valve 固定 CDN，失败保留排版和真实名称，不替换成其他游戏素材。
  const source =
    (!localFailed ? image.data : null) ??
    (!remoteFailed
      ? `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${game.appId}/header.jpg`
      : null);
  return (
    <article className="catalog-card steam-card" aria-label={game.name}>
      {source ? (
        <img
          className="catalog-art"
          src={source}
          alt=""
          loading="lazy"
          onError={() => {
            if (source === image.data) setLocalFailed(true);
            else setRemoteFailed(true);
          }}
        />
      ) : (
        <div className="steam-cover-empty">{game.name}</div>
      )}
      <button
        className="catalog-open"
        type="button"
        aria-label={`查看${game.name}详情`}
        onClick={onDetails}
      />
      <button
        type="button"
        className={`catalog-favorite ${favorite ? 'is-favorite' : ''}`}
        aria-label={`${favorite ? '取消收藏' : '收藏'}${game.name}`}
        aria-pressed={favorite}
        onClick={onFavorite}
      >
        <Icon icon={favorite ? faHeart : faHeartOutline} />
      </button>
      <span className={`steam-install-badge ${game.installed ? 'installed' : ''}`}>
        {game.installed ? (game.installComplete ? '已安装' : '安装未完成') : '未安装'}
      </span>
      <div className="catalog-caption">
        <h2>{game.name}</h2>
        <div className="catalog-meta">
          <span>{playtimeText(game.playtimeMinutes)}</span>
          <span className="catalog-last">{playedText(game.lastPlayed)}</span>
        </div>
      </div>
      <button
        type="button"
        className="catalog-launch"
        onClick={onLaunch}
        disabled={disabled}
        aria-label={`${game.installed ? '启动' : '安装'}：${game.name}`}
      >
        <Icon icon={game.installed ? faPlay : faDownload} />
        {game.installed ? '开始游戏' : '安装游戏'}
      </button>
    </article>
  );
}
