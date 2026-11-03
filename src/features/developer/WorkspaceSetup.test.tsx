import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WorkspaceGate } from './WorkspaceSetup';
const bridge = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('@/lib/desktop', () => ({
  executeWorkspace: bridge.execute,
  errorMessage: () => '准备失败',
}));
const base = {
  phase: 'idle',
  message: '选择源码目录',
  root: null,
  branch: 'codex/develop',
  commit: null,
  promptRequired: true,
  ticket: null,
};
beforeEach(() => {
  bridge.execute.mockReset().mockResolvedValue(base);
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.setAttribute('open', '');
      },
    },
    close: {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.removeAttribute('open');
      },
    },
  });
});
function mount() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <WorkspaceGate>
        <p>主页面</p>
      </WorkspaceGate>
    </QueryClientProvider>,
  );
}
describe('认证后的源码工作区', () => {
  it('首次显示独立目录向导，明确稍后设置才进入主页面', async () => {
    mount();
    await screen.findByRole('dialog');
    expect(screen.queryByText('主页面')).not.toBeInTheDocument();
    bridge.execute.mockResolvedValue({ ...base, phase: 'deferred', promptRequired: false });
    await userEvent.setup().click(screen.getByRole('button', { name: '稍后设置' }));
    await screen.findByText('主页面');
    expect(bridge.execute).toHaveBeenCalledWith({ operation: 'defer' });
  });
  it('通过原生选择票据准备目录，不传路径或执行命令', async () => {
    mount();
    await screen.findByRole('dialog');
    const ticket = '01508c18-5b0b-443e-a381-dc4cb91610fe';
    const user = userEvent.setup();
    bridge.execute.mockResolvedValue({ ...base, phase: 'selected', root: 'D:/fixture', ticket });
    await user.click(screen.getByRole('button', { name: '选择源码目录 / 重试' }));
    bridge.execute.mockResolvedValue({ ...base, phase: 'preparing', root: 'D:/fixture' });
    await user.click(await screen.findByRole('button', { name: '确认目录并准备环境' }));
    await waitFor(() =>
      expect(bridge.execute).toHaveBeenCalledWith({ operation: 'prepare', ticket, consent: true }),
    );
    expect(await screen.findByRole('button', { name: '取消准备' })).toBeEnabled();
  });
});
