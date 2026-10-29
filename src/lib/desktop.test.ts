import { hardwareReceiptSchema, hardwareRequestSchema } from './hardware-contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { errorMessage, executeHardware, getAppInfo, greet, greetingFormSchema } from './desktop';

beforeEach(() => {
  vi.stubGlobal('isTauri', true);
});
afterEach(() => {
  clearMocks();
  vi.unstubAllGlobals();
});

describe('IPC 边界', () => {
  it('在普通浏览器中明确提示缺少原生后端', async () => {
    vi.stubGlobal('isTauri', false);
    await expect(getAppInfo()).rejects.toThrow('桌面应用');
  });
  it('校验并传递名字，解析 Rust 返回的数据', async () => {
    mockIPC((command, args) => {
      expect(command).toBe('greet');
      expect(args).toEqual({ name: '臻境' });
      return { message: '你好，臻境！' };
    });
    await expect(greet({ name: ' 臻境 ' })).resolves.toEqual({ message: '你好，臻境！' });
  });

  it('拒绝后端返回的不兼容结构', async () => {
    mockIPC(() => ({ version: 123 }));
    await expect(getAppInfo()).rejects.toThrow();
  });
  it('硬件报告只传时间范围，拒绝任意导出路径', async () => {
    mockIPC((command, args) => {
      expect(command).toBe('hardware_execute');
      expect(args).toEqual({ request: { operation: 'export', from: null, to: null } });
      return { path: 'D:/reports/hardware.html', bytes: 1024, points: 1, totalSamples: 1 };
    });
    await expect(
      executeHardware({ operation: 'export', from: null, to: null }, hardwareReceiptSchema),
    ).resolves.toMatchObject({ points: 1 });
    mockIPC(() => ({
      path: 'C:/Users/小明/AppData/Local/Zhenjing/reports/report.html',
      bytes: 1024,
      points: 1,
      totalSamples: 1,
    }));
    await expect(
      executeHardware({ operation: 'export', from: null, to: null }, hardwareReceiptSchema),
    ).resolves.toMatchObject({ points: 1 });
    mockIPC(() => ({
      path: '//server/share/report.html',
      bytes: 1024,
      points: 1,
      totalSamples: 1,
    }));
    await expect(
      executeHardware({ operation: 'export', from: null, to: null }, hardwareReceiptSchema),
    ).rejects.toThrow();
    expect(
      hardwareRequestSchema.safeParse({ operation: 'export', from: null, to: null, path: 'C:/x' })
        .success,
    ).toBe(false);
  });
  it('Unicode 长度与 Rust 保持一致，拒绝空白和控制字符', () => {
    expect(greetingFormSchema.safeParse({ name: '😀'.repeat(40) }).success).toBe(true);
    for (const name of [' ', '境'.repeat(41), 'a\nb']) {
      expect(greetingFormSchema.safeParse({ name }).success).toBe(false);
    }
  });

  it('将结构化错误转为可读信息', () => {
    expect(errorMessage({ code: 'INVALID_NAME' })).toContain('40');
    expect(errorMessage(undefined)).toBe('操作失败，请重试');
  });
});
