import { describe, expect, it } from 'vitest';
import {
  musicRequestSchema,
  musicStyleSchema,
  musicTrackSchema,
  musicLyricsSchema,
} from '@/lib/music-contracts';
import { MUSIC_STYLES } from './preferences';
import upstreamModes from '../../../integrations/folia-engine/upstream/src/types/visualizerModes.ts?raw';
const modes = (name: string) =>
  [
    ...(
      upstreamModes.match(new RegExp(`${name} = \\[([\\s\\S]*?)\\] as const`, 'u'))?.[1] ?? ''
    ).matchAll(/'([^']+)'/gu),
  ].map((match) => match[1]);
const BUILTIN_VISUALIZER_MODES = modes('BUILTIN_VISUALIZER_MODES');
const BUILTIN_VISUALIZER_BACKGROUND_MODES = modes('BUILTIN_VISUALIZER_BACKGROUND_MODES');

describe('音乐接入契约', () => {
  it('17 种模式与固定上游权威清单一致，防止升级时遗漏渲染器', () => {
    expect(new Set(MUSIC_STYLES.map((row) => row[0]))).toEqual(new Set(BUILTIN_VISUALIZER_MODES));
    expect(new Set(musicStyleSchema.options)).toEqual(new Set(BUILTIN_VISUALIZER_MODES));
    expect(BUILTIN_VISUALIZER_BACKGROUND_MODES).toHaveLength(6);
  });
  it('本地播放只接收登记身份，禁止任意文件路径和 Shell 参数', () => {
    expect(
      musicRequestSchema.safeParse({ operation: 'local-audio', id: 'D:/private.mp3' }).success,
    ).toBe(false);
    expect(
      musicRequestSchema.safeParse({ operation: 'local-import', folder: true, path: 'C:/' })
        .success,
    ).toBe(false);
    expect(
      musicRequestSchema.safeParse({
        operation: 'local-reveal',
        id: crypto.randomUUID(),
        command: 'cmd',
      }).success,
    ).toBe(false);
  });
  it('逐字、和声及译文扩展保留真实时间，拒绝非有限时间', () => {
    const lines = [
      {
        fullText: '验收',
        startTime: 1.25,
        endTime: 2.8,
        words: [
          { text: '验', startTime: 1.25, endTime: 1.7 },
          { text: '收', startTime: 2.1, endTime: 2.8 },
        ],
        isBackground: true,
        translation: 'test',
      },
    ];
    expect(
      musicLyricsSchema.parse({ lines, source: 'fixture', wordTimed: true, isPureMusic: false })
        .lines,
    ).toEqual(lines);
    expect(
      musicLyricsSchema.safeParse({
        lines: [{ ...lines[0], startTime: Infinity }],
        source: 'fixture',
        wordTimed: true,
        isPureMusic: false,
      }).success,
    ).toBe(false);
  });
  it('不同平台的媒体身份不会合并，未知平台不能进入播放器', () => {
    const track = {
      key: 'qq:123',
      id: '123',
      provider: 'qq',
      title: '测试',
      artists: [],
      album: '',
      durationMs: 2000,
      cover: null,
    };
    expect(musicTrackSchema.parse(track).provider).toBe('qq');
    expect(musicTrackSchema.safeParse({ ...track, provider: 'arbitrary' }).success).toBe(false);
  });
});
