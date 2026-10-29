function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** IPC 已经由 Zod 验证；缓存比较只读时间戳，避免每秒重复解析整套方案库。 */
export function keepNewerHudReadings(previous: unknown, incoming: unknown): unknown {
  if (!record(previous) || !record(incoming)) return incoming;
  const old = previous['live'],
    next = incoming['live'];
  if (!record(old) || !record(next)) return incoming;
  const oldTime = old['capturedAt'],
    nextTime = next['capturedAt'];
  if (typeof oldTime === 'number' && typeof nextTime === 'number' && oldTime > nextTime)
    return { ...incoming, live: old };
  return incoming;
}
