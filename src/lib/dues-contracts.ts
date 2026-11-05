import { z } from 'zod';

/** 内置插件仍走唯一 IPC 网关；人数、金额、文本与操作对象均在双端验证。金额单位为分。 */
export const DUES_PLUGIN_ID = 'org.zhenjing.builtin.group-dues';
const wxid = z.string().min(1).max(128).regex(/^\S+$/u);
const cents = z.number().int().min(0).max(100_000_000);
const revision = z.number().int().nonnegative();
const month = z.string().regex(/^(20\d{2}|21\d{2})-(0[1-9]|1[0-2])$/u);
export const duesSettingsSchema = z.object({ monthlyCents: cents, annualCents: cents }).strict();
export const duesMemberSchema = z
  .object({
    wxid,
    nickname: z.string().max(512),
    groupNickname: z.string().max(512),
    avatarUrl: z.string().max(4096),
    active: z.boolean(),
    localNickname: z.string().max(512).nullable(),
    localGroupNickname: z.string().max(512).nullable(),
    remark: z.string().max(2000),
  })
  .strict();
export const duesPaymentSchema = z
  .object({
    id: z.uuid(),
    wxid,
    kind: z.enum(['monthly', 'annual', 'custom']),
    month,
    months: z.union([z.literal(1), z.literal(12)]),
    amountCents: cents.positive(),
    remark: z.string().max(2000),
    recordedAt: z.iso.datetime({ offset: true }),
    voidedAt: z.iso.datetime({ offset: true }).nullable(),
    voidReason: z.string().max(1000).nullable(),
  })
  .strict();
export const duesLedgerSchema = z
  .object({
    schemaVersion: z.literal(1),
    revision,
    groupName: z.string().max(512),
    syncedAt: z.iso.datetime({ offset: true }).nullable(),
    sourceUpdatedAt: z.string().max(512).nullable(),
    complete: z.boolean(),
    failedProfiles: z.number().int().nonnegative(),
    settings: duesSettingsSchema,
    members: z.array(duesMemberSchema).max(5000),
    payments: z.array(duesPaymentSchema).max(100000),
  })
  .strict();
export const duesRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('snapshot') }).strict(),
  z.object({ action: z.literal('sync'), revision }).strict(),
  z
    .object({ action: z.literal('settings'), revision, monthlyCents: cents, annualCents: cents })
    .strict(),
  z
    .object({
      action: z.literal('edit-member'),
      revision,
      wxid,
      nickname: z.string().max(512).nullable(),
      groupNickname: z.string().max(512).nullable(),
      remark: z.string().max(2000),
    })
    .strict(),
  z
    .object({
      action: z.literal('pay'),
      revision,
      wxids: z.array(wxid).min(1).max(500),
      month,
      kind: z.enum(['monthly', 'annual', 'custom']),
      amountCents: cents.positive().nullable(),
      remark: z.string().max(1000),
    })
    .strict(),
  z
    .object({
      action: z.literal('void'),
      revision,
      id: z.uuid(),
      reason: z.string().min(1).max(1000),
    })
    .strict(),
  z.object({ action: z.literal('avatar'), wxid }).strict(),
]);
export type DuesLedger = z.infer<typeof duesLedgerSchema>;
export type DuesMember = z.infer<typeof duesMemberSchema>;
export type DuesPayment = z.infer<typeof duesPaymentSchema>;
export type DuesRequest = z.infer<typeof duesRequestSchema>;
