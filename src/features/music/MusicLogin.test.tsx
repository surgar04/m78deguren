import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { MusicLogin } from './MusicLogin';
const state = vi.hoisted(() => ({
  engine: vi.fn<(operation: string, ...args: unknown[]) => Promise<unknown>>(),
  answer: {
    state: 'waiting',
    message: '',
    phase: 'reading',
    code: '',
    diagnostics: 'fixture reading',
  },
}));
vi.mock('./engine', () => ({ musicEngine: state.engine }));
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  state.answer = {
    state: 'waiting',
    message: '',
    phase: 'reading',
    code: '',
    diagnostics: 'fixture reading',
  };
  state.engine.mockReset().mockImplementation((operation: string) => {
    if (operation === 'loginMethods')
      return Promise.resolve([{ id: 'browser', label: '浏览器登录' }]);
    if (operation === 'loginStart')
      return Promise.resolve({ key: 'fixture-ticket', image: '', browser: true });
    if (operation === 'loginCheck') return Promise.resolve(state.answer);
    return Promise.resolve(null);
  });
});
function view() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}
    >
      <MusicLogin provider="ytm" onClose={vi.fn()} />
    </QueryClientProvider>,
  );
}
it('明确说明关闭专用窗口，并显示读取/验证阶段和可复制诊断', async () => {
  view();
  expect(screen.getByText(/等待 YouTube Music 页面显示你的账号/u)).toBeInTheDocument();
  await userEvent.setup().click(await screen.findByRole('button', { name: '打开授权页面' }));
  expect(await screen.findByText(/正在读取专用浏览器的登录会话/u)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '复制脱敏诊断' })).toBeInTheDocument();
});
it('会话缺失显示明确错误、恢复建议与代码，不再误报二维码过期', async () => {
  state.answer = {
    state: 'error',
    message: '没有读到有效的 YouTube Music 登录会话，请重新授权',
    phase: 'error',
    code: 'session-missing',
    diagnostics: 'fixture error session-missing',
  };
  view();
  await userEvent.setup().click(await screen.findByRole('button', { name: '打开授权页面' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('没有读到有效');
  expect(screen.getByRole('alert')).toHaveTextContent('session-missing');
  expect(screen.queryByText('二维码已过期')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '重新授权' })).toBeEnabled();
});
it('浏览器过期使用浏览器提示，组件启动失败可见且可重试', async () => {
  state.answer = { state: 'expired', message: '', phase: 'error', code: '', diagnostics: '' };
  view();
  state.engine.mockRejectedValueOnce(Error('音乐组件无法启动，请修复安装'));
  await userEvent.setup().click(await screen.findByRole('button', { name: '打开授权页面' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('音乐组件无法启动');
  await userEvent.setup().click(screen.getByRole('button', { name: '打开授权页面' }));
  expect(await screen.findByText('浏览器授权未完成或已过期，请重新授权')).toBeInTheDocument();
});
