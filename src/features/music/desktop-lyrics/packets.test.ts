import { expect, it } from 'vitest';
import { desktopClockPosition, desktopContent } from './packets';
import {
  desktopLyricsConfigSchema,
  musicRequestSchema,
  musicTrackSchema,
} from '@/lib/music-contracts';

it('桌面歌词保留逐字真实时间，剥离不需要的视觉扩展', () => {
  const track = musicTrackSchema.parse({
    key: 'qq:1',
    id: '1',
    provider: 'qq',
    title: '测试',
    artists: ['歌手'],
    album: '',
    durationMs: 2000,
    cover: null,
  });
  const value = desktopContent(track, {
    source: '测试',
    wordTimed: true,
    isPureMusic: false,
    lines: [
      {
        fullText: '测试',
        startTime: 1,
        endTime: 2,
        words: [{ text: '测试', startTime: 1.2, endTime: 1.8 }],
        extraVisual: { large: 'ignored' },
      },
    ],
  });
  expect(value?.lyrics.lines[0]?.words[0]?.startTime).toBe(1.2);
  expect(value?.lyrics.lines[0]).not.toHaveProperty('extraVisual');
  expect(
    desktopContent(null, { source: '', wordTimed: false, isPureMusic: false, lines: [] }),
  ).toBeNull();
});
it('暂停冻结时钟，后台断线不允许歌词无界向前漂移', () => {
  expect(desktopClockPosition(1000, true, 500)).toBe(1000);
  expect(desktopClockPosition(1000, false, 250)).toBe(1250);
  expect(desktopClockPosition(1000, false, 90000)).toBe(6000);
});
it('辅助窗口参数不接受任意窗口、Shell 或越界不透明度', () => {
  expect(
    musicRequestSchema.safeParse({
      operation: 'desktop-control',
      action: 'execute',
      command: 'cmd.exe',
    }).success,
  ).toBe(false);
  expect(
    musicRequestSchema.safeParse({
      operation: 'desktop-clock',
      clock: { positionMs: Infinity, paused: false },
    }).success,
  ).toBe(false);
  expect(
    desktopLyricsConfigSchema.safeParse({
      enabled: true,
      locked: false,
      fontSize: 32,
      opacity: 2,
      x: null,
      y: null,
    }).success,
  ).toBe(false);
});
