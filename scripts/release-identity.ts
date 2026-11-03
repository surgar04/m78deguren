import { releaseIdentity } from '../src/lib/release-identity.ts';
export { releaseIdentity } from '../src/lib/release-identity.ts';
/** 构建环境只在 Node 入口读取；共享命名规则不依赖 Node 或浏览器全局变量。 */
export function currentRelease(baseVersion: string) {
  return releaseIdentity(
    baseVersion,
    process.env['ZHENJING_BUILD_EDITION'] ?? 'stable',
    process.env['ZHENJING_DEVELOPER_BUILD'] ?? '1',
  );
}
