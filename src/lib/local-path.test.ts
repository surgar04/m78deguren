import { describe, expect, it } from 'vitest';
import { localWindowsPathSchema } from './local-path';

describe('发布版本地路径契约', () => {
  it.each(['C:\\Users\\小明\\AppData\\Local\\Zhenjing', 'E:/游戏/臻境', 'D:/reports/报告.html'])(
    '接受其他用户与磁盘：%s',
    (path) => expect(localWindowsPathSchema.safeParse(path).success).toBe(true),
  );
  it.each([
    'C:',
    'C:relative',
    '\\\\server\\share',
    '\\\\?\\C:\\data',
    'E:/../Windows',
    'E:/data:stream',
    'relative',
  ])('拒绝非本地或越界路径：%s', (path) =>
    expect(localWindowsPathSchema.safeParse(path).success).toBe(false),
  );
});
