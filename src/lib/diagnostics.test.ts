import { describe, expect, it } from 'vitest';
import { diagnosticRequestSchema } from './diagnostic-contracts';
import { redactDiagnostic, traceCall } from './diagnostics';
describe('本地诊断的隐私和接口边界', () => {
  it('过滤凭据、私人路径、邮箱、账号编号和长签名，不修改可读的固定事件', () => {
    for (const input of [
      'Cookie: short',
      'Authorization: Basic abc',
      'password=abc',
      'stoken=abc',
      'alice@example.com',
      'C:\\Users\\alice\\private.txt',
      'https://example.com/?secret=abc',
      'account 123456789',
      'eyJhbGciOiJIUzI1NiJ9.example.signature',
    ]) {
      const safe = redactDiagnostic(input);
      expect(safe).not.toMatch(/alice|private.txt|short|Basic abc|secret=abc|123456789|eyJhb/iu);
    }
    expect(redactDiagnostic('音乐进程读取会话失败')).toBe('音乐进程读取会话失败');
    expect(redactDiagnostic('中'.repeat(10000)).length).toBeLessThanOrEqual(2048);
  });
  it('只允许固定事件，不接收任意元数据/路径/正文，关联标识为随机 UUID', () => {
    const trace = traceCall('music_execute', 'provider');
    expect(trace.id).toMatch(/^[a-f0-9-]{36}$/u);
    trace.finish(false);
    const event = {
      level: 'error',
      event: 'ipc.failed',
      operation: 'music_execute/provider',
      trace: trace.id,
      durationMs: 5,
      message: null,
    };
    expect(
      diagnosticRequestSchema.safeParse({ operation: 'ingest', entries: [event] }).success,
    ).toBe(true);
    expect(
      diagnosticRequestSchema.safeParse({
        operation: 'ingest',
        entries: [{ ...event, headers: { cookie: 'private' } }],
      }).success,
    ).toBe(false);
    expect(
      diagnosticRequestSchema.safeParse({ operation: 'export', path: 'C:/private' }).success,
    ).toBe(false);
    expect(
      diagnosticRequestSchema.safeParse({
        operation: 'ingest',
        entries: Array.from({ length: 65 }, () => event),
      }).success,
    ).toBe(false);
  });
});
