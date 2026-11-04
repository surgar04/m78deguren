import './check-environment.ts';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

/**
 * Windows 冷缓存下 jsdom 首次装载可能超过 Vitest 固定的 60 秒 worker 握手预算。
 * 在隔离测试进程启动前预热同一套依赖和 D 盘 Node 编译缓存；测试仍逐文件独立，
 * 断言及其超时保持原样。预热自身也有上限，失败会使整个检查失败。
 * 上游背景：https://github.com/vitest-dev/vitest/issues/11363
 */
export default async function setup(): Promise<void> {
  if (process.platform !== 'win32') return;
  await promisify(execFile)(
    process.execPath,
    ['--input-type=module', '-e', 'import { JSDOM } from "jsdom"; new JSDOM().window.close();'],
    { cwd: process.cwd(), windowsHide: true, timeout: 180_000, maxBuffer: 64 * 1024 },
  );
}
