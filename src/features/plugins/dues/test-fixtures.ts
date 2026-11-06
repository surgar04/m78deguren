import { duesLedgerSchema, remoteFeesSchema, type RemoteFee } from '../../../lib/dues-contracts.ts';

export function exampleLedger() {
  return duesLedgerSchema.parse({
    schemaVersion: 1,
    revision: 5,
    groupName: '合成验收群',
    syncedAt: null,
    sourceUpdatedAt: null,
    complete: true,
    failedProfiles: 0,
    settings: { monthlyCents: 1000, annualCents: 10000 },
    members: [
      {
        wxid: 'test-a',
        nickname: '成员甲',
        groupNickname: '甲',
        avatarUrl: '',
        active: true,
        localNickname: null,
        localGroupNickname: null,
        remark: '',
      },
      {
        wxid: 'test-b',
        nickname: '成员乙',
        groupNickname: '乙',
        avatarUrl: '',
        active: true,
        localNickname: '本地乙',
        localGroupNickname: null,
        remark: '待确认',
      },
      {
        wxid: 'test-c',
        nickname: '成员丙',
        groupNickname: '丙',
        avatarUrl: '',
        active: false,
        localNickname: null,
        localGroupNickname: null,
        remark: '',
      },
    ],
    payments: [
      {
        id: '3ea0797c-45e7-4329-af99-e068e5927f6f',
        wxid: 'test-a',
        kind: 'annual',
        month: '2026-11',
        months: 12,
        amountCents: 10000,
        remark: '2026年11月起12个月会费',
        recordedAt: '2026-11-05T00:00:00Z',
        voidedAt: null,
        voidReason: null,
      },
    ],
  });
}

/** 合成游戏币快照。特意保留“旧年费仍有效、最新月费已过期”的情况，防止误用历史流水。 */
export function exampleRemoteLedger() {
  function fee(
    id: string,
    wxid: string,
    paymentDate: string,
    expiresOn: string,
    days: number,
    yearly = false,
    latest = true,
  ): RemoteFee {
    return {
      id,
      member: { wxid, nickname: '同名成员', avatarUrl: null },
      plan: yearly ? 'yearly' : 'monthly',
      planLabel: yearly ? '年费' : '月费',
      amount: yearly ? 2000000 : 200000,
      amountText: yearly ? '200W' : '20W',
      currency: 'POKEMMO_POKEYEN',
      paymentDate,
      paidAt: paymentDate + 'T00:00:00+08:00',
      recordedAt: null,
      operatorWxid: 'synthetic-operator',
      expiresOn,
      expiresAt: expiresOn + 'T15:59:59.999Z',
      expiresAtText: expiresOn,
      remainingDays: days,
      remainingDaysText: String(days),
      status: days < 0 ? 'expired' : days === 0 ? 'due_today' : 'active',
      isExpired: days < 0,
      isDueToday: days === 0,
      isBackPayment: false,
      isLatest: latest,
    };
  }
  const a = fee('fee-a', 'test-a', '2026-11-01', '2027-11-01', 360, true);
  const b = fee('fee-b', 'test-b', '2026-09-30', '2026-10-30', -7);
  const old = fee('fee-old-b', 'test-b', '2025-12-01', '2026-12-01', 25, true, false);
  const external = fee('fee-external', 'external-only', '2026-10-06', '2026-11-06', 0);
  const ledger = exampleLedger();
  ledger.remoteFees = remoteFeesSchema.parse({
    syncedAt: '2026-11-06T03:00:00Z',
    groupName: '合成验收群',
    meta: {
      schemaVersion: 1,
      revision: 12,
      updatedAt: '2026-11-06T03:00:00Z',
      evaluatedOn: '2026-11-06',
      timeZone: 'Asia/Shanghai',
      currency: 'POKEMMO_POKEYEN',
    },
    summary: {
      recordCount: 4,
      totalAmount: 4400000,
      memberCount: 3,
      activeMembers: 1,
      dueTodayMembers: 1,
      expiredMembers: 1,
    },
    members: [a, b, external].map((latest) => ({
      member: latest.member,
      latestFee: latest,
      recordCount: latest === b ? 2 : 1,
      totalAmount: latest === b ? 2200000 : latest.amount,
      totalAmountText: '合成金额',
      monthlyTotalAmount: latest.plan === 'monthly' ? latest.amount : 0,
      yearlyTotalAmount: latest === b ? 2000000 : latest.plan === 'yearly' ? latest.amount : 0,
    })),
    records: [a, b, old, external],
  });
  return ledger;
}
