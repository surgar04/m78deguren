import { z } from 'zod';
const id = z.uuid();
const name = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .refine((value) => !/[\p{Cc}]/u.test(value));
export const homePolicySchema = z
  .object({ autoGameMode: z.boolean(), disableWinInGame: z.boolean() })
  .strict();
export const shortcutSchema = z
  .object({
    id,
    name,
    path: z.string().max(4096),
    isGame: z.boolean(),
    lastLaunched: z.number().int().nonnegative().nullable(),
    managedGame: z.boolean().default(false),
  })
  .strict();
export const homeRuntimeSchema = z
  .object({
    ready: z.boolean(),
    manual: z.boolean(),
    effective: z.boolean(),
    gameRunning: z.boolean(),
    winKeyBlocked: z.boolean(),
    suppressedCount: z.number().int().nonnegative(),
    recoverableCount: z.number().int().nonnegative(),
    message: z.string().max(4096),
  })
  .strict();
export const homeSnapshotSchema = z
  .object({
    username: z.string().min(1).max(60),
    revision: z.string().regex(/^[a-f0-9]{64}$/u),
    policy: homePolicySchema,
    shortcuts: z.array(shortcutSchema).max(128),
    runtime: homeRuntimeSchema,
  })
  .strict();
const icon = z.string().startsWith('data:image/png;base64,').max(524288).nullable();
export const homeDraftSchema = z
  .object({ ticket: id, name, path: z.string().max(4096), icon })
  .strict();
export const homeContentSchema = z
  .object({
    title: z.string().max(200),
    text: z.string().max(24000),
    author: z.string().max(1024),
    source: z.string().max(1024),
    url: z.url().nullable(),
    fetchedAt: z.number().int().nonnegative(),
    cached: z.boolean(),
  })
  .strict();
export const homePictureSchema = z
  .object({
    id: z.string().regex(/^\d{1,12}$/u),
    author: z.string().max(1024),
    source: z.string().max(1024),
    data: z.string().startsWith('data:image/jpeg;base64,').max(4194304),
    fetchedAt: z.number().int().nonnegative(),
  })
  .strict();
const revision = z.string().regex(/^[a-f0-9]{64}$/u);
export const homeRequestSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('snapshot') }).strict(),
  z.object({ operation: z.literal('choose') }).strict(),
  z
    .object({ operation: z.literal('add'), ticket: id, name, isGame: z.boolean(), revision })
    .strict(),
  z.object({ operation: z.literal('remove'), id, revision, consent: z.literal(true) }).strict(),
  z
    .object({
      operation: z.literal('reorder'),
      ids: z
        .array(id)
        .max(128)
        .refine((ids) => new Set(ids).size === ids.length),
      revision,
    })
    .strict(),
  z.object({ operation: z.literal('launch'), id, consent: z.literal(true) }).strict(),
  z.object({ operation: z.literal('icon'), id }).strict(),
  z
    .object({
      operation: z.literal('policy'),
      key: z.enum(['autoGameMode', 'disableWinInGame']),
      enabled: z.boolean(),
      consent: z.literal(true),
    })
    .strict(),
  z
    .object({ operation: z.literal('manual'), enabled: z.boolean(), consent: z.literal(true) })
    .strict(),
  z.object({ operation: z.literal('restore'), consent: z.literal(true) }).strict(),
  z
    .object({
      operation: z.literal('content'),
      kind: z.enum(['quote', 'announcement']),
      refresh: z.boolean(),
    })
    .strict(),
  z.object({ operation: z.literal('picture'), refresh: z.boolean() }).strict(),
  z.object({ operation: z.literal('picture-save'), id: z.string().regex(/^\d{1,12}$/u) }).strict(),
  z
    .object({ operation: z.literal('picture-wallpaper'), id: z.string().regex(/^\d{1,12}$/u) })
    .strict(),
  z.object({ operation: z.literal('open'), kind: z.literal('feedback') }).strict(),
]);
export type HomeRequest = z.infer<typeof homeRequestSchema>;
export type HomeSnapshot = z.infer<typeof homeSnapshotSchema>;
export type HomePolicy = z.infer<typeof homePolicySchema>;
export type HomeShortcut = z.infer<typeof shortcutSchema>;
export type HomeDraft = z.infer<typeof homeDraftSchema>;
