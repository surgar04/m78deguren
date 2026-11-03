import { describe, expect, it } from 'vitest';
import { developerRequestSchema, developerStatusSchema } from './developer-contracts';
import { releaseIdentity } from './release-identity';

describe('开发者身份与发行边界', () => {
  it('只接受受限认证输入，不接受前端直接指定模式或通道', () => {
    expect(
      developerRequestSchema.safeParse({
        operation: 'authenticate',
        email: 'test@example.com',
        stoken: 'x',
        mode: 'developer',
      }).success,
    ).toBe(false);
    expect(
      developerRequestSchema.safeParse({
        operation: 'authenticate',
        email: 'test@example.com',
        stoken: 'x'.repeat(4097),
      }).success,
    ).toBe(false);
    expect(
      developerStatusSchema.safeParse({
        edition: 'stable',
        mode: 'developer',
        build: '1',
        expiresAt: null,
        message: '',
        stoken: 'leak',
      }).success,
    ).toBe(false);
  });
  it('隔离两种发行的目录、资产、清单和标签，拒绝不规范版本和构建编号', () => {
    const stable = releaseIdentity('1.2.3');
    const developer = releaseIdentity('1.2.3', 'developer', '2');
    expect(stable.tag).toBe('v1.2.3');
    expect(developer.tag).toBe('v1.2.3-dev.2');
    expect(developer.prerelease).toBe(true);
    for (const field of ['directory', 'cargoDirectory', 'name', 'manifest'] as const)
      expect(stable[field]).not.toBe(developer[field]);
    expect(() => releaseIdentity('1.2.3', 'developer', '0')).toThrow();
    expect(() => releaseIdentity('1.2.3', 'developer', '1000000')).toThrow();
    expect(() => releaseIdentity('../bad', 'stable')).toThrow();
    expect(() => releaseIdentity('1.2.3', 'beta')).toThrow();
  });
});
