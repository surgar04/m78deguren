import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AboutPanel } from './AboutPanel';
import { useSettingsUi } from './ui-store';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AboutPanel />
    </QueryClientProvider>,
  );
}

// 仅记录请求，不加载原生桥接或执行安装；安装编排由 Rust 的隔离测试覆盖。
const state = vi.hoisted(() => ({
  phase: 'ready',
  mutate: vi.fn(),
  token: '5a3ce0d6-8784-44bd-a7f5-08e20b55b917',
}));
vi.mock('./repository', () => ({
  useSettingsSnapshot: () => ({ data: { version: '0.9.1', author: 'Sur方糖', changelog: '' } }),
  useSettingsQuery: () => ({
    data: {
      phase: state.phase,
      token: state.token,
      message: '已完成校验',
      latestVersion: '9.0.0',
      changelog: '',
    },
  }),
  useSettingsAction: () => ({ mutate: state.mutate, isPending: false }),
}));
beforeEach(() => {
  useSettingsUi.getState().patch({ language: 'zh-CN' });
  state.phase = 'ready';
  state.mutate.mockClear();
});
describe('更新页不再要求二次安装确认', () => {
  it('立即安装直接提交一次性凭据，没有确认弹窗和任意包路径', async () => {
    renderPanel();
    await userEvent.setup().click(screen.getByRole('button', { name: '立即安装 / 重试' }));
    expect(state.mutate).toHaveBeenCalledWith({ operation: 'update-apply', token: state.token });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('原生安装进行中不再重复提供安装或检查操作，并保留日志入口', () => {
    state.phase = 'installing';
    renderPanel();
    expect(screen.queryByRole('button', { name: '立即安装 / 重试' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '检查更新' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '安装日志' })).toBeEnabled();
  });
});
