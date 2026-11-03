import { createRequire } from 'node:module';
import { writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { execFile, spawn, type SpawnOptions } from 'node:child_process';
import { isAbsolute } from 'node:path';

const require = createRequire(import.meta.url);
type Cookie = { name: string; value: string; domain: string; path: string };
type Opened = { closed: Promise<string>; stop: () => void };
type Browser = {
  findBrowser: () => string | null;
  openSignIn: (executable: string, profile: string) => Opened;
  readCookies: (
    executable: string,
    profile: string,
    options?: { timeoutMs: number },
  ) => Promise<Cookie[]>;
  endLeftBrowsers: (profile: string) => Promise<boolean>;
  removeProfile: (profile: string) => Promise<boolean>;
};
const source = z
  .object({
    createBrowserSignIn: z.custom<(options: object) => Browser>((v) => typeof v === 'function'),
    isSignedIn: z.custom<(cookies: Cookie[]) => boolean>((v) => typeof v === 'function'),
  })
  .parse(require('./upstream/electron/ytm/browserSignIn.cjs') as unknown);
const errors = z
  .object({
    ytmError: z.custom<(code: string, message: string, detail?: string, reason?: string) => Error>(
      (v) => typeof v === 'function',
    ),
  })
  .parse(require('./upstream/electron/ytm/errors.cjs') as unknown);

export type AuthPhase =
  'idle' | 'opening' | 'browser' | 'reading' | 'verifying' | 'confirmed' | 'error' | 'cancelled';
/** 诊断只保存我们定义的阶段、枚举及时间。不保存上游日志、URL、账号、Cookie、异常文本或文件路径。 */
export function createYtmAuth(
  root: string,
  options: { browser?: Browser; pause?: (ms: number) => Promise<void> } = {},
) {
  const browser =
    options.browser ??
    source.createBrowserSignIn({
      log() {},
      warn() {},
      // 专用档案不需要浏览器后台常驻；关闭其窗口后应退出进程，才能开始读取会话。
      spawn: (file: string, args: string[], settings: SpawnOptions) =>
        spawn(file, [...args, '--disable-background-mode'], settings),
    });
  const pause =
    options.pause ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  let phase: AuthPhase = 'idle',
    code = '',
    network = '',
    generation = 0,
    storageFailed = false;
  let saved = Promise.resolve();
  const timeline: { phase: AuthPhase; code: string; at: string }[] = [];
  // 通过函数读取异步回调可能改写的状态，避免把 await 前的类型收窄误当成运行时保证。
  const cancelled = (ownGeneration: number) =>
    generation !== ownGeneration || phase === 'cancelled';
  const set = (next: AuthPhase, reason = '') => {
    phase = next;
    code = reason;
    timeline.push({ phase, code, at: new Date().toISOString() });
    if (timeline.length > 40) timeline.shift();
    const content = JSON.stringify({ version: 1, provider: 'ytm', timeline });
    saved = saved
      .then(async () => {
        const file = join(root, 'ytm-auth-diagnostics.json');
        const temporary = `${file}.${process.pid}.tmp`;
        await writeFile(temporary, content, { mode: 0o600 });
        await rename(temporary, file);
      })
      .catch(() => {
        /* 诊断写入失败不覆盖实际授权错误，也不回退写入其他磁盘。 */
      });
  };
  const wrapped: Browser = {
    ...browser,
    openSignIn(executable, profile) {
      const ownGeneration = generation;
      set('browser');
      const opened = browser.openSignIn(executable, profile);
      return {
        stop: opened.stop,
        closed: opened.closed.then((outcome) => {
          if (generation === ownGeneration && phase !== 'cancelled') set('reading');
          return outcome;
        }),
      };
    },
    async readCookies(executable, profile) {
      const ownGeneration = generation;
      // 浏览器退出与档案解锁存在短暂间隔。只重试本次专用档案，绝不读取日常浏览器配置。
      // 两次 20 秒读取 + 一次残留清理，仍给上游账号验证和会员探测保留完整预算。
      for (let attempt = 0; attempt < 2; attempt++) {
        if (cancelled(ownGeneration))
          throw errors.ytmError('unavailable', '授权已取消', undefined, 'cancelled');
        try {
          const cookies = await browser.readCookies(executable, profile, { timeoutMs: 20000 });
          if (cancelled(ownGeneration))
            throw errors.ytmError('unavailable', '授权已取消', undefined, 'cancelled');
          if (source.isSignedIn(cookies)) {
            if (!cancelled(ownGeneration)) set('verifying');
            return cookies;
          }
          if (attempt === 1)
            throw errors.ytmError(
              'auth-required',
              '未读到有效的 YouTube Music 登录会话。请重新授权，等待 YouTube Music 页面显示你的账号后，再关闭专用窗口。',
              undefined,
              'session-missing',
            );
        } catch (cause) {
          const reason = z.object({ code: z.string() }).safeParse(cause);
          if (
            attempt === 1 ||
            !reason.success ||
            !['timeout', 'exited', 'not-started'].includes(reason.data.code)
          )
            throw cause;
          // 仅结束绑定本次 --user-data-dir 的残留进程，原实现会验证完整目录边界。
          await browser.endLeftBrowsers(profile);
        }
        if (!cancelled(ownGeneration)) set('reading', 'retry');
        await pause(500 * (attempt + 1));
      }
      throw errors.ytmError(
        'unavailable',
        '浏览器会话读取未完成，请重新授权',
        undefined,
        'protocol',
      );
    },
  };
  return {
    browser: wrapped,
    async browserIdentity(): Promise<string | undefined> {
      const executable = browser.findBrowser(),
        helper = process.env['ZHENJING_MUSIC_VAULT'];
      if (!executable || !helper || !isAbsolute(helper)) return undefined;
      const major = await new Promise<number | undefined>((done) => {
        const child = execFile(
          helper,
          ['--music-browser-version'],
          { windowsHide: true, timeout: 4000, maxBuffer: 64 },
          (cause, stdout) =>
            done(!cause && /^\d{2,3}$/u.test(stdout.trim()) ? Number(stdout.trim()) : undefined),
        );
        child.stdin?.on('error', () => {});
        child.stdin?.end(executable + '\n');
      });
      return major && major >= 80 && major <= 300
        ? `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`
        : undefined;
    },
    begin() {
      generation++;
      storageFailed = false;
      network = '';
      timeline.length = 0;
      set('opening');
    },
    cancel() {
      generation++;
      set('cancelled', 'cancelled');
    },
    network(reason: string) {
      network = reason;
    },
    storageFailure() {
      storageFailed = true;
    },
    get storageFailed() {
      return storageFailed;
    },
    note(result: unknown) {
      const answer = z
        .object({
          ok: z.boolean(),
          error: z.object({ code: z.string(), reason: z.string().optional() }).optional(),
          data: z
            .object({
              state: z.string(),
              reason: z.string().optional(),
              code: z.string().optional(),
            })
            .passthrough()
            .optional(),
        })
        .safeParse(result);
      if (!answer.success) {
        set('error', 'protocol');
        return;
      }
      const value = answer.data;
      if (!value.ok) set('error', safeCode(value.error?.reason || network || value.error?.code));
      else if (value.data?.state === 'confirmed') set('confirmed');
      else if (value.data?.state === 'error')
        set(
          'error',
          safeCode(
            value.data.reason === 'no-answer'
              ? network || value.data.reason
              : value.data.reason || network || value.data.code,
          ),
        );
      else if (value.data?.state === 'expired' && phase !== 'cancelled')
        set('error', 'session-missing');
    },
    snapshot() {
      return {
        phase,
        code,
        diagnostics: timeline
          .map((row) => `${row.at} ${row.phase}${row.code ? ` ${row.code}` : ''}`)
          .join('\n'),
      };
    },
    flushed: () => saved,
  };
}
function safeCode(value: string | undefined): string {
  const allowed = new Set([
    'no-browser',
    'folder-in-use',
    'exited',
    'not-started',
    'timeout',
    'protocol',
    'not-taken',
    'no-answer',
    'account-missing',
    'session-missing',
    'session-not-saved',
    'dns',
    'proxy',
    'network',
    'tls',
    'cancelled',
    'auth-required',
    'unavailable',
    'invalid-response',
    'rate-limited',
  ]);
  return value && allowed.has(value) ? value : 'unavailable';
}
