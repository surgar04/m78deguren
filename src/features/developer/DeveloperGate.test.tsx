import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DeveloperGate } from './DeveloperGate';

const bridge = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('@/lib/desktop', () => ({
  executeDeveloper: bridge.execute,
  isDesktop: () => true,
  desktopWindowLabel: () => 'main',
  errorMessage: () => '认证服务不可用',
}));
beforeEach(() => {
  bridge.execute.mockReset().mockResolvedValue({
    edition: 'developer',
    mode: 'locked',
    build: '1.0.0-dev.1',
    expiresAt: null,
    message: '',
  });
  // jsdom 不实现原生 dialog；只替代容器生命周期，不替代认证结果或业务断言。
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
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DeveloperGate>
        <div>真实业务页面</div>
      </DeveloperGate>
    </QueryClientProvider>,
  );
}
describe('开发者启动关口', () => {
  it('未经认证不挂载业务页面，跳过后使用原生返回的稳定模式', async () => {
    mount();
    await screen.findByRole('dialog');
    expect(screen.queryByText('真实业务页面')).not.toBeInTheDocument();
    bridge.execute.mockResolvedValue({
      edition: 'developer',
      mode: 'stable',
      build: '1.0.0-dev.1',
      expiresAt: null,
      message: '已回退',
    });
    await userEvent.setup().click(screen.getByRole('button', { name: '使用发布版' }));
    await screen.findByText('真实业务页面');
    expect(bridge.execute).toHaveBeenCalledWith({ operation: 'fallback' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('认证失败不会在前端自行解锁为开发者，也不把凭据放进查询键', async () => {
    mount();
    await screen.findByRole('dialog');
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('邮箱'), 'test@example.com');
    await user.type(screen.getByLabelText('stoken'), 'test-token');
    bridge.execute.mockRejectedValue(new Error('transport unavailable'));
    await user.click(screen.getByRole('button', { name: '认证开发者身份' }));
    await screen.findByRole('alert');
    await waitFor(() => expect(screen.getByLabelText('stoken')).toHaveValue(''));
    expect(screen.queryByText('真实业务页面')).not.toBeInTheDocument();
  });
});
