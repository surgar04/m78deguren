import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';
import { traditionalLocalePlugin } from './upstream/dev/i18n/traditionalLocalePlugin.mjs';
import { icuFoliaDataPlugin } from './upstream/dev/icuFolia/icuFoliaDataPlugin.mjs';
import { nebbiaStrokesPlugin } from './upstream/dev/nebbia/nebbiaStrokesPlugin.mjs';
import { commandPinyinPlugin } from './upstream/dev/pinyin/commandPinyinPlugin.mjs';
import { musicFrontendSources, verifyMusicSnapshot } from '../../scripts/music-inputs.ts';
let buildSources: Record<string, string> | null = null;

/** 仅在构建时替换 Electron 的传输地址；冻结的渲染器、着色器、歌词算法不改写。 */
export default defineConfig({
  plugins: [
    {
      name: 'zhenjing-frozen-source-integrity',
      async buildStart() {
        await verifyMusicSnapshot(resolve(import.meta.dirname, '../..'));
        buildSources = await musicFrontendSources(resolve(import.meta.dirname, '../..'));
      },
      async generateBundle() {
        const current = await musicFrontendSources(resolve(import.meta.dirname, '../..'));
        if (JSON.stringify(current) !== JSON.stringify(buildSources))
          this.error('音乐来源在编译期间发生变化，请重试。');
        this.emitFile({
          type: 'asset',
          fileName: 'build-input.json',
          source: JSON.stringify({
            sources: current,
          }),
        });
      },
    },
    {
      name: 'zhenjing-folia-desktop-transport',
      enforce: 'pre',
      transform(source, id) {
        const file = id.replaceAll('\\', '/').split('?')[0] ?? '';
        if (file.endsWith('/onlineMusic/netease/netease.ts')) {
          const old = 'return `http://127.0.0.1:${port}`;';
          if (!source.includes(old)) throw Error('网易云传输补丁与固定上游不匹配');
          return source.replace(old, "return 'http://zhenjing-music.localhost/api/netease';");
        }
        if (file.endsWith('/onlineMusic/qq/qqTransport.ts')) {
          const old = 'electronApiBase = `http://127.0.0.1:${port}`;';
          if (!source.includes(old)) throw Error('QQ 传输补丁与固定上游不匹配');
          const patched = source.replace(
            old,
            "electronApiBase = 'http://zhenjing-music.localhost/api/qq';",
          );
          return (
            `import { musicPlatformFetch } from '${resolve(import.meta.dirname, 'bridge.ts').replaceAll('\\', '/')}';\n` +
            patched.replace(/\bfetch\(/gu, 'musicPlatformFetch(')
          );
        }
        if (file.endsWith('/onlineMusic/qq/qqLyricProvider.ts'))
          return (
            `import { musicPlatformFetch } from '${resolve(import.meta.dirname, 'bridge.ts').replaceAll('\\', '/')}';\n` +
            source.replace(/\bfetch\(/gu, 'musicPlatformFetch(')
          );
        if (file.endsWith('/onlineMusic/providerRegistry.ts')) {
          return source
            .split('\n')
            .filter(
              (line) =>
                !['kugouProvider', 'bodianProvider', 'qishuiProvider'].some(
                  (name) =>
                    (line.startsWith('import ') && line.includes(name)) ||
                    line.trim() === `registerOnlineMusicProvider(${name});`,
                ),
            )
            .join('\n');
        }
        if (file.endsWith('/upstream/src/index.css')) {
          // 固定版本的原字体本地分发，沉浸页离线时也保持字形与行宽。
          return source.replaceAll(
            'https://cdn.jsdmirror.cn/npm/@fontsource/noto-serif-sc@5.2.9/files/',
            '../../node_modules/@fontsource/noto-serif-sc/files/',
          );
        }
        if (file.endsWith('/visualizer/GlowWord.tsx')) {
          // 原件只在时钟 change 时更新。暂停后首次进入没有 change，补一次布局前同步即可，不改动逐字动画。
          const point = "    useMotionValueEvent(currentTime, 'change', (latest: number) => {";
          if (!source.includes(point))
            throw Error('上游逐字时钟入口已变化，请重新审查暂停同步适配');
          return source.replace(
            point,
            `    React.useLayoutEffect(() => {
        const latest = currentTime.get();
        setStatus(latest >= word.startTime - renderProfile.wordLookahead && latest <= activeEndTime
            ? 'active' : latest > activeEndTime ? 'passed' : 'waiting');
    }, [currentTime, word.startTime, renderProfile.wordLookahead, activeEndTime]);
${point}`,
          );
        }
        if (file.endsWith('/backgrounds/url/UrlBackgroundLayer.tsx')) {
          const helper = resolve(import.meta.dirname, 'embed.ts').replaceAll('\\', '/');
          return (
            `import { useEmbedUrl } from '${helper}';\n` +
            source
              .replace(
                'const containerRef = useRef',
                'const embeddedUrl = useEmbedUrl(selectedItem?.url ?? null);\n    const containerRef = useRef',
              )
              .replace('}, [selectedItem]);', '}, [selectedItem, embeddedUrl]);')
              .replace(
                'if (!selectedItem?.url) return null;',
                'if (!selectedItem?.url || !embeddedUrl) return null;',
              )
              .replace('src={selectedItem.url}', 'src={embeddedUrl}')
          );
        }
        if (
          file.endsWith('/backgrounds/latent/LatentBackground.tsx') ||
          file.endsWith('/backgrounds/nomand/NomandBackgroundLayer.tsx')
        ) {
          const helper = resolve(import.meta.dirname, 'performance.ts').replaceAll('\\', '/');
          return (
            `import { graphicsPixelBudget } from '${helper}';\n` +
            source
              .replaceAll(
                'maxPixelCount={MAX_SHADER_PIXELS}',
                'maxPixelCount={graphicsPixelBudget(MAX_SHADER_PIXELS)}',
              )
              .replace(
                'maxPixelCount: 1920 * 1080,',
                'maxPixelCount: graphicsPixelBudget(1920 * 1080),',
              )
          );
        }
        return undefined;
      },
    },
    traditionalLocalePlugin(),
    icuFoliaDataPlugin(),
    nebbiaStrokesPlugin(),
    commandPinyinPlugin(),
    {
      name: 'zhenjing-require-complete-strokes',
      enforce: 'post',
      generateBundle(_, bundle) {
        if (!bundle['nebbia-strokes.json'])
          this.error('雾笺笔顺与许可数据未生成；不允许将降级效果作为完整迁移发布。');
      },
    },
    react(),
    tailwindcss(),
  ],
  base: '/music-engine/',
  cacheDir: '../../.cache/vite-folia',
  resolve: { alias: { '@': resolve(import.meta.dirname, 'upstream/src') } },
  build: {
    target: 'es2022',
    outDir: '../../public/music-engine',
    emptyOutDir: true,
    reportCompressedSize: false,
    rolldownOptions: {
      // api 是由主应用动态加载的公开入口；应用构建默认摇树会把无人静态引用的工厂导出删掉。
      preserveEntrySignatures: 'strict',
      input: {
        api: resolve(import.meta.dirname, 'api.ts'),
        stage: resolve(import.meta.dirname, 'stage.html'),
      },
      output: { entryFileNames: '[name].js', chunkFileNames: 'chunks/[name]-[hash].js' },
    },
  },
});
