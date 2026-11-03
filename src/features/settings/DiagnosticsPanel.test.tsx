import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { DiagnosticsPanel } from './DiagnosticsPanel';
const bridge = vi.hoisted(() => ({
  execute: vi.fn<(request: { operation: string }) => Promise<unknown>>(),
}));
vi.mock('@/lib/desktop', () => ({
  executeDiagnostics: bridge.execute,
  errorMessage: () => '诊断操作失败',
}));
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  bridge.execute.mockReset().mockImplementation((request) =>
    Promise.resolve(
      request.operation === 'read'
        ? {
            session: 'fixture',
            version: '0.10.2',
            bytes: 1024,
            files: 1,
            detailUntil: 0,
            detailed: false,
            previousUnclean: true,
            entries: [
              {
                at: 'fixture',
                session: 'fixture',
                version: '0.10.2',
                level: 'error',
                source: 'music-host',
                event: 'auth.phase',
                operation: null,
                trace: null,
                durationMs: null,
                message: 'session-missing',
              },
            ],
          }
        : null,
    ),
  );
});
it('提供日志查看、未正常退出提示、明确清除确认和导出入口', async () => {
  const user = userEvent.setup();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}
    >
      <DiagnosticsPanel />
    </QueryClientProvider>,
  );
  await user.click(screen.getByRole('button', { name: '查看应用日志' }));
  expect(await screen.findByText(/上次会话没有正常退出记录/u)).toBeInTheDocument();
  expect(screen.getByText(/auth.phase/u)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '清除诊断日志' }));
  expect(bridge.execute.mock.calls.some(([request]) => request.operation === 'clear')).toBe(false);
  await user.click(screen.getByRole('button', { name: '确认清除' }));
  expect(bridge.execute).toHaveBeenCalledWith(
    { operation: 'clear', consent: true },
    expect.anything(),
  );
  expect(screen.getByRole('button', { name: '导出诊断' })).toBeEnabled();
});
