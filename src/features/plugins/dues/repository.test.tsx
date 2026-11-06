import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { exampleRemoteLedger } from './test-fixtures';
import { DUES_KEY, useDues, useDuesAutoSync } from './repository';
const native = vi.hoisted(() => ({ pending: new Map<string, (value: unknown) => void>() }));
vi.mock('@/lib/desktop', () => ({
  executePlugins: (
    request: { request: { action: string } },
    schema: { parse: (value: unknown) => unknown },
  ) =>
    new Promise<unknown>((resolve) => {
      native.pending.set(request.request.action, (value) => resolve(schema.parse(value)));
    }),
}));
afterEach(() => native.pending.clear());
function complete(action: string, value: unknown) {
  const resolve = native.pending.get(action);
  if (!resolve) throw Error('Missing IPC request');
  resolve(value);
  return Promise.resolve();
}
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}
it('新自动同步先到、旧 snapshot 后到时，界面保持新版本', async () => {
  const { client, wrapper } = setup();
  const hook = renderHook(
    () => {
      const ledger = useDues();
      useDuesAutoSync(true);
      return ledger;
    },
    { wrapper },
  );
  await waitFor(() => expect(native.pending.size).toBe(2));
  const fresh = exampleRemoteLedger();
  fresh.revision = 8;
  await act(() => complete('refresh-fees', fresh));
  await waitFor(() => expect(hook.result.current.data?.revision).toBe(8));
  const old = exampleRemoteLedger();
  old.revision = 7;
  await act(() => complete('snapshot', old));
  await waitFor(() => expect(hook.result.current.isFetching).toBe(false));
  expect(hook.result.current.data?.revision).toBe(8);
  hook.unmount();
  client.clear();
});
it('页面取消并清空缓存后，迟到的同步响应不能重新填回个人资料', async () => {
  const { client, wrapper } = setup();
  const hook = renderHook(() => useDuesAutoSync(true), { wrapper });
  await waitFor(() => expect(native.pending.has('refresh-fees')).toBe(true));
  hook.unmount();
  await client.cancelQueries({ queryKey: DUES_KEY });
  client.removeQueries({ queryKey: DUES_KEY });
  await act(() => complete('refresh-fees', exampleRemoteLedger()));
  expect(client.getQueryData([...DUES_KEY, 'ledger'])).toBeUndefined();
  client.clear();
});
