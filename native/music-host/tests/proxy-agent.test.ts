// @vitest-environment node
import { createServer } from 'node:http';
import type { Socket } from 'node:net';
import { expect, it } from 'vitest';
import { proxyDispatcher, closeMusicNetwork } from '../network-route.ts';

it('实际 Node fetch 能通过 Undici 8 的兼容 dispatcher 使用代理，不访问外部服务', async () => {
  let connections = 0;
  const sockets = new Set<Socket>();
  const server = createServer((_request, response) => {
    connections++;
    response.end('fixture');
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  server.on('connect', (_request, socket) => {
    connections++;
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    socket.once('data', () => {
      socket.end('HTTP/1.1 200 OK\r\nContent-Length: 7\r\nConnection: close\r\n\r\nfixture');
    });
    socket.on('error', () => {});
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('fixture server unavailable');
  try {
    const options = {
      dispatcher: proxyDispatcher(`http://127.0.0.1:${address.port}`),
      signal: AbortSignal.timeout(5000),
    };
    const response = await fetch('http://fixture.invalid/test', options);
    expect(await response.text()).toBe('fixture');
    expect(connections).toBe(1);
  } finally {
    for (const socket of sockets) socket.destroy();
    await closeMusicNetwork();
    await new Promise<void>((done) => server.close(() => done()));
  }
}, 10000);
