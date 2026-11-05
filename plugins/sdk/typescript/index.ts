import './host.d.ts';
import { call } from 'zhenjing:plugin/capabilities@1.0.0';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type View = {
  type: 'stack' | 'grid' | 'heading' | 'text' | 'metric' | 'notice' | 'button' | 'file';
  mode?: 'read' | 'write';
  text?: string;
  value?: string;
  command?: string;
  children?: View[];
};
/** SDK 不缓存权限；每次调用均由宿主使用真实插件身份再次验证。 */
function request(method: string, params: Json): unknown {
  const input = JSON.stringify({ method, params });
  if (input.length > 1024 * 1024) throw new Error('插件请求超过上限');
  return JSON.parse(call(input)) as unknown;
}
export const storage = {
  get(key: string): unknown {
    return request('storage.get', { key });
  },
  put(key: string, value: Json): void {
    request('storage.put', { key, value });
  },
  delete(key: string): void {
    request('storage.delete', { key });
  },
};
export const host = {
  readFile: (ticket: string): unknown => request('file.read', { ticket }),
  writeFile: (ticket: string, base64: string): void => {
    request('file.write', { ticket, base64 });
  },
  settings: (): unknown => request('settings.get', null),
  hardware: (): unknown => request('hardware.read', null),
  games: (): unknown => request('games.read', null),
  notify: (text: string): void => {
    request('notifications.show', { text });
  },
  get: (url: string): string => {
    const result = request('network.get', { url });
    if (typeof result !== 'string') throw new Error('网络响应不是文本');
    return result;
  },
};
export function view(value: View): string {
  return JSON.stringify(value);
}
