import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeAll, expect, it, vi } from 'vitest';
import DuesTable from './DuesTable';
import { exampleLedger } from './test-fixtures';

const state = vi.hoisted(() => ({ mutate: vi.fn(), reset: vi.fn() }));
vi.mock('./repository', () => ({
  DUES_KEY: ['plugins', 'builtin-dues'],
  useDues: () => ({ data: exampleLedger(), error: null }),
  useDuesAction: () => ({ ...state, isPending: false, isError: false, error: null }),
  useDuesAutoSync: () => ({ isFetching: false, error: null, refetch: () => Promise.resolve() }),
  callDues: () => Promise.resolve(null),
}));
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
it('筛选未缴、编辑资料、批量登记及撤销年费均需显式操作', () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <DuesTable />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: '本地人民币账本' }));
  fireEvent.change(screen.getByLabelText('查看月份'), { target: { value: '2026-11' } });
  expect(screen.getByLabelText('当月会费统计')).toHaveTextContent('50%');
  fireEvent.click(screen.getByRole('button', { name: '查看未缴人员 →' }));
  expect(screen.getByRole('table', { name: /成员会费表/ })).not.toHaveTextContent('test-a');
  fireEvent.click(screen.getByRole('button', { name: '编辑' }));
  const edit = screen.getByRole('dialog');
  fireEvent.change(within(edit).getByLabelText('群昵称'), { target: { value: '本地群昵称' } });
  fireEvent.click(within(edit).getByRole('button', { name: '确认保存' }));
  expect(state.mutate).toHaveBeenCalledWith(
    expect.objectContaining({
      action: 'edit-member',
      wxid: 'test-b',
      groupNickname: '本地群昵称',
      revision: 5,
    }),
    expect.any(Object),
  );
  fireEvent.click(within(edit).getByRole('button', { name: '取消' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '选择本页所有未缴成员' }));
  fireEvent.click(screen.getByRole('button', { name: '批量登记已缴' }));
  const pay = screen.getByRole('dialog');
  expect(within(pay).getByRole('button', { name: '确认保存' })).toBeDisabled();
  fireEvent.change(within(pay).getByLabelText('缴费类型'), { target: { value: 'annual' } });
  expect(within(pay).getByLabelText('每人缴纳金额（元）')).toHaveValue('100.00');
  expect(pay).toHaveTextContent('2027-10');
  fireEvent.click(within(pay).getByRole('checkbox', { name: /我已核对成员/ }));
  fireEvent.click(within(pay).getByRole('button', { name: '确认保存' }));
  expect(state.mutate).toHaveBeenCalledWith(
    expect.objectContaining({
      action: 'pay',
      wxids: ['test-b'],
      kind: 'annual',
      month: '2026-11',
      amountCents: 10000,
    }),
    expect.any(Object),
  );
  fireEvent.click(within(pay).getByRole('button', { name: '取消' }));
  fireEvent.click(screen.getByRole('tab', { name: '缴费流水' }));
  fireEvent.click(screen.getByRole('button', { name: '撤销缴费' }));
  const cancel = screen.getByRole('dialog');
  expect(cancel).toHaveTextContent('2027-10');
  expect(within(cancel).getByRole('button', { name: '确认保存' })).toBeDisabled();
  client.clear();
});
