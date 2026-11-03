/**
 * Electron 的结构化克隆允许对象包含 undefined，Tauri 的 JSON IPC 不允许。
 * 仅在适配边界省略可选字段，不放宽原生接口校验，也不调用输入对象的 toJSON。
 */
export function providerPayload(input: Record<string, unknown>): Record<string, unknown> {
  const ancestors = new Set<object>();
  let nodes = 0;
  const visit = (value: unknown, depth: number): unknown => {
    if (++nodes > 50000 || depth > 32) throw Error('音乐请求结构过大');
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'object' || value === null) throw Error('音乐请求包含非 JSON 数据');
    if (ancestors.has(value)) throw Error('音乐请求包含循环引用');
    const array = Array.isArray(value);
    if (
      !array &&
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    )
      throw Error('音乐请求只允许普通对象');
    ancestors.add(value);
    try {
      if (array)
        return Array.from(value, (entry: unknown) =>
          entry === undefined ? null : visit(entry, depth + 1),
        );
      const result: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(value)) {
        if (key.length > 100) throw Error('音乐请求字段过长');
        if (entry !== undefined)
          Object.defineProperty(result, key, {
            value: visit(entry, depth + 1),
            enumerable: true,
            configurable: true,
            writable: true,
          });
      }
      return result;
    } finally {
      ancestors.delete(value);
    }
  };
  // 根对象由调用签名和 IPC schema 双重约束；递归结果仍以 unknown 校验。
  const value = visit(input, 0);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('音乐请求参数无效');
  const result = Object.fromEntries(Object.entries(value));
  if (JSON.stringify(result).length > 2 * 1024 * 1024) throw Error('音乐请求超过大小限制');
  return result;
}
