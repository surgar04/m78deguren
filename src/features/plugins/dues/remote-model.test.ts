import { expect, it } from 'vitest';
import { exampleRemoteLedger } from './test-fixtures';
import {
  dayInZone,
  evaluationDay,
  feeRows,
  feeState,
  gameMoney,
  monthFees,
  wholeAmount,
} from './remote-model';
it('按 wxid 关联，同名不同人不串账，保留本地备注和非群成员的未知状态', () => {
  const ledger = exampleRemoteLedger(),
    rows = feeRows(ledger);
  const a = rows.find((r) => r.member.wxid === 'test-a'),
    b = rows.find((r) => r.member.wxid === 'test-b');
  expect(a?.fees?.latestFee.amount).toBe(2000000);
  expect(b?.fees?.latestFee.amount).toBe(200000);
  expect(b?.member.remark).toBe('待确认');
  expect(rows.find((r) => r.member.wxid === 'external-only')?.knownMembership).toBe(false);
  expect(rows.find((r) => r.member.wxid === 'test-c')?.fees).toBeUndefined();
  expect(ledger.payments[0]?.amountCents).toBe(10000);
});
it('以最新方案和到期自然日判断资格，跨天无需等待 revision 改变', () => {
  const ledger = exampleRemoteLedger(),
    snapshot = ledger.remoteFees;
  if (!snapshot) throw Error('fixture');
  const b = snapshot.members.find((m) => m.member.wxid === 'test-b');
  expect(feeState(b?.latestFee, '2026-11-06').status).toBe('expired');
  expect(
    snapshot.records.some((r) => r.member.wxid === 'test-b' && !r.isLatest && !r.isExpired),
  ).toBe(true);
  const ext = snapshot.members.find((m) => m.member.wxid === 'external-only');
  expect(feeState(ext?.latestFee, '2026-11-06')).toEqual({ status: 'due_today', days: 0 });
  expect(feeState(ext?.latestFee, '2026-11-07')).toEqual({ status: 'expired', days: -1 });
  expect(feeState(undefined, '2026-11-07').status).toBe('no_record');
  expect(evaluationDay(snapshot, new Date('2026-11-06T16:00:00Z'))).toBe('2026-11-07');
  expect(dayInZone('America/Los_Angeles', new Date('2026-11-06T03:00:00Z'))).toBe('2026-11-05');
});
it('游戏币保持原整数，年费仅按原缴费日期计一次收入，重置不混入人民币', () => {
  const ledger = exampleRemoteLedger(),
    snapshot = ledger.remoteFees;
  if (!snapshot) throw Error('fixture');
  expect(gameMoney(200000)).toBe('200,000 游戏币');
  expect(wholeAmount('20W')).toBeNull();
  expect(wholeAmount('1.01')).toBeNull();
  expect(wholeAmount('9007199254740992')).toBeNull();
  expect(wholeAmount('200000')).toBe(200000);
  expect(monthFees(snapshot, '2026-11').amount).toBe(2000000);
  expect(monthFees(snapshot, '2026-12').amount).toBe(0);
  snapshot.members = [];
  snapshot.records = [];
  expect(feeRows(ledger).every((r) => !r.fees)).toBe(true);
  expect(ledger.payments[0]?.amountCents).toBe(10000);
});
