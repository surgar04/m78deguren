import { exampleLedger } from './test-fixtures';
import { describe, expect, it } from 'vitest';
import { duesRequestSchema } from '@/lib/dues-contracts';
import {
  addMonths,
  covers,
  currentMonth,
  filterRows,
  nameOf,
  parseMoney,
  rowsFor,
  statistics,
} from './model';

describe('会费金额与跨月统计', () => {
  it('以整数分精确转换，拒绝指数、负数、三位小数和超限', () => {
    expect(parseMoney('1.01')).toBe(101);
    expect(parseMoney('0.29')).toBe(29);
    expect(parseMoney('1000000')).toBe(100000000);
    for (const value of ['-1', '1e3', '1.001', '1000000.01', 'NaN', ''])
      expect(parseMoney(value)).toBeNull();
    expect(currentMonth(new Date(2026, 10, 5))).toBe('2026-11');
  });
  it('年费跨年覆盖12个月，收入只计起始月，撤销后恢复未缴', () => {
    const ledger = exampleLedger(),
      payment = ledger.payments[0];
    if (!payment) throw new Error('missing fixture');
    expect(addMonths('2026-11', 11)).toBe('2027-10');
    expect(covers(payment, '2027-10')).toBe(true);
    expect(covers(payment, '2027-11')).toBe(false);
    expect(statistics(rowsFor(ledger, '2026-11'), ledger, '2026-11')).toEqual({
      total: 2,
      paid: 1,
      unpaid: 1,
      ratio: 50,
      receivedCents: 10000,
    });
    expect(statistics(rowsFor(ledger, '2027-01'), ledger, '2027-01').receivedCents).toBe(0);
    payment.voidedAt = '2026-11-06T00:00:00Z';
    payment.voidReason = '更正';
    expect(statistics(rowsFor(ledger, '2026-11'), ledger, '2026-11').paid).toBe(0);
  });
  it('按状态、备注、金额、成员范围组合筛选，未缴优先', () => {
    const ledger = exampleLedger(),
      rows = rowsFor(ledger, '2026-11');
    const filter = {
      search: '',
      status: 'all' as const,
      membership: 'active' as const,
      sort: 'unpaid' as const,
      minAmount: null,
      maxAmount: null,
    };
    expect(filterRows(rows, filter).map((row) => row.member.wxid)).toEqual(['test-b', 'test-a']);
    expect(
      filterRows(rows, { ...filter, search: '待确认', status: 'unpaid' }).map(
        (row) => row.member.wxid,
      ),
    ).toEqual(['test-b']);
    expect(filterRows(rows, { ...filter, minAmount: 10000 }).map((row) => row.member.wxid)).toEqual(
      ['test-a'],
    );
    expect(
      filterRows(rows, { ...filter, membership: 'inactive' }).map((row) => row.member.wxid),
    ).toEqual(['test-c']);
    const member = ledger.members[1];
    if (!member) throw new Error('missing fixture');
    member.localGroupNickname = '';
    expect(nameOf(member)).toBe('本地乙');
  });
  it('拒绝伪造 IPC 路径、未知操作及非整数金额', () => {
    expect(
      duesRequestSchema.safeParse({ action: 'sync', revision: 1, url: 'http://127.0.0.1' }).success,
    ).toBe(false);
    expect(
      duesRequestSchema.safeParse({
        action: 'settings',
        revision: 1,
        monthlyCents: 1.1,
        annualCents: 0,
      }).success,
    ).toBe(false);
    expect(
      duesRequestSchema.safeParse({ action: 'avatar', wxid: 'test-a', path: 'D:/private' }).success,
    ).toBe(false);
  });
});
