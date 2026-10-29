import assert from 'node:assert/strict';

/**
 * Tauri 为 MSI 内 EXE 写入 MSI 标记，归档完成后保留构建目录的 UNK 版本。
 * 只规范化这个唯一、固定长度的安装类型标记；其他任何字节不同仍必须使哈希校验失败。
 */
export function msiExecutable(source: Buffer): Buffer {
  const prefix = Buffer.from('__TAURI_BUNDLE_TYPE_VAR_');
  const offset = source.indexOf(prefix);
  assert.ok(offset >= 0, '主 EXE 缺少 Tauri 安装类型标记');
  assert.equal(source.indexOf(prefix, offset + prefix.length), -1, '安装类型标记不唯一');
  const position = offset + prefix.length;
  assert.ok(
    ['UNK', 'MSI'].includes(source.subarray(position, position + 3).toString()),
    '未知的 Tauri 安装类型',
  );
  const result = Buffer.from(source);
  result.write('MSI', position, 3, 'ascii');
  return result;
}
