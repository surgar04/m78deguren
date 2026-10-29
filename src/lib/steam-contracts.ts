import { z } from 'zod';
const integer = z.number().int().nonnegative();
const appId = z.number().int().positive().max(4_294_967_295);
const steamId = z.string().regex(/^\d{17}$/u);
export const steamAccountSchema = z
  .object({
    id: steamId,
    accountName: z.string().max(128),
    name: z.string().max(256),
    active: z.boolean(),
    mostRecent: z.boolean(),
    rememberPassword: z.boolean(),
    lastLogin: integer.nullable(),
  })
  .strict();
export const steamGameSchema = z
  .object({
    appId,
    name: z.string().max(1024),
    installed: z.boolean(),
    installComplete: z.boolean(),
    libraryId: z.string().nullable(),
    installPath: z.string().nullable(),
    sizeBytes: integer.nullable(),
    playtimeMinutes: integer.nullable(),
    lastPlayed: integer.nullable(),
    owned: z.boolean().nullable(),
    evidence: z.string(),
  })
  .strict();
export const steamLibrarySchema = z
  .object({
    id: z.string(),
    path: z.string(),
    available: z.boolean(),
    totalBytes: integer.nullable(),
    freeBytes: integer.nullable(),
    steamBytes: integer,
    games: integer,
  })
  .strict();
export const steamSnapshotSchema = z
  .object({
    installed: z.boolean(),
    path: z.string().nullable(),
    running: z.boolean(),
    currentAccount: steamId.nullable(),
    accounts: z.array(steamAccountSchema).max(128),
    libraries: z.array(steamLibrarySchema).max(64),
    games: z.array(steamGameSchema).max(60000),
    warnings: z.array(z.string()).max(30000),
    capturedAt: integer,
    revision: z.string(),
    inventorySource: z.string(),
    inventoryComplete: z.boolean(),
  })
  .strict();
const registry = z
  .object({ autoLogin: z.string().nullable(), remember: integer.nullable() })
  .strict();
export const steamBackupSchema = z
  .object({
    id: z.uuid(),
    kind: z.string(),
    account: steamId,
    createdAt: integer,
    steamPath: z.string(),
    beforeHash: z.string(),
    afterHash: z.string(),
    beforeRegistry: registry,
    afterRegistry: registry,
    state: z.enum(['prepared', 'failed', 'completed', 'restored']),
    message: z.string(),
  })
  .strict();
export const steamImageSchema = z
  .string()
  .max(2_800_000)
  .regex(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/u)
  .nullable();
export const steamRequestSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('snapshot'), refresh: z.boolean() }),
  z.object({
    operation: z.literal('image'),
    kind: z.enum(['game', 'avatar']),
    id: z.string().regex(/^\d{1,17}$/u),
  }),
  z.object({
    operation: z.literal('launch'),
    kind: z.enum(['client', 'run', 'install', 'uninstall']),
    appId: appId.nullable(),
    consent: z.literal(true),
  }),
  z.object({ operation: z.literal('open'), kind: z.enum(['store', 'folder']), appId }),
  z.object({
    operation: z.literal('account'),
    kind: z.enum(['switch', 'remove']),
    id: steamId,
    revision: z.string().regex(/^[a-f0-9]{64}$/u),
    consent: z.literal(true),
  }),
  z.object({ operation: z.literal('backups') }),
  z.object({ operation: z.literal('restore'), id: z.uuid(), consent: z.literal(true) }),
  z.object({
    operation: z.literal('public-sync'),
    consent: z.literal(true),
    apiKey: z
      .string()
      .regex(/^[a-fA-F0-9]{32}$/u)
      .nullable()
      .optional(),
  }),
]);
export type SteamRequest = z.infer<typeof steamRequestSchema>;
export type SteamGame = z.infer<typeof steamGameSchema>;
export type SteamAccount = z.infer<typeof steamAccountSchema>;
export type SteamSnapshot = z.infer<typeof steamSnapshotSchema>;
export type SteamBackup = z.infer<typeof steamBackupSchema>;
