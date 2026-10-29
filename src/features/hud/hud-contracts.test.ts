import { describe, expect, it } from 'vitest';
import { hudConfigSchema, hudLiveSchema, hudRequestSchema } from '@/lib/hud-contracts';
import { renderScene } from './presentation';
import presets from './upstream-presets.json';
import { keepNewerHudReadings } from './model';

describe('HUD 真实数据边界', () => {
  it('配置刷新晚于推送时保留新读数并应用新配置', () => {
    const live = { capturedAt: 200, scene: '@game' };
    const merged = keepNewerHudReadings(
      { config: { scale: 0.8 }, live },
      { config: { scale: 0.6 }, live: { capturedAt: 100, scene: 'system.memory' } },
    );
    expect(merged).toEqual({ config: { scale: 0.6 }, live });
    expect(keepNewerHudReadings(undefined, { live })).toEqual({ live });
  });
  it('未知读数和无长度的下载不伪装成有效零值', () => {
    const empty = renderScene({ scene: '@waiting' });
    expect(empty.primaryText).toBe('—');
    expect(empty.progressAvailable).toBe(false);
    const unknown = renderScene({
      scene: '@downloads',
      downloads: [{ id: 'a', name: 'a', downloaded: 2048, total: null, status: 'running' }],
    });
    expect(unknown.progressAvailable).toBe(false);
    expect(unknown.rightSuffix).toBe('');
  });
  it('按下载标识展示对应真实进度，且进度不会溢出', () => {
    const output = renderScene({
      scene: '@downloads:b',
      downloads: [
        { id: 'a', name: 'first', downloaded: 1, total: 10, status: 'running' },
        { id: 'b', name: 'second', downloaded: 20, total: 10, status: 'verifying' },
      ],
    });
    expect(output.title).toBe('second');
    expect(output.progress).toBe(1);
    expect(output.rightText).toBe('100');
  });
  it('媒体进度只取 Windows 返回的时间线', () => {
    const output = renderScene({
      scene: '@media',
      media: {
        available: true,
        title: 'song',
        artist: 'artist',
        source: 'player',
        status: 'playing',
        error: null,
        positionSeconds: 15,
        durationSeconds: 60,
      },
    });
    expect(output.progress).toBe(0.25);
    expect(output.progressAvailable).toBe(true);
  });
  it('拒绝非有限传感器数字与额外原生命令字段', () => {
    expect(hudLiveSchema.safeParse({ metrics: { cpu: Infinity } }).success).toBe(false);
    expect(
      hudRequestSchema.safeParse({ operation: 'media', action: 'run', path: 'cmd.exe' }).success,
    ).toBe(false);
    expect(hudRequestSchema.safeParse({ operation: 'drag', command: 'anything' }).success).toBe(
      false,
    );
  });
  it('完整保留上游十二种内置方案，拒绝重复和悬空轮播标识', () => {
    expect(presets).toHaveLength(12);
    const raw = {
      version: 1,
      enabled: false,
      mode: 'auto',
      scale: 0.8,
      opacity: 1,
      monitor: 0,
      position: 'top-center',
      x: 0,
      y: 12,
      locked: false,
      layer: 'topmost',
      alwaysShow: true,
      hotzone: true,
      powerEvents: true,
      displaySeconds: 6,
      cycleSeconds: 8,
      animation: 'full',
      bounce: 0.275,
      ripple: 1,
      spread: 1,
      fontScale: 1,
      reducedMotion: false,
      samplingMs: 1000,
      frames: false,
      activeProfile: 'system.memory',
      queue: ['system.memory'],
      profiles: presets,
      deepseekKey: '',
      httpSources: [],
      includeProcesses: [],
      excludeProcesses: [],
    };
    expect(hudConfigSchema.safeParse(raw).success).toBe(true);
    expect(hudConfigSchema.safeParse({ ...raw, queue: ['missing'] }).success).toBe(false);
    expect(hudConfigSchema.safeParse({ ...raw, profiles: [...presets, presets[0]] }).success).toBe(
      false,
    );
  });
});
