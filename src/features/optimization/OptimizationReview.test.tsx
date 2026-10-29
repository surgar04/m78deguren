import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import rawCatalog from '../../../src-tauri/src/services/tools/windows/optimizer-catalog.json';
import { optimizationCatalogSchema } from '@/lib/optimization-contracts';
import { executeBuiltin } from '@/lib/desktop';
import { createOptimizationCatalog } from './catalog';
import { OptimizationReview } from './OptimizationReview';
import { useOptimizationPreferences } from './store';

vi.mock('@/lib/desktop', () => ({
  executeBuiltin: vi.fn(),
  errorMessage: (cause: unknown) => (cause instanceof Error ? cause.message : '操作失败'),
}));
const catalog = createOptimizationCatalog(optimizationCatalogSchema.parse(rawCatalog));
const entries = ['showFileExtensions', 'disableUAC'].map((id) => {
  const setting = catalog.settings.find((item) => item.id === id);
  if (!setting) throw new Error('缺少目录项');
  return { setting, value: 'apply', label: '应用配置' };
});
const prepared = {
  token: '3424b5a0-79f9-46c7-9308-627118db8998',
  expiresInSeconds: 600,
  preview: {
    title: '只读测试预览',
    summary: ['不执行真实系统修改'],
    requiresAdmin: true,
    restartRequired: true,
    reversible: true,
    changes: [],
  },
};
function show() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <OptimizationReview entries={entries} onFinished={vi.fn()} />
    </QueryClientProvider>,
  );
}
describe('优化执行确认门禁', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useOptimizationPreferences.getState().clear();
    vi.mocked(executeBuiltin).mockResolvedValue(null);
  });
  it('预览不执行；高风险逐项确认和最终同意同时满足后才提交，关闭回执后再移除草稿', async () => {
    useOptimizationPreferences
      .getState()
      .replaceDrafts(entries.map((entry) => ({ id: entry.setting.id, value: entry.value })));
    vi.mocked(executeBuiltin)
      .mockResolvedValueOnce(prepared)
      .mockResolvedValueOnce({
        id: '8c0be1da-cf05-49b6-a42a-e56da81df685',
        title: '测试',
        state: 'completed',
        message: '内存测试回执',
        restartRequired: true,
        reversible: true,
        createdAt: 1,
        domain: 'optimization',
        itemIds: entries.map((entry) => entry.setting.id),
      });
    const view = show();
    expect(executeBuiltin).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '生成修改预览' }));
    await screen.findByRole('button', { name: '确认并执行系统修改' });
    const submit = screen.getByRole('button', { name: '确认并执行系统修改' });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: '确认显示文件扩展名' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /我已逐项核对风险/u }));
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: '确认禁用 UAC 用户帐户控制' }));
    expect(submit).toBeEnabled();
    expect(executeBuiltin).toHaveBeenCalledTimes(1);
    fireEvent.click(submit);
    await screen.findByText(/内存测试回执/u);
    expect(useOptimizationPreferences.getState().drafts).toHaveLength(2);
    view.unmount();
    expect(useOptimizationPreferences.getState().drafts).toEqual([]);
    await waitFor(() =>
      expect(executeBuiltin).toHaveBeenCalledWith(
        { operation: 'change-discard', token: prepared.token },
        expect.anything(),
      ),
    );
  });
  it('关闭等待中的预览后，迟到凭据被释放，不会执行系统修改', async () => {
    let finish: (value: typeof prepared) => void = () => {
      throw new Error('尚未初始化');
    };
    const pending = new Promise<unknown>((resolve) => {
      finish = (value) => resolve(value);
    });
    vi.mocked(executeBuiltin).mockReturnValueOnce(pending);
    const view = show();
    fireEvent.click(screen.getByRole('button', { name: '生成修改预览' }));
    await waitFor(() => expect(executeBuiltin).toHaveBeenCalledTimes(1));
    view.unmount();
    await act(async () => {
      finish(prepared);
      await pending;
    });
    await waitFor(() =>
      expect(executeBuiltin).toHaveBeenCalledWith(
        { operation: 'change-discard', token: prepared.token },
        expect.anything(),
      ),
    );
    expect(
      vi
        .mocked(executeBuiltin)
        .mock.calls.some(([request]) => request.operation === 'change-apply'),
    ).toBe(false);
  });
  it('提交失败后禁止复用令牌，重新预览必须重新逐项确认', async () => {
    vi.mocked(executeBuiltin).mockImplementation((request) => {
      if (request.operation === 'change-prepare') return Promise.resolve(prepared);
      if (request.operation === 'change-apply')
        return Promise.reject(new Error('测试失败，不执行真实修改'));
      return Promise.resolve(null);
    });
    show();
    fireEvent.click(screen.getByRole('button', { name: '生成修改预览' }));
    await screen.findByRole('button', { name: '确认并执行系统修改' });
    for (const entry of entries)
      fireEvent.click(screen.getByRole('checkbox', { name: `确认${entry.setting.name}` }));
    fireEvent.click(screen.getByRole('checkbox', { name: /我已逐项核对风险/u }));
    fireEvent.click(screen.getByRole('button', { name: '确认并执行系统修改' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: '确认并执行系统修改' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '重新生成修改预览' }));
    await waitFor(() =>
      expect(
        vi
          .mocked(executeBuiltin)
          .mock.calls.filter(([request]) => request.operation === 'change-prepare'),
      ).toHaveLength(2),
    );
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: '确认显示文件扩展名' })).not.toBeChecked(),
    );
    expect(screen.getByRole('button', { name: '确认并执行系统修改' })).toBeDisabled();
  });
});
