import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  cacheDir: '.cache/vitest',
  test: {
    // 保持逐文件隔离；本机完整套件的线程 worker 会卡在启动阶段，串行进程池已通过完整验收。
    pool: 'forks',
    maxWorkers: 1,
    fileParallelism: false,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    clearMocks: true,
    coverage: {
      provider: 'v8',
      reportsDirectory: '.cache/coverage',
      include: ['src/lib/desktop.ts'],
    },
  },
});
