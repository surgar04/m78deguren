import type { DiagnosticEvent } from './diagnostic-contracts';

// 日志是诊断事件，不是业务状态副本。只维护有界发送队列、去重时间和临时调用关联标识。
let sink: ((events: DiagnosticEvent[]) => Promise<unknown>) | undefined;
let sending = false,
  installed = false;
const queue: DiagnosticEvent[] = [];
const seen = new Map<string, number>();
const reads = new Map<string, number>();
let lost = 0;
export function redactDiagnostic(input: string): string {
  const text = input.slice(0, 4096);
  if (
    /cookie|authorization|password|token|secret|credential|username|nickname|api.?key|账号|用户名|昵称|密码|令牌|密钥|邮箱|bearer\s/iu.test(
      text,
    )
  )
    return '[sensitive details omitted]';
  if (text.includes('{') || text.toLowerCase().includes('<html'))
    return '[structured details omitted]';
  return text
    .replace(
      /https?:\/\/[^\s<>]+|[a-z]:[\\/][^\r\n"<>]*|\\\\[^\r\n"<>]+|\/(?:home|Users)\/[^\r\n"<>]+|[^\s<>@]+@[^\s<>@]+|[A-Za-z0-9_+/=.-]{24,}|\b\d{6,}\b/giu,
      '[redacted]',
    )
    .split('')
    .filter(
      (character) => character.charCodeAt(0) >= 32 || character === '\n' || character === '\t',
    )
    .join('')
    .slice(0, 2048);
}
export function recordDiagnostic(event: DiagnosticEvent): void {
  const safe = { ...event, message: event.message ? redactDiagnostic(event.message) : null };
  const key = `${safe.event}/${safe.operation}/${safe.message}`;
  if (safe.level === 'error' || safe.level === 'warn') {
    const prior = seen.get(key) ?? 0;
    if (Date.now() - prior < 3000) return;
    seen.set(key, Date.now());
    if (seen.size > 256) {
      const first = seen.keys().next().value;
      if (first) seen.delete(first);
    }
  }
  if (queue.length >= 128) {
    const low = queue.findIndex((row) => row.level === 'debug' || row.level === 'info');
    if (low >= 0) queue.splice(low, 1);
    else queue.shift();
    lost++;
  }
  queue.push(safe);
  if (safe.level === 'error') void flushDiagnostics();
}
/** 不序列化未知异常对象：错误对象可能携带平台响应、请求配置或账号数据。 */
export function recordException(
  cause: unknown,
  event:
    | 'frontend.error'
    | 'frontend.rejection'
    | 'frontend.console'
    | 'query.failed'
    | 'mutation.failed' = 'frontend.error',
): void {
  const message =
    cause instanceof Error
      ? `${cause.name}: ${cause.message}\n${cause.stack?.split('\n').slice(1, 7).join('\n') ?? ''}`
      : typeof cause === 'string'
        ? cause
        : '[non-text error omitted]';
  recordDiagnostic({
    level: 'error',
    event,
    operation: null,
    trace: null,
    durationMs: null,
    message,
  });
}
export async function flushDiagnostics(): Promise<void> {
  if (!sink || sending || !queue.length) return;
  sending = true;
  const batch = queue.splice(0, 64);
  if (lost && batch.length < 64) {
    batch.push({
      level: 'warn',
      event: 'log.queue_overflow',
      operation: null,
      trace: null,
      durationMs: null,
      message: `${lost} diagnostic events were aggregated`,
    });
    lost = 0;
  }
  try {
    await sink(batch);
  } catch {
    // 短暂 IPC 不可用时保留脱敏事件等待下一次发送，不制造无限增长或递归错误日志。
    queue.unshift(...batch);
    if (queue.length > 128) {
      lost += queue.length - 128;
      queue.length = 128;
    }
  } finally {
    sending = false;
  }
}
/** 成功的监控/时钟读取每分钟汇总一次；错误不走成功采样，避免每帧写日志。 */
export function traceCall(
  command: string,
  operation: string | null,
): { id: string; finish: (failed: boolean) => void } {
  const id = crypto.randomUUID(),
    at = performance.now(),
    key = `${command}/${operation ?? 'call'}`;
  const read =
    operation !== null &&
    /^(?:snapshot|status|read|list|poll|sample|telemetry|clock|desktop-clock|desktop-content|desktop-read|frame|timeline|progress|runtime|provider)$/u.test(
      operation,
    );
  const sampled = !read || Date.now() - (reads.get(key) ?? 0) > 60000;
  if (sampled) {
    reads.set(key, Date.now());
    if (reads.size > 256) {
      const first = reads.keys().next().value;
      if (first) reads.delete(first);
    }
    recordDiagnostic({
      level: read ? 'debug' : 'info',
      event: 'ipc.start',
      operation: key,
      trace: id,
      durationMs: null,
      message: null,
    });
  }
  return {
    id,
    finish(failed) {
      if (failed || sampled)
        recordDiagnostic({
          level: failed ? 'error' : 'info',
          event: failed ? 'ipc.failed' : 'ipc.complete',
          operation: key,
          trace: id,
          durationMs: Math.min(86400000, Math.round(performance.now() - at)),
          message: null,
        });
    },
  };
}
export function installFrontendDiagnostics(
  send: (events: DiagnosticEvent[]) => Promise<unknown>,
): void {
  sink = send;
  Object.assign(window, { __ZHENJING_DIAGNOSTICS_READY__: true });
  if (installed) return;
  installed = true;
  window.addEventListener('error', (event) => {
    recordException(
      event.error instanceof Error ? event.error : 'Browser resource or runtime error',
    );
  });
  window.addEventListener('unhandledrejection', (event) =>
    recordException(event.reason as unknown, 'frontend.rejection'),
  );
  window.addEventListener('pagehide', () => {
    recordDiagnostic({
      level: 'info',
      event: 'window.event',
      operation: 'pagehide',
      trace: null,
      durationMs: null,
      message: null,
    });
    void flushDiagnostics();
  });
  const originalWarn = console.warn.bind(console),
    originalError = console.error.bind(console);
  for (const [name, original] of [
    ['warn', originalWarn],
    ['error', originalError],
  ] as const) {
    console[name] = (...args: unknown[]) => {
      const message = args
        .map((v) =>
          v instanceof Error
            ? `${v.name}: ${v.message}`
            : typeof v === 'string'
              ? v
              : '[object omitted]',
        )
        .join(' ');
      const safe = redactDiagnostic(message);
      original(safe);
      recordException(safe, 'frontend.console');
    };
  }
  window.setInterval(() => {
    void flushDiagnostics();
  }, 1500);
}
