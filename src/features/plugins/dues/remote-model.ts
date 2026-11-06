import type { DuesLedger, DuesMember, RemoteFee, RemoteFees } from '@/lib/dues-contracts';

export type ApiStatus = 'active' | 'due_today' | 'expired' | 'no_record';
export type FeeRow = {
  member: DuesMember;
  knownMembership: boolean;
  fees: RemoteFees['members'][number] | undefined;
};
export const statusNames: Record<ApiStatus, string> = {
  active: '未到期',
  due_today: '今日到期',
  expired: '已过期',
  no_record: '无 API 记录',
};
export const gameMoney = (value: number) => `${value.toLocaleString('zh-CN')} 游戏币`;
/** 固定使用接口时区的自然日，不依赖电脑当前时区；未知时区保留服务端计算日并显示出来。 */
export function dayInZone(timeZone: string, now = new Date()): string | null {
  try {
    const parts = new Map(
      new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })
        .formatToParts(now)
        .map((p) => [p.type, p.value]),
    );
    return `${parts.get('year') ?? ''}-${parts.get('month') ?? ''}-${parts.get('day') ?? ''}`;
  } catch {
    return null;
  }
}
export function evaluationDay(snapshot: RemoteFees, now = new Date()): string {
  return dayInZone(snapshot.meta.timeZone, now) ?? snapshot.meta.evaluatedOn;
}
/** 到期自然日当天仍有效；只使用 API 给出的 expiresOn，不在客户端推算月费/补缴算法。 */
export function feeState(
  fee: RemoteFee | undefined,
  day: string,
): { status: ApiStatus; days: number | null } {
  if (!fee) return { status: 'no_record', days: null };
  const days = Math.round(
    (Date.parse(fee.expiresOn + 'T00:00:00Z') - Date.parse(day + 'T00:00:00Z')) / 86400000,
  );
  return { status: days < 0 ? 'expired' : days === 0 ? 'due_today' : 'active', days };
}
export function feeRows(ledger: DuesLedger): FeeRow[] {
  const remote = new Map(ledger.remoteFees?.members.map((f) => [f.member.wxid, f]) ?? []);
  const result: FeeRow[] = ledger.members.map((member) => ({
    member: {
      ...member,
      avatarUrl: member.avatarUrl || remote.get(member.wxid)?.member.avatarUrl || '',
    },
    knownMembership: true,
    fees: remote.get(member.wxid),
  }));
  const known = new Set(ledger.members.map((m) => m.wxid));
  for (const fees of remote.values())
    if (!known.has(fees.member.wxid))
      result.push({
        knownMembership: false,
        fees,
        member: {
          wxid: fees.member.wxid,
          nickname: fees.member.nickname,
          groupNickname: '',
          avatarUrl: fees.member.avatarUrl ?? '',
          active: false,
          localNickname: null,
          localGroupNickname: null,
          remark: '',
        },
      });
  return result;
}
export function wholeAmount(text: string): number | null {
  if (!/^\d{1,16}$/u.test(text.trim())) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}
/** 所选月统计实际 paymentDate 入账，不把年费在覆盖月份重复相加，也不把本月无登记等同欠费。 */
export function monthFees(snapshot: RemoteFees, month: string) {
  const records = snapshot.records.filter((f) => f.paymentDate.startsWith(month + '-'));
  return {
    records,
    people: new Set(records.map((f) => f.member.wxid)),
    amount: records.reduce((sum, f) => sum + f.amount, 0),
  };
}
