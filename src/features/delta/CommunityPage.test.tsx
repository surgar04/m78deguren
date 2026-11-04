import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import CommunityPage from './CommunityPage';

const native = vi.hoisted(() =>
  vi.fn<(request: Record<string, unknown>, schema: unknown) => Promise<unknown>>(),
);
vi.mock('@/lib/desktop', () => ({
  isDesktop: () => true,
  executeGameRoom: native,
  errorMessage: (error: unknown) => (error instanceof Error ? error.message : 'fixture-error'),
}));
const clients = new Set<QueryClient>();
afterEach(() => {
  // React 组件卸载后还须清除请求/变更缓存，避免 GC 计时器拖住独立测试进程。
  for (const client of clients) client.clear();
  clients.clear();
  vi.restoreAllMocks();
});
beforeEach(() => {
  native.mockReset();
  native.mockImplementation((request: Record<string, unknown>) =>
    Promise.resolve(
      request['operation'] === 'categories'
        ? [
            { id: 1, name: '步枪', loadout_count: 1 },
            { id: 2, name: '冲锋枪', loadout_count: 1 },
          ]
        : request['operation'] === 'weapons'
          ? [{ weapon_name: request['category'] === 2 ? '测试冲锋枪' : '测试步枪', count: 1 }]
          : request['operation'] === 'passwords'
            ? {
                items: [{ name: '测试地图', password: '0557' }],
                fetchedAt: 1,
                source: 'fixture-only',
              }
            : request['operation'] === 'loadouts'
              ? {
                  data: [
                    {
                      id: 1,
                      category_id: 1,
                      weapon_name: '测试武器',
                      code: 'fixture-code',
                      description: 'fixture',
                      cost: 1000,
                      author: '测试作者',
                      likes: 0,
                      status: 'approved',
                      created_at: '2026-11-04',
                      category_name: '步枪',
                    },
                  ],
                  total: 50,
                  page: Number(request['page']),
                  totalPages: 2,
                }
              : null,
    ),
  );
});
function view() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false, gcTime: 0 },
    },
  });
  clients.add(client);
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CommunityPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
it('分页与分类使用各自查询身份，不把上一个分类结果串入新请求', async () => {
  view();
  await screen.findByText('fixture-code');
  fireEvent.click(screen.getByRole('button', { name: '下一页' }));
  await waitFor(() =>
    expect(native).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'loadouts', page: 2 }),
      expect.anything(),
    ),
  );
  fireEvent.change(screen.getByRole('combobox', { name: '改枪码分类' }), {
    target: { value: '2' },
  });
  await waitFor(() =>
    expect(native).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'loadouts', category: 2, page: 1 }),
      expect.anything(),
    ),
  );
  expect(await screen.findByText('0557')).toBeInTheDocument();
});
it('报告取消不调用社区写入；投稿必须携带用户确认与真实表单字段', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(false);
  view();
  await screen.findByText('fixture-code');
  fireEvent.click(screen.getByRole('button', { name: '报告不可用' }));
  expect(native.mock.calls.some(([request]) => request['operation'] === 'report')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '提交改枪码' }));
  fireEvent.change(screen.getByLabelText('武器名称'), { target: { value: '测试步枪' } });
  fireEvent.change(screen.getByLabelText('改枪费用'), { target: { value: '120000' } });
  fireEvent.change(screen.getByLabelText('改枪码', { exact: true }), {
    target: { value: 'new-fixture-code' },
  });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: '提交审核' }));
  await waitFor(() =>
    expect(native).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'submit',
        category: 1,
        weapon: '测试步枪',
        cost: 120000,
        code: 'new-fixture-code',
        consent: true,
      }),
      expect.anything(),
    ),
  );
});
