import { spawnSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  openSync,
  fsyncSync,
  closeSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

// 会话始终由当前 Windows 用户的 DPAPI 保护。没有加密能力时拒绝持久化，不落明文、不自建固定密钥。
const envelope = z
  .object({ version: z.literal(1), entries: z.record(z.string().max(128), z.string().max(200000)) })
  .strict();
export function createVault(root: string, helper: string) {
  mkdirSync(root, { recursive: true });
  const path = join(root, 'sessions.json');
  if (existsSync(path) && statSync(path).size > 8 * 1024 * 1024)
    throw Error('音乐会话仓库超过大小上限');
  const entries = existsSync(path)
    ? envelope.parse(JSON.parse(readFileSync(path, 'utf8')) as unknown).entries
    : {};
  const memory = new Map<string, unknown>();
  const transform = (value: string, operation: 'protect' | 'unprotect'): string => {
    if (Buffer.byteLength(value) > 131072) throw Error('音乐会话超过保护上限');
    const result = spawnSync(helper, ['--music-crypt', operation], {
      input: value,
      encoding: 'utf8',
      timeout: 15000,
      maxBuffer: 262144,
      windowsHide: true,
      env: process.env,
    });
    if (result.error || result.status !== 0)
      throw Error('当前 Windows 用户无法保护或读取音乐登录会话');
    return result.stdout;
  };
  const safeStorage = {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'dpapi',
    encryptString: (value: string) => Buffer.from(transform(value, 'protect'), 'utf8'),
    decryptString: (value: Buffer) => transform(value.toString('utf8'), 'unprotect'),
  };
  const flush = () => {
    const temp = `${path}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify({ version: 1, entries }), { mode: 0o600 });
    const handle = openSync(temp, 'r+');
    try {
      fsyncSync(handle);
    } finally {
      closeSync(handle);
    }
    renameSync(temp, path);
  };
  const store = {
    get(key: string): unknown {
      if (memory.has(key)) return memory.get(key);
      const value = entries[key];
      if (!value) return undefined;
      const decoded: unknown = JSON.parse(transform(value, 'unprotect'));
      memory.set(key, decoded);
      return decoded;
    },
    set(key: string, value: unknown) {
      if (
        !/^[a-zA-Z0-9_.:-]{1,128}$/.test(key) ||
        ['__proto__', 'constructor', 'prototype'].includes(key)
      )
        throw Error('音乐会话键无效');
      const encoded = JSON.stringify(value);
      if (encoded === undefined) throw Error('音乐会话不可序列化');
      const encrypted = transform(encoded, 'protect');
      entries[key] = encrypted;
      memory.set(key, value);
      flush();
    },
    delete(key: string) {
      delete entries[key];
      memory.delete(key);
      flush();
    },
  };
  return { store, safeStorage };
}
