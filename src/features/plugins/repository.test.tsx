import { act, renderHook, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { usePluginAction } from './repository';

vi.mock('@/lib/desktop', () => ({
  isDesktop: () => false,
  executePlugins: () => Promise.resolve(null),
}));
afterEach(cleanup);
it('撤权后清除该插件旧授权时期的视图缓存，保留其他插件缓存', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const own = ['plugins', 'view', 'test.own', 'a'.repeat(64), 'render'];
  const other = ['plugins', 'view', 'test.other', 'b'.repeat(64), 'render'];
  client.setQueryData(own, { type: 'text', text: '旧数据' });
  client.setQueryData(other, { type: 'text', text: '其他插件' });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => usePluginAction(z.null()), { wrapper });
  await act(async () => {
    await result.current.mutateAsync({
      operation: 'configure',
      id: 'test.own',
      digest: 'a'.repeat(64),
      enabled: false,
      grants: [],
      revision: 1,
      consent: false,
    });
  });
  expect(client.getQueryData(own)).toBeUndefined();
  expect(client.getQueryData(other)).toEqual({ type: 'text', text: '其他插件' });
  client.clear();
});
