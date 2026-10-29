import './check-environment.ts';
import { build } from 'vite';
import { resolve } from 'node:path';

// 由严格 TS 源码生成无网络依赖的 IIFE；源码照常参与 typecheck / ESLint，产物只供 Rust 内嵌。
for (const name of ['report', 'mobile']) {
  await build({
    configFile: false,
    cacheDir: '.cache/vite-hardware',
    build: {
      target: 'es2022',
      outDir: 'src-tauri/resources/hardware-web',
      emptyOutDir: false,
      minify: true,
      sourcemap: false,
      lib: {
        entry: resolve(`native/hardware-web/${name}.ts`),
        name: `ZhenjingHardware${name}`,
        formats: ['iife'],
        fileName: () => `${name}.js`,
      },
    },
  });
}
