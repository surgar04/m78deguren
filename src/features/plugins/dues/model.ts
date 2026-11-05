import type { DuesLedger, DuesMember, DuesPayment } from '@/lib/dues-contracts';

/** 金额转换不经过浮点乘法，避免 1.01 * 100 产生舍入误差；拒绝指数和超出两位小数。 */
export function parseMoney(input: string): number | null {
  const value = input.trim();
  if (!/^(0|[1-9]\d{0,6})(\.\d{1,2})?$/u.test(value)) return null;
  const [yuan = '', fraction = ''] = value.split('.');
  const cents = Number(yuan) * 100 + Number(fraction.padEnd(2, '0'));
  return cents <= 100_000_000 ? cents : null;
}
export function money(cents: number): string {
  return (cents / 100).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
export function currentMonth(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}
export function addMonths(month: string, count: number): string {
  const [year = 0, index = 1] = month.split('-').map(Number);
  const total = year * 12 + index - 1 + count;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}
export function covers(payment: DuesPayment, month: string): boolean {
  return (
    !payment.voidedAt && payment.month <= month && month < addMonths(payment.month, payment.months)
  );
}
export function nameOf(member: DuesMember): string {
  return (
    (member.localGroupNickname ?? member.groupNickname) ||
    (member.localNickname ?? member.nickname) ||
    member.wxid
  );
}
export type DuesRow = { member: DuesMember; payment: DuesPayment | undefined };
export type TableFilter = {
  search: string;
  status: 'all' | 'paid' | 'unpaid';
  membership: 'active' | 'all' | 'inactive';
  sort: 'unpaid' | 'name' | 'amount';
  minAmount: number | null;
  maxAmount: number | null;
};
export function rowsFor(ledger: DuesLedger, month: string): DuesRow[] {
  const paid = new Map<string, DuesPayment>();
  for (const payment of ledger.payments)
    if (covers(payment, month)) paid.set(payment.wxid, payment);
  return ledger.members.map((member) => ({ member, payment: paid.get(member.wxid) }));
}
export function filterRows(rows: DuesRow[], filter: TableFilter): DuesRow[] {
  const search = filter.search.trim().toLocaleLowerCase();
  return rows
    .filter(({ member: m, payment }) => {
      const amount = payment?.amountCents ?? 0;
      return (
        (filter.membership === 'all' || m.active === (filter.membership === 'active')) &&
        (filter.status === 'all' || Boolean(payment) === (filter.status === 'paid')) &&
        (!search ||
          [
            m.wxid,
            m.nickname,
            m.groupNickname,
            m.localNickname,
            m.localGroupNickname,
            m.remark,
            payment?.remark,
          ]
            .filter(Boolean)
            .join(' ')
            .toLocaleLowerCase()
            .includes(search)) &&
        (filter.minAmount === null || amount >= filter.minAmount) &&
        (filter.maxAmount === null || amount <= filter.maxAmount)
      );
    })
    .sort((a, b) => {
      if (filter.sort === 'unpaid' && Boolean(a.payment) !== Boolean(b.payment))
        return a.payment ? 1 : -1;
      if (filter.sort === 'amount' && a.payment?.amountCents !== b.payment?.amountCents)
        return (b.payment?.amountCents ?? 0) - (a.payment?.amountCents ?? 0);
      return (
        nameOf(a.member).localeCompare(nameOf(b.member), 'zh-CN') ||
        a.member.wxid.localeCompare(b.member.wxid)
      );
    });
}
export function statistics(rows: DuesRow[], ledger: DuesLedger, month: string) {
  const active = rows.filter((row) => row.member.active);
  const paid = active.filter((row) => row.payment).length;
  return {
    total: active.length,
    paid,
    unpaid: active.length - paid,
    ratio: active.length ? Math.round((paid / active.length) * 1000) / 10 : 0,
    // 年费按收款起始月计一次，不在每个覆盖月份重复计入现金收入。
    receivedCents: ledger.payments
      .filter((p) => !p.voidedAt && p.month === month)
      .reduce((sum, p) => sum + p.amountCents, 0),
  };
}
