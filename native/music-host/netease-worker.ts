import http from 'node:http';
import { workerData } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { z } from 'zod';

const { secret } = z.object({ secret: z.string().regex(/^[a-f0-9]{64}$/u) }).parse(workerData);
const original: unknown = Reflect.get(http.Server.prototype, 'emit');
if (typeof original !== 'function') throw Error('音乐 API HTTP 分发入口不可用');
// 原 SDK 的监听入口没有鉴权。仅在此专用 worker 的 HTTP 分发层先验口令，保持上游加密/扫码代码原样。
http.Server.prototype.emit = function (
  this: http.Server,
  event: string | symbol,
  ...args: unknown[]
): boolean {
  if (event === 'request') {
    const [request, response] = args;
    if (!(request instanceof http.IncomingMessage) || !(response instanceof http.ServerResponse))
      return false;
    if (request.headers['x-zhenjing-music'] !== secret) {
      response.writeHead(403, { 'content-type': 'text/plain' }).end();
      return true;
    }
  }
  const emitted: unknown = Reflect.apply(original, this, [event, ...args]);
  return emitted === true;
};
process.env.CORS_ALLOW_ORIGIN = 'http://music.internal';
createRequire(import.meta.url)('./upstream/electron/netease/neteaseApiWorker.cjs');
