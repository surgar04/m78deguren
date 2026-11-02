import { MUSIC_PROVIDERS } from './preferences';
export const minute = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
export const providerLabel = (provider: string) =>
  MUSIC_PROVIDERS.find((row) => row[0] === provider)?.[1] ?? '本地音乐';
