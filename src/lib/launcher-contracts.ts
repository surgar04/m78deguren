import { z } from 'zod';
export const regionSchema = z.enum(['cn', 'global', 'jp', 'kr', 'tw', 'unknown']);
export const otherGameSchema = z
  .object({
    id: z.uuid(),
    family: z.enum([
      'genshin',
      'honkai3',
      'starrail',
      'arknights',
      'endfield',
      'deltaforce',
      'nte',
      'wuthering',
    ]),
    name: z.string().max(120),
    region: regionSchema,
    evidence: z.array(z.string().max(1024)).max(32),
    path: z.string().max(4096),
    launcher: z.string().max(4096).nullable(),
    steamAppId: z.number().int().positive().nullable(),
    version: z.string().max(80),
    available: z.boolean(),
    detectedAt: z.number(),
  })
  .strict();
export type OtherGame = z.infer<typeof otherGameSchema>;
export const otherGamesSchema = z
  .object({
    games: z.array(otherGameSchema).max(128),
    scannedAt: z.number().nullable(),
    running: z.boolean(),
    mode: z.string().max(32),
    visited: z.number().nonnegative(),
    skipped: z.number().nonnegative(),
    complete: z.boolean(),
    message: z.string().max(4096),
    warnings: z.array(z.string().max(4096)).max(32),
    roots: z.array(z.string().max(4096)).max(64),
  })
  .strict();
export const gameProfileSchema = z
  .object({
    id: z.string().max(40),
    name: z.string().max(80),
    executables: z.array(z.string()),
    directories: z.array(z.string()),
    launchers: z.array(z.string()),
  })
  .strict();
export const gamesRequestSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('snapshot') }).strict(),
  z.object({ operation: z.literal('catalog') }).strict(),
  z.object({ operation: z.literal('scan'), deep: z.boolean() }).strict(),
  z.object({ operation: z.literal('cancel') }).strict(),
  z.object({ operation: z.literal('choose-root') }).strict(),
  z.object({ operation: z.literal('region'), id: z.uuid(), region: regionSchema }).strict(),
  z.object({ operation: z.literal('launch'), id: z.uuid() }).strict(),
  z.object({ operation: z.literal('open-folder'), id: z.uuid() }).strict(),
]);
export type GamesRequest = z.infer<typeof gamesRequestSchema>;
const toolId = z.enum([
  'crosshair',
  'overlay',
  'filter',
  'clicker',
  'media-previous',
  'media-next',
  'media-play-pause',
]);
const pageId = z.enum([
  'home',
  'library',
  'other-games',
  'hardware',
  'tools',
  'optimization',
  'settings',
]);
export const launchTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('shortcut'), id: z.uuid() }).strict(),
  z
    .object({ kind: z.literal('steam'), appId: z.number().int().positive().max(4294967295) })
    .strict(),
  z.object({ kind: z.literal('tool'), id: toolId }).strict(),
  z.object({ kind: z.literal('page'), id: pageId }).strict(),
  z
    .object({ kind: z.literal('tool-page'), id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/u) })
    .strict(),
]);
export type LaunchTarget = z.infer<typeof launchTargetSchema>;
export const CUSTOM_NAVIGATION_SLOTS = 6;
export const quickConfigSchema = z
  .object({
    navigation: z.array(launchTargetSchema.nullable()).length(CUSTOM_NAVIGATION_SLOTS),
    wheel: z
      .object({
        enabled: z.boolean(),
        triggerKey: z
          .string()
          .regex(/^[A-Z]$/u)
          .default('G'),
        holdMs: z.number().int().min(200).max(1500),
        size: z.number().int().min(300).max(640),
        opacity: z.number().min(0.35).max(1),
        desktopOnly: z.boolean(),
        position: z.enum(['cursor', 'center']),
        slots: z.array(launchTargetSchema.nullable()).length(8),
      })
      .strict(),
  })
  .strict();
export type QuickConfig = z.infer<typeof quickConfigSchema>;
export const launchOptionSchema = z
  .object({
    target: launchTargetSchema,
    label: z.string().max(256),
    group: z.string().max(32),
    available: z.boolean(),
    iconId: z.uuid().nullable(),
  })
  .strict();
export const quickSnapshotSchema = z
  .object({
    config: quickConfigSchema,
    revision: z.string().regex(/^[a-f0-9]{64}$/u),
    options: z.array(launchOptionSchema).max(40000),
    runtime: z
      .object({ ready: z.boolean(), visible: z.boolean(), message: z.string().max(4096) })
      .strict(),
  })
  .strict();
export type QuickSnapshot = z.infer<typeof quickSnapshotSchema>;
export const quickRequestSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('snapshot') }).strict(),
  z
    .object({
      operation: z.literal('save'),
      config: quickConfigSchema,
      revision: z.string().regex(/^[a-f0-9]{64}$/u),
    })
    .strict(),
  z
    .object({
      operation: z.literal('navigation'),
      index: z
        .number()
        .int()
        .min(0)
        .max(CUSTOM_NAVIGATION_SLOTS - 1),
    })
    .strict(),
  z.object({ operation: z.literal('preview') }).strict(),
]);
export type QuickRequest = z.infer<typeof quickRequestSchema>;
export const REGION_LABELS: Record<z.infer<typeof regionSchema>, string> = {
  cn: '国服',
  global: '国际服',
  jp: '国际服 · 日本',
  kr: '国际服 · 韩国',
  tw: '国际服 · 繁中',
  unknown: '区服待确认',
};
export const targetKey = (target: LaunchTarget | null) =>
  target ? `${target.kind}:${target.kind === 'steam' ? target.appId : target.id}` : '';
