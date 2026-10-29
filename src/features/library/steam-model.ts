import type { SteamGame } from '@/lib/steam-contracts';
export const PAGE_SIZE = 24;
export function bytesText(bytes: number | null) {
  if (bytes === null) return '不可用';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes,
    index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index++;
  }
  return `${value.toLocaleString('zh-CN', { maximumFractionDigits: index ? 1 : 0 })} ${units[index] ?? 'B'}`;
}
export function playtimeText(minutes: number | null) {
  return minutes === null
    ? '时长未缓存'
    : `${(minutes / 60).toLocaleString('zh-CN', { maximumFractionDigits: 1 })} 小时`;
}
export function playedText(timestamp: number | null) {
  return timestamp === null
    ? '无游玩记录'
    : new Date(timestamp * 1000).toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
}
export type SteamFilter = 'all' | 'installed' | 'uninstalled' | 'owned' | 'favorites';
export type SteamSort = 'recent' | 'name' | 'playtime' | 'size';
export function selectSteamGames(
  games: readonly SteamGame[],
  query: string,
  filter: SteamFilter,
  sort: SteamSort,
  favorites: readonly string[],
  library: string,
) {
  const text = query.trim().toLocaleLowerCase(),
    ids = new Set(favorites);
  return games
    .filter(
      (game) =>
        (!text || `${game.name} ${game.appId}`.toLocaleLowerCase().includes(text)) &&
        (!library || game.libraryId === library) &&
        (filter === 'all' ||
          (filter === 'installed' && game.installed) ||
          (filter === 'uninstalled' && !game.installed) ||
          (filter === 'owned' && game.owned === true) ||
          (filter === 'favorites' && ids.has(`steam:${game.appId}`))),
    )
    .sort((a, b) =>
      sort === 'name'
        ? a.name.localeCompare(b.name, 'zh-CN', { numeric: true })
        : sort === 'playtime'
          ? (b.playtimeMinutes ?? -1) - (a.playtimeMinutes ?? -1)
          : sort === 'size'
            ? (b.sizeBytes ?? -1) - (a.sizeBytes ?? -1)
            : (b.lastPlayed ?? -1) - (a.lastPlayed ?? -1),
    );
}
