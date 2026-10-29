import type { HudLive, HudRender } from '@/lib/hud-contracts';
const size = (value: number) => {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let n = value,
    index = 0;
  while (n >= 1024 && index < units.length - 1) {
    n /= 1024;
    index++;
  }
  return `${n.toFixed(index ? 1 : 0)} ${units[index]}`;
};

/** 只派生显示文本；既不制造传感器值，也不把未知 FPS 填成零。 */
export function renderScene(live: HudLive): HudRender {
  if (live.scene === '@media')
    return {
      tagline: '/// NOW PLAYING',
      title: live.media?.title || '当前媒体',
      primaryText: live.media?.title || '—',
      secondaryText: live.media?.artist || live.media?.source || '',
      rightText:
        (
          {
            playing: '播放中',
            paused: '已暂停',
            stopped: '已停止',
            closed: '已关闭',
            opened: '已就绪',
            changing: '切换中',
          } as Record<string, string>
        )[live.media?.status ?? ''] ?? '状态未知',
      rightSuffix: '',
      progress:
        live.media?.durationSeconds && live.media.positionSeconds != null
          ? Math.min(1, live.media.positionSeconds / live.media.durationSeconds)
          : 0,
      progressAvailable: !!live.media?.durationSeconds && live.media.positionSeconds != null,
      leftIcon: 'activity',
      rightIcon: 'activity',
      accentColor: '#C6CA4C',
      simpleAnimation: true,
    };
  if (live.scene?.startsWith('@downloads')) {
    const download = live.scene.includes(':')
      ? live.downloads?.find((task) => task.id === live.scene?.slice(11))
      : live.downloads?.[0];
    const progress = download?.total ? Math.min(1, download.downloaded / download.total) : 0;
    return {
      tagline: '/// DOWNLOAD',
      title: download?.name ?? '下载任务',
      primaryText: download?.name ?? '下载任务',
      secondaryText: download
        ? `${size(download.downloaded)}${download.total ? ` / ${size(download.total)}` : ''}`
        : '',
      rightText: download?.total ? `${Math.round(progress * 100)}` : '处理中',
      rightSuffix: download?.total ? '%' : '',
      progress,
      progressAvailable: !!download?.total,
      leftIcon: 'download',
      rightIcon: 'download',
      accentColor: '#C6CA4C',
      simpleAnimation: true,
    };
  }
  return (
    live.render ?? {
      tagline: '/// ZHENJING HUD',
      title: '正在连接真实数据',
      primaryText: '—',
      secondaryText: '等待采集',
      rightText: '—',
      rightSuffix: '',
      progress: 0,
      progressAvailable: false,
      leftIcon: 'cpu',
      rightIcon: 'gauge',
      accentColor: '#C6CA4C',
      simpleAnimation: false,
    }
  );
}
