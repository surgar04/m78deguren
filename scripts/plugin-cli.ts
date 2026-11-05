import './check-environment.ts';
import { createHash, createPrivateKey, generateKeyPairSync, sign } from 'node:crypto';
import { readFile, writeFile, mkdir, stat, cp } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { spawn } from 'node:child_process';
import { zipSync } from 'fflate';
import { z } from 'zod';
import { pluginManifestSchema } from '../src/lib/plugin-contracts.ts';

/** 开发工具只构建用户明确指定的源码工程；安装器绝不调用此 CLI 或执行包内脚本。 */
const workspace = resolve('.');
function dPath(input: string): string {
  const path = resolve(input);
  if (!/^d:[\\/]/iu.test(path)) throw new Error('插件工具所有输出、源码与缓存必须位于 D 盘');
  return path;
}
const args = process.argv.slice(2),
  command = args.shift();
const options = new Map<string, string>();
for (let i = 0; i < args.length; i += 2) {
  const key = args[i],
    value = args[i + 1];
  if (!key?.startsWith('--') || value === undefined || options.has(key))
    throw new Error('参数格式为 --名称 值，且不能重复');
  options.set(key, value);
}
function option(key: string, fallback?: string): string {
  const value = options.get(`--${key}`) ?? fallback;
  if (value === undefined) throw new Error(`缺少 --${key}`);
  return value;
}
async function run(executable: string, arguments_: string[], cwd: string): Promise<void> {
  await new Promise<void>((done, reject) => {
    const child = spawn(executable, arguments_, {
      cwd,
      env: process.env,
      stdio: 'inherit',
      windowsHide: true,
      shell: false,
    });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? done() : reject(new Error(`插件构建退出码 ${code}`))));
  });
}
const utf8 = (value: string) => new TextEncoder().encode(value);
if (command === 'keygen') {
  const directory = dPath(option('out', join(workspace, '.local/plugin-keys')));
  const allowed = join(workspace, '.local');
  if (relative(allowed, directory).startsWith('..'))
    throw new Error('签名密钥仅允许保存到本工作区忽略的 .local 目录');
  await mkdir(directory, { recursive: true });
  const keys = generateKeyPairSync('ed25519');
  await writeFile(
    join(directory, 'publisher.pem'),
    keys.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    { flag: 'wx', mode: 0o600 },
  );
  const publicKey = keys.publicKey
    .export({ type: 'spki', format: 'der' })
    .subarray(-32)
    .toString('hex');
  await writeFile(
    join(directory, 'publisher.public.json'),
    JSON.stringify({ publicKey }, null, 2),
    { flag: 'wx' },
  );
  console.log(`已生成发布者密钥；公钥指纹 ${publicKey}。私钥未输出。`);
} else if (command === 'create') {
  const language = z.enum(['typescript', 'rust', 'csharp']).parse(option('language'));
  const output = dPath(option('out'));
  if (
    await stat(output).then(
      () => true,
      () => false,
    )
  )
    throw new Error('目标目录已存在，拒绝覆盖');
  const source = join(workspace, 'plugins/examples', language);
  await cp(source, output, {
    recursive: true,
    filter: (path) =>
      !relative(source, path)
        .split(/[\\/]/u)
        .some((part) => ['obj', 'bin', 'target', 'node_modules', '.git'].includes(part)),
  });
  await cp(join(workspace, 'plugins/sdk'), join(output, 'sdk'), { recursive: true });
  await cp(join(workspace, 'plugins/wit'), join(output, 'wit'), { recursive: true });
  const manifest = pluginManifestSchema.parse(
    JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8')),
  );
  manifest.id = option('id');
  manifest.name = option('name', '我的插件');
  manifest.publisher = option('publisher', '本地开发者');
  pluginManifestSchema.parse(manifest);
  await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
  if (language === 'typescript')
    await writeFile(
      join(output, 'index.ts'),
      (await readFile(join(output, 'index.ts'), 'utf8')).replace(
        '../../sdk/typescript/index',
        './sdk/typescript/index',
      ),
    );
  if (language === 'rust')
    await writeFile(
      join(output, 'Cargo.toml'),
      (await readFile(join(output, 'Cargo.toml'), 'utf8')).replace('../../sdk/rust', 'sdk/rust'),
    );
  if (language === 'csharp')
    await writeFile(
      join(output, 'Plugin.csproj'),
      (await readFile(join(output, 'Plugin.csproj'), 'utf8'))
        .replace('../../wit/plugin.wit', 'wit/plugin.wit')
        .replace('../../sdk/csharp', 'sdk/csharp'),
    );
  console.log(`已创建 ${language} 插件工程：${output}`);
} else if (command === 'build' || command === 'pack' || command === 'check') {
  const project = dPath(option('project'));
  const manifest = pluginManifestSchema.parse(
    JSON.parse(await readFile(join(project, 'manifest.json'), 'utf8')),
  );
  const output = dPath(option('out', join(workspace, '.cache/plugins-build', manifest.id)));
  await mkdir(output, { recursive: true });
  const component = join(output, 'component.wasm');
  if (command === 'build') {
    if (manifest.language === 'typescript') {
      // Vite 只去除类型；先真正执行严格类型检查，避免把有类型错误的插件作为成功产物。
      await run(
        process.execPath,
        [
          join(workspace, 'node_modules/typescript/bin/tsc'),
          '--ignoreConfig',
          '--noEmit',
          '--allowImportingTsExtensions',
          '--strict',
          '--noUncheckedIndexedAccess',
          '--exactOptionalPropertyTypes',
          '--noUnusedLocals',
          '--noUnusedParameters',
          '--target',
          'ES2023',
          '--module',
          'ESNext',
          '--moduleResolution',
          'Bundler',
          '--skipLibCheck',
          join(project, 'index.ts'),
        ],
        project,
      );
      const { build } = await import('vite');
      const result = await build({
        configFile: false,
        cacheDir: join(output, 'vite'),
        logLevel: 'warn',
        build: {
          write: false,
          minify: false,
          lib: { entry: join(project, 'index.ts'), formats: ['es'] },
          rolldownOptions: { external: (id) => id.startsWith('zhenjing:') },
        },
      });
      const bundles = Array.isArray(result) ? result : [result];
      const entry = bundles
        .flatMap((bundle) => ('output' in bundle ? bundle.output : []))
        .find((chunk) => chunk.type === 'chunk' && chunk.isEntry);
      if (!entry || entry.type !== 'chunk') throw new Error('TypeScript 构建没有产生入口');
      const intermediate = join(output, 'entry.mjs');
      await writeFile(intermediate, entry.code);
      await run(
        process.execPath,
        [
          join(workspace, 'node_modules/@bytecodealliance/jco/dist/jco.js'),
          'componentize',
          intermediate,
          '--wit',
          join(workspace, 'plugins/wit'),
          '--world-name',
          'plugin',
          // 网络统一走能力代理；不能让 JS 引擎隐式要求直接连接 WASI HTTP。
          '--disable',
          'http',
          'fetch-event',
          '-o',
          component,
        ],
        workspace,
      );
    } else if (manifest.language === 'rust') {
      await run(
        join(workspace, '.tools/cargo/bin/cargo.exe'),
        [
          'build',
          '--locked',
          '--manifest-path',
          join(project, 'Cargo.toml'),
          '--target',
          'wasm32-wasip2',
          '--release',
          '--target-dir',
          join(output, 'cargo'),
        ],
        project,
      );
      const toml = await readFile(join(project, 'Cargo.toml'), 'utf8');
      const name = /^name\s*=\s*"([a-zA-Z0-9_-]+)"/mu.exec(toml)?.[1];
      if (!name) throw new Error('Cargo 项目缺少名称');
      await cp(
        join(output, 'cargo/wasm32-wasip2/release', `${name.replaceAll('-', '_')}.wasm`),
        component,
      );
    } else {
      const dotnet = dPath(option('dotnet', join(workspace, '.tools/plugin-dotnet/dotnet.exe')));
      const wasi = dPath(option('wasi', join(workspace, '.tools/wasi-sdk/wasi-sdk-29.0')));
      if (
        !(await stat(join(wasi, 'VERSION')).then(
          () => true,
          () => false,
        ))
      ) {
        throw new Error('缺少 D 盘 WASI SDK 29；拒绝让上游构建器自动写入系统用户目录');
      }
      await run(
        dotnet,
        [
          'build',
          join(project, 'Plugin.csproj'),
          '-c',
          'Release',
          '-p:RestoreLockedMode=true',
          `-p:WASI_SDK_PATH=${wasi}`,
          '--artifacts-path',
          join(output, 'dotnet'),
        ],
        project,
      );
      // 官方 SDK 的输出路径包含目标框架；仅在本次构建输出中查找唯一组件，不猜测或运行 EXE。
      const { readdir } = await import('node:fs/promises');
      const found: string[] = [];
      async function collect(path: string): Promise<void> {
        for (const entry of await readdir(path, { withFileTypes: true })) {
          const file = join(path, entry.name);
          if (entry.isSymbolicLink()) throw new Error('构建输出不能包含链接');
          if (entry.isDirectory()) await collect(file);
          else if (entry.name === 'Plugin.wasm') found.push(file);
        }
      }
      await collect(join(output, 'dotnet'));
      if (!found.length) throw new Error('C# 构建没有产生 Plugin.wasm');
      const source = found.find((path) => path.includes('publish')) ?? found[0];
      if (!source) throw new Error('组件输出缺失');
      await cp(source, component);
    }
    const bytes = await readFile(component);
    if (!bytes.subarray(0, 8).equals(Buffer.from([0, 97, 115, 109, 13, 0, 1, 0])))
      throw new Error('产物不是 Wasm Component');
    console.log(`已构建 ${manifest.language} 标准组件：${component}`);
  } else if (command === 'pack') {
    const wasm = await readFile(component);
    if (!wasm.subarray(0, 8).equals(Buffer.from([0, 97, 115, 109, 13, 0, 1, 0])))
      throw new Error('入口不是 Wasm Component');
    if (wasm.length > 64 * 1024 * 1024) throw new Error('组件超过大小上限');
    const manifestBytes = utf8(JSON.stringify(manifest, null, 2));
    const files: Record<string, Uint8Array> = { 'component.wasm': wasm };
    for (const name of ['LICENSE', 'dependencies.json', 'Cargo.lock', 'packages.lock.json']) {
      const file = join(project, name);
      if (
        await stat(file).then(
          () => true,
          () => false,
        )
      )
        files[name] = await readFile(file);
    }
    if (!files['LICENSE'] || !files['dependencies.json'])
      throw new Error('分发包必须携带 LICENSE 与 dependencies.json');
    z.object({ schemaVersion: z.literal(1), dependencies: z.array(z.unknown()) })
      .passthrough()
      .parse(JSON.parse(new TextDecoder().decode(files['dependencies.json'])));
    const integrity = Object.fromEntries(
      Object.entries(files)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, bytes]) => [name, createHash('sha256').update(bytes).digest('hex')]),
    );
    const integrityBytes = utf8(JSON.stringify(integrity));
    files['manifest.json'] = manifestBytes;
    files['integrity.json'] = integrityBytes;
    const keyPath = options.get('--key');
    if (keyPath) {
      const privateKey = createPrivateKey(await readFile(dPath(keyPath)));
      if (privateKey.asymmetricKeyType !== 'ed25519')
        throw new Error('必须使用 Ed25519 发布者密钥');
      const { createPublicKey } = await import('node:crypto');
      const publicKey = createPublicKey(privateKey)
        .export({ type: 'spki', format: 'der' })
        .subarray(-32)
        .toString('hex');
      const lengths = [manifestBytes, integrityBytes].map((bytes) => {
        const size = Buffer.alloc(8);
        size.writeBigUInt64LE(BigInt(bytes.length));
        return size;
      });
      const first = lengths[0],
        second = lengths[1];
      if (!first || !second) throw new Error('签名长度编码失败');
      const message = Buffer.concat([
        Buffer.from('zhenjing-plugin-package-v1\0'),
        first,
        manifestBytes,
        second,
        integrityBytes,
      ]);
      files['signature.json'] = utf8(
        JSON.stringify({ publicKey, signature: sign(null, message, privateKey).toString('hex') }),
      );
    } else if (option('unsigned', 'false') !== 'true')
      throw new Error('分发包需要 --key；本地开发包必须显式传入 --unsigned true');
    const bytes = zipSync(files, { level: 6 });
    if (bytes.length > 64 * 1024 * 1024) throw new Error('插件包超过大小上限');
    const destination = join(output, `${manifest.id}-${manifest.version}.zjplug`);
    await writeFile(destination, bytes);
    console.log(`已生成插件包：${destination}`);
  } else
    console.log(
      `插件清单检查通过：${manifest.id} ${manifest.version}；包完整性与兼容性仍由原生安装器复核。`,
    );
} else if (command === 'doctor') {
  console.log('运行时：标准 Wasm Component；TypeScript/C# /Rust 共用 WIT 1.0.0。');
  for (const [name, path] of [
    ['Rust', join(workspace, '.tools/cargo/bin/rustc.exe')],
    ['C# .NET 10+', join(workspace, '.tools/plugin-dotnet/dotnet.exe')],
    ['插件宿主', join(workspace, 'src-tauri/resources/plugin-host/zhenjing-plugin-host.exe')],
  ] satisfies [string, string][]) {
    console.log(
      `${name}：${
        (await stat(path).then(
          () => true,
          () => false,
        ))
          ? '已找到'
          : '未找到，需准备 D 盘便携工具链或构建宿主'
      }`,
    );
  }
} else
  throw new Error('用法：plugin-cli.ts create|check|build|pack|keygen|doctor；参数使用 --名称 值');
