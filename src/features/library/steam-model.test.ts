import { describe, it, expect } from 'vitest';
import { selectSteamGames, bytesText, playedText, playtimeText } from './steam-model';
import { steamGameSchema, steamRequestSchema } from '@/lib/steam-contracts';
const first = steamGameSchema.parse({
  appId: 10,
  name: '测试游戏甲',
  installed: true,
  installComplete: true,
  libraryId: 'a',
  installPath: 'D:/Games/Test',
  sizeBytes: 1024,
  playtimeMinutes: 120,
  lastPlayed: 100,
  owned: null,
  evidence: 'installed-manifest',
});
const second = steamGameSchema.parse({
  ...first,
  appId: 20,
  name: '测试游戏乙',
  installed: false,
  installComplete: false,
  libraryId: null,
  installPath: null,
  sizeBytes: null,
  playtimeMinutes: null,
  lastPlayed: null,
  owned: true,
});
describe('Steam 真实契约与派生视图', () => {
  it('不把安装当成所有权，组合搜索、收藏、所在库和时长排序', () => {
    const games = [first, second];
    expect(selectSteamGames(games, '', 'owned', 'recent', [], '')).toEqual([second]);
    expect(selectSteamGames(games, '20', 'all', 'name', [], '')).toEqual([second]);
    expect(selectSteamGames(games, '', 'favorites', 'recent', ['steam:10'], 'a')).toEqual([first]);
    expect(selectSteamGames(games, '', 'uninstalled', 'recent', [], 'a')).toEqual([]);
    expect(games).toEqual([first, second]);
  });
  it('区分未知值和真实零值；拒绝路径注入及未确认账号操作', () => {
    expect(bytesText(0)).toBe('0 B');
    expect(bytesText(null)).toBe('不可用');
    expect(playtimeText(0)).toBe('0 小时');
    expect(playtimeText(null)).toBe('时长未缓存');
    expect(playedText(null)).toBe('无游玩记录');
    expect(
      steamRequestSchema.safeParse({
        operation: 'launch',
        kind: 'install',
        appId: -1,
        consent: true,
      }).success,
    ).toBe(false);
    expect(
      steamRequestSchema.safeParse({
        operation: 'account',
        kind: 'remove',
        id: '76561197960265729',
        revision: 'a'.repeat(64),
        consent: false,
      }).success,
    ).toBe(false);
  });
});
