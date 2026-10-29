import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { z } from 'zod';
import { executeTool, recordingMediaUrl } from './desktop';
import {
  toolRequestSchema,
  recordingsSchema,
  downloadsSchema,
  speedSchema,
} from './tool-contracts';

beforeEach(() => vi.stubGlobal('isTauri', true));
afterEach(() => {
  clearMocks();
  vi.unstubAllGlobals();
});

describe('原生工具IPC边界', () => {
  it('网关只接受已定义操作、数据类型、明确的安装同意及限速范围', () => {
    for (const input of [
      { operation: 'run-shell', command: 'whoami' },
      { operation: 'catalog', script: 'extra' },
      { operation: 'runtime-install', token: 'token', consent: false },
      { operation: 'download-limit', limitKib: -1 },
      { operation: 'download-limit', limitKib: 2_000_000 },
      { operation: 'ntp-query', server: 'untrusted-server' },
      { operation: 'recording-rename', id: 'token', name: '../video.mp4' },
    ])
      expect(toolRequestSchema.safeParse(input).success).toBe(false);
  });
  it('只向固定Rust命令发送结构化请求，校验返回数据而不作类型断言', async () => {
    mockIPC((command, args) => {
      expect(command).toBe('tools_execute');
      expect(args).toEqual({ request: { operation: 'downloads-list' } });
      return [];
    });
    await expect(executeTool({ operation: 'downloads-list' }, downloadsSchema)).resolves.toEqual(
      [],
    );
    mockIPC(() => ({ running: true, downloadMbps: '假值' }));
    await expect(executeTool({ operation: 'speed-status' }, speedSchema)).rejects.toBeInstanceOf(
      z.ZodError,
    );
  });
  it('普通浏览器不能退回模拟工具；媒体地址不接受磁盘路径', async () => {
    for (const path of ['D:/video.mp4', '../escape', 'not-an-id'])
      expect(() => recordingMediaUrl(path)).toThrow();
    vi.stubGlobal('isTauri', false);
    await expect(executeTool({ operation: 'downloads-list' }, downloadsSchema)).rejects.toThrow(
      '桌面应用',
    );
  });
  it('录屏快照只接受摘要ID，无文件时保持真实空数组', () => {
    expect(
      recordingsSchema.parse({ roots: [], files: [], removed: [], truncated: false }).files,
    ).toEqual([]);
    expect(
      recordingsSchema.safeParse({
        roots: [],
        files: [{ id: '../video' }],
        removed: [],
        truncated: false,
      }).success,
    ).toBe(false);
  });
});
