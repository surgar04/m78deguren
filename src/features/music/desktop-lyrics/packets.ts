import type { MusicLyrics, MusicTrack } from '@/lib/music-contracts';
import type { DesktopLyricsContent } from './contracts';
/** 去除上游视觉扩展字段，保持跨窗口消息紧凑；不虚构逐字时间。 */
export function desktopContent(
  track: MusicTrack | null,
  lyrics: MusicLyrics,
): DesktopLyricsContent | null {
  if (!track) return null;
  return {
    key: track.key,
    title: track.title,
    artist: track.artists.join(' / '),
    lyrics: {
      source: lyrics.source,
      wordTimed: lyrics.wordTimed,
      isPureMusic: lyrics.isPureMusic,
      lines: lyrics.lines.slice(0, 5000).map((line) => ({
        fullText: line.fullText,
        startTime: line.startTime,
        endTime: Math.max(line.startTime, line.endTime),
        words: line.words.slice(0, 1000).map((word) => ({
          text: word.text,
          startTime: word.startTime,
          endTime: Math.max(word.startTime, word.endTime),
        })),
        ...(line.translation ? { translation: line.translation } : {}),
        ...(line.romanization ? { romanization: line.romanization } : {}),
      })),
    },
  };
}
export function desktopClockPosition(position: number, paused: boolean, elapsed: number): number {
  return Math.min(
    604800000,
    Math.max(0, position + (paused ? 0 : Math.min(5000, Math.max(0, elapsed)))),
  );
}
