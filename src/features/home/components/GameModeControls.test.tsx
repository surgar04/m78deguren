import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GameModeControls } from './HomeActions';
import { TopBar } from './DesktopChrome';
import type * as HomeRepository from '../repository';

// 仅在测试中捕获 IPC 意图，不让确认策略的验证真的改变开发机调度或键盘输入。
const state = vi.hoisted(() => ({ confirm: true, mutate: vi.fn() }));
vi.mock('../repository', async (original) => ({
  ...(await original<typeof HomeRepository>()),
  useHome: () => ({
    data: {
      runtime: {
        ready: true,
        effective: false,
        suppressedCount: 0,
        message: '',
        recoverableCount: 0,
      },
      policy: { autoGameMode: false, disableWinInGame: false },
    },
  }),
  useHomeAction: () => ({ mutate: state.mutate, isPending: false }),
}));
vi.mock('@/features/settings/repository', () => ({
  useSettingsSnapshot: () => ({ data: { config: { confirmActions: state.confirm } } }),
}));
beforeEach(() => {
  state.confirm = true;
  state.mutate.mockClear();
});
describe('游戏控制的可配置二次确认', () => {
  it('默认先审阅，明确勾选后才发送原生请求', async () => {
    const user = userEvent.setup();
    render(<GameModeControls notify={vi.fn()} busy={vi.fn()} />);
    await user.click(screen.getByRole('switch', { name: '游戏模式' }));
    expect(state.mutate).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '确认执行' })).toBeDisabled();
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: '确认执行' }));
    expect(state.mutate).toHaveBeenCalledWith(
      { operation: 'manual', enabled: true, consent: true },
      expect.any(Object),
    );
  });
  it('用户关闭确认后，Win 策略直接发送且不制造前端假状态', async () => {
    state.confirm = false;
    const user = userEvent.setup();
    render(<GameModeControls notify={vi.fn()} busy={vi.fn()} />);
    await user.click(screen.getByRole('switch', { name: '游戏时禁用 Win 键' }));
    expect(screen.queryByRole('button', { name: '确认执行' })).not.toBeInTheDocument();
    expect(state.mutate).toHaveBeenCalledWith(
      { operation: 'policy', key: 'disableWinInGame', enabled: true, consent: true },
      expect.any(Object),
    );
    expect(screen.getByRole('switch', { name: '游戏时禁用 Win 键' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });
  it('顶栏遵循同一设置，关闭二次确认时无需先打开弹窗', async () => {
    state.confirm = false;
    const open = vi.fn(),
      user = userEvent.setup();
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter>
          <TopBar open={open} notify={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await user.click(screen.getByRole('switch', { name: '游戏模式' }));
    expect(open).not.toHaveBeenCalled();
    expect(state.mutate).toHaveBeenCalledWith(
      { operation: 'manual', enabled: true, consent: true },
      expect.any(Object),
    );
  });
});
