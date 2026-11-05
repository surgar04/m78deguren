import { duesLedgerSchema } from '../../../lib/dues-contracts.ts';

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
