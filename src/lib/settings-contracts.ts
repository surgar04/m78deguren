import { z } from 'zod';
import { localWindowsPathSchema } from './local-path.ts';

export const hotkeyActionSchema = z.enum([
  'overlay',
  'crosshair',
  'filter',
  'clicker',
  'previous',
  'next',
  'play-pause',
]);
export const bindingSchema = z
  .object({ action: hotkeyActionSchema, enabled: z.boolean(), shortcut: z.string().min(1).max(64) })
  .strict();
export const serverSchema = z
  .object({
    id: z.string().min(1).max(80),
    name: z.string().min(1).max(100),
    url: z.url().max(4096),
    custom: z.boolean(),
  })
  .strict();
export const nativeSettingsSchema = z
  .object({
    version: z.literal(1),
    minimizedStart: z.boolean(),
    autoUpdate: z.boolean(),
    confirmActions: z.boolean().default(true),
    checkUpdates: z.boolean().default(true),
    updateReminders: z.boolean().default(true),
    closeBehavior: z.enum(['exit', 'tray']),
    hotkeysEnabled: z.boolean(),
    mediaKeys: z.boolean(),
    bindings: z
      .array(bindingSchema)
      .length(7)
      .refine((rows) => new Set(rows.map((row) => row.action)).size === 7),
    servers: z.array(serverSchema).max(30),
  })
  .strict();
export const assetSchema = z
  .object({
    id: z.string().regex(/^[a-f0-9]{64}$/u),
    name: z.string().max(120),
    kind: z.enum(['image', 'logo', 'video', 'font']),
    mime: z.string().max(100),
    extension: z.enum(['png', 'jpg', 'webp', 'mp4', 'webm', 'ttf', 'otf']),
    bytes: z.number().int().positive().max(536_870_912),
  })
  .strict();
export const nativePatchSchema = z.discriminatedUnion('kind', [
  z
    .object({ kind: z.literal('close-behavior'), value: nativeSettingsSchema.shape.closeBehavior })
    .strict(),
  z
    .object({
      kind: z.enum([
        'minimized-start',
        'auto-update',
        'confirm-actions',
        'check-updates',
        'update-reminders',
        'hotkeys-enabled',
        'media-keys',
      ]),
      value: z.boolean(),
    })
    .strict(),
  z.object({ kind: z.literal('binding'), binding: bindingSchema }).strict(),
  z
    .object({
      kind: z.literal('server-add'),
      name: z.string().trim().max(60),
      url: z.url().max(4096),
    })
    .strict(),
  z.object({ kind: z.literal('server-remove'), id: z.uuid() }).strict(),
]);
export const settingsRequestSchema = z.discriminatedUnion('operation', [
  z
    .object({
      operation: z.enum([
        'snapshot',
        'runtime',
        'footprint',
        'network-sites',
        'update-status',
        'update-check',
        'update-download',
        'update-open-release',
        'pawn-status',
        'pawn-prepare',
        'reset-prepare',
        'reset-backups',
        'island-status',
        'restore-main',
        'hotkey-capture-start',
        'boot-ready',
      ]),
    })
    .strict(),
  z.object({ operation: z.literal('patch'), patch: nativePatchSchema }).strict(),
  z.object({ operation: z.literal('asset-import'), kind: assetSchema.shape.kind }).strict(),
  z.object({ operation: z.literal('asset-remove'), id: assetSchema.shape.id }).strict(),
  z
    .object({
      operation: z.literal('network-test'),
      ids: z.array(z.string().min(1).max(80)).min(1).max(40),
    })
    .strict(),
  z.object({ operation: z.literal('hotkey-capture-end'), token: z.uuid() }).strict(),
  z
    .object({
      operation: z.literal('autostart-set'),
      enabled: z.boolean(),
      consent: z.literal(true),
    })
    .strict(),
  z
    .object({ operation: z.literal('autostart-restore'), id: z.uuid(), consent: z.literal(true) })
    .strict(),
  z.object({ operation: z.literal('autostart-history') }).strict(),
  z
    .object({
      operation: z.literal('filter-rules'),
      rules: z
        .array(
          z
            .object({ process: z.string().min(1).max(100), preset: z.string().min(1).max(80) })
            .strict(),
        )
        .max(20),
      autoGame: z.boolean(),
    })
    .strict(),
  z.object({ operation: z.literal('cache-clear'), consent: z.literal(true) }).strict(),
  z
    .object({
      operation: z.literal('reset-apply'),
      token: z.uuid(),
      confirmation: z.literal('RESET'),
      consent: z.literal(true),
    })
    .strict(),
  z.object({ operation: z.literal('reset-restore-prepare'), id: z.uuid() }).strict(),
  z
    .object({
      operation: z.literal('reset-restore-apply'),
      token: z.uuid(),
      consent: z.literal(true),
    })
    .strict(),
  z
    .object({ operation: z.literal('update-apply'), token: z.uuid(), consent: z.literal(true) })
    .strict(),
  z
    .object({
      operation: z.literal('pawn-apply'),
      token: z.uuid(),
      install: z.boolean(),
      consent: z.literal(true),
    })
    .strict(),
  z
    .object({
      operation: z.literal('media-control'),
      action: z.enum(['previous', 'next', 'play-pause']),
    })
    .strict(),
]);
export const settingsSnapshotSchema = z
  .object({
    config: nativeSettingsSchema,
    assets: z.array(assetSchema).max(48),
    version: z.string().max(60),
    author: z.string().max(100),
    repository: z.literal('https://github.com/surgar04/m78deguren'),
    changelog: z.string().max(100_000),
    dataRoot: localWindowsPathSchema,
    startedAt: z.number().nonnegative(),
    warnings: z.array(z.string()),
  })
  .strict();
export const runtimeSettingsSchema = z
  .object({
    autostart: z
      .object({ enabled: z.boolean(), matches: z.boolean(), error: z.string().nullable() })
      .strict(),
    hotkeys: z
      .array(
        z
          .object({
            action: z.string(),
            shortcut: z.string(),
            registered: z.boolean(),
            error: z.string().nullable(),
          })
          .strict(),
      )
      .max(32),
    hudVisible: z.boolean(),
    captureActive: z.boolean(),
    critical: z.boolean(),
  })
  .strict();
export const footprintSchema = z
  .object({
    dataRoot: z.string(),
    dataBytes: z.number().nonnegative(),
    cacheBytes: z.number().nonnegative(),
    files: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    checkedAt: z.number().nonnegative(),
  })
  .strict();
export const cacheReceiptSchema = z
  .object({
    removedBytes: z.number().nonnegative(),
    removedFiles: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
  })
  .strict();
export const latencySchema = z
  .object({
    id: z.string(),
    measuredAt: z.number().nonnegative(),
    elapsedMs: z.number().nonnegative().nullable(),
    httpStatus: z.number().int().nullable(),
    error: z.string().nullable(),
  })
  .strict();
export const pawnStatusSchema = z
  .object({
    installed: z.boolean(),
    version: z.string().nullable(),
    service: z.string(),
    error: z.string().nullable(),
  })
  .strict();
export const pawnPreparedSchema = z
  .object({
    token: z.uuid(),
    expiresInSeconds: z.number().positive(),
    version: z.string(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/iu),
    publisher: z.string(),
    installed: z.boolean(),
  })
  .strict();
export const maintenancePreviewSchema = z
  .object({
    token: z.uuid(),
    expiresInSeconds: z.number().positive(),
    dataRoot: z.string(),
    backupRoot: z.string(),
    bytes: z.number().nonnegative(),
    restore: z.boolean(),
  })
  .strict();
export const resetBackupSchema = z
  .object({
    id: z.uuid(),
    createdAt: z.number().nonnegative(),
    path: z.string(),
    dataRoot: z.string(),
    state: z.string(),
    message: z.string(),
  })
  .strict();
export const updateStatusSchema = z
  .object({
    phase: z.enum([
      'idle',
      'checking',
      'no-release',
      'up-to-date',
      'available',
      'unverified',
      'downloading',
      'ready',
      'error',
    ]),
    currentVersion: z.string(),
    latestVersion: z.string().nullable(),
    message: z.string(),
    changelog: z.string(),
    downloaded: z.number().nonnegative(),
    total: z.number().nonnegative().nullable(),
    checkedAt: z.number().nonnegative().nullable(),
    token: z.uuid().nullable(),
    sha256: z.string().nullable(),
    releaseUrl: z.string().nullable(),
  })
  .strict();
export const mediaSnapshotSchema = z
  .object({
    available: z.boolean(),
    title: z.string(),
    artist: z.string(),
    source: z.string(),
    status: z.string(),
    error: z.string().nullable(),
    album: z.string().max(4096).default(''),
    positionSeconds: z.number().finite().min(0).max(10000000).nullable().default(null),
    durationSeconds: z.number().finite().min(0).max(10000000).nullable().default(null),
  })
  .strict();
export type SettingsRequest = z.infer<typeof settingsRequestSchema>;
export type NativeSettings = z.infer<typeof nativeSettingsSchema>;
export type NativePatch = z.infer<typeof nativePatchSchema>;
export type SettingsAsset = z.infer<typeof assetSchema>;
export type HotkeyAction = z.infer<typeof hotkeyActionSchema>;
