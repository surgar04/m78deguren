import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateWallpaper } from './wallpaper';

describe('本地壁纸输入验证', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('拒绝SVG、空文件及大文件，不把扩展名视为可信内容', async () => {
    await expect(
      validateWallpaper(new Blob(['<svg/>'], { type: 'image/svg+xml' })),
    ).rejects.toThrow('PNG');
    await expect(validateWallpaper(new Blob([], { type: 'image/png' }))).rejects.toThrow('8 MB');
    await expect(
      validateWallpaper(new Blob([new Uint8Array(8 * 1024 * 1024 + 1)], { type: 'image/png' })),
    ).rejects.toThrow('8 MB');
  });
  it('实际解码失败给出可读错误', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('decode')));
    await expect(validateWallpaper(new Blob(['broken'], { type: 'image/png' }))).rejects.toThrow(
      '完整有效',
    );
  });
  it('检查像素边界并释放解码资源，合法图保留原Blob', async () => {
    const close = vi.fn();
    const decode = vi.fn().mockResolvedValue({ width: 100, height: 100, close });
    vi.stubGlobal('createImageBitmap', decode);
    const image = new Blob(['image'], { type: 'image/webp' });
    await expect(validateWallpaper(image)).rejects.toThrow('320');
    decode.mockResolvedValue({ width: 8000, height: 8000, close });
    await expect(validateWallpaper(image)).rejects.toThrow('2400');
    decode.mockResolvedValue({ width: 1487, height: 1058, close });
    await expect(validateWallpaper(image)).resolves.toBe(image);
    expect(close).toHaveBeenCalledTimes(3);
  });
});
