import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import RemoteDuesTable from './RemoteDuesTable';
import { exampleRemoteLedger } from './test-fixtures';
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
afterEach(() => vi.useRealTimers());
it('自动填入游戏币、过期日、空历史登记时间，筛选过期及完整流水，无远端写入入口', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-06T03:00:00Z'));
  const onEdit = vi.fn();
  render(
    <RemoteDuesTable
      ledger={exampleRemoteLedger()}
      busy={false}
      error=""
      onRefresh={vi.fn()}
      onSyncMembers={vi.fn()}
      onLocal={vi.fn()}
      onEdit={onEdit}
      avatar={() => <span>头像</span>}
    />,
  );
  const table = screen.getByRole('table', { name: 'API 成员会费表' });
  expect(table).toHaveTextContent('2,000,000 游戏币');
  expect(table).toHaveTextContent('2027-11-01');
  expect(table).toHaveTextContent('历史记录未提供');
  expect(table).toHaveTextContent('群状态待同步');
  expect(screen.queryByRole('button', { name: '登记已缴' })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('会费状态'), { target: { value: 'expired' } });
  expect(table).toHaveTextContent('test-b');
  expect(table).not.toHaveTextContent('test-a');
  expect(table.querySelector('.dues-row-expired')).not.toBeNull();
  fireEvent.click(within(table).getByRole('button', { name: '编辑本地资料' }));
  expect(onEdit).toHaveBeenCalledWith(
    expect.objectContaining({ wxid: 'test-b', remark: '待确认' }),
  );
  fireEvent.click(within(table).getByRole('button', { name: 'API 流水' }));
  const dialog = screen.getByRole('dialog');
  expect(dialog).toHaveTextContent('fee-old-b');
  expect(dialog).toHaveTextContent('当前方案');
});
