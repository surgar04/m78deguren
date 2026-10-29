import { z } from 'zod';
import { hardwareFpsSchema } from './hardware-contracts.ts';

const text = z
  .string()
  .max(2048)
  .refine((value) => !/[\p{Cc}]/u.test(value));
const key = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9._-]+$/iu);
const color = z.string().regex(/^#[a-f0-9]{6}$/iu);
const finite = z.number().finite();
/** 与迁入的 C# HudProfile 对齐。导入对象是数据，绝不使用 eval 或 HTML 模板。 */
export const hudProfileSchema = z
  .object({
    id: key,
    isBuiltIn: z.boolean(),
    builtInKey: text,
    category: text,
    name: text,
    animationMode: z.enum(['Full', 'Simple']),
    taglineTemplate: text,
    titleTemplate: text,
    primaryTemplate: text,
    secondaryTemplate: text,
    rightTemplate: text,
    rightSuffix: text,
    progressVariable: text,
    progressMin: finite,
    progressMax: finite,
    leftIcon: text,
    rightIcon: text,
    accentColor: color,
    colorRules: z
      .array(
        z
          .object({
            variable: text,
            operator: z.enum(['>=', '<=', '>', '<', '==', '!=', '=']),
            value: finite,
            color,
          })
          .strict(),
      )
      .max(32),
    timeTargetEnabled: z.boolean(),
    timeTarget: text,
    timeUtcOffsetMinutes: z.number().int().min(-720).max(840).nullable(),
    gpuAdapterId: text,
    frameDisplayId: text,
    frameWindowId: text,
    frameFullScaleFps: finite,
    networkDisplayUnit: text,
    networkPercentMode: text,
    networkReferenceValue: finite,
    networkReferenceUnit: text,
    pingTarget: text,
    probeProtocol: z.enum(['ICMP', 'TCP', 'UDP']),
    probePort: z.number().int().min(1).max(65535),
  })
  .strict();
export const hudHttpSourceSchema = z
  .object({
    name: key,
    enabled: z.boolean(),
    url: z.url().max(4096),
    refreshSeconds: z.number().int().min(5).max(86400),
    headers: z.record(z.string().max(128), z.string().max(32768)),
    fields: z
      .array(z.object({ variable: key, jsonPath: text }).strict())
      .min(1)
      .max(64),
  })
  .strict();
export const hudConfigSchema = z
  .object({
    version: z.literal(1),
    enabled: z.boolean(),
    mode: z.enum(['auto', 'normal', 'game']),
    scale: finite.min(0.4).max(1.6),
    opacity: finite.min(0.15).max(1),
    monitor: z.number().int().min(0).max(31),
    position: z.enum([
      'top-left',
      'top-center',
      'top-right',
      'center-left',
      'center',
      'center-right',
      'bottom-left',
      'bottom-center',
      'bottom-right',
      'custom',
    ]),
    x: finite.min(-32768).max(32768),
    y: finite.min(-32768).max(32768),
    locked: z.boolean(),
    layer: z.enum(['topmost', 'desktop']),
    alwaysShow: z.boolean(),
    hotzone: z.boolean(),
    powerEvents: z.boolean(),
    displaySeconds: z.number().int().min(3).max(30),
    cycleSeconds: z.number().int().min(3).max(120),
    animation: z.enum(['full', 'simple', 'roll']),
    bounce: finite.min(0).max(0.5),
    ripple: finite.min(0).max(2),
    spread: finite.min(0.5).max(1.5),
    fontScale: finite.min(0.7).max(1.5),
    reducedMotion: z.boolean(),
    samplingMs: z.number().int().min(500).max(60000),
    frames: z.boolean(),
    activeProfile: key,
    queue: z.array(key).max(128),
    profiles: z.array(hudProfileSchema).min(1).max(128),
    deepseekKey: z.string().max(32768),
    httpSources: z.array(hudHttpSourceSchema).max(16),
    includeProcesses: z.array(key).max(128),
    excludeProcesses: z.array(key).max(128),
    autoCycle: z.boolean().default(true),
    clickToCycle: z.boolean().default(true),
    triggers: z
      .array(
        z
          .object({
            id: key,
            enabled: z.boolean(),
            name: text,
            variable: key,
            mode: z.enum(['Threshold', 'Change', 'BecomesTrue']),
            operator: z.enum(['>=', '>', '<=', '<', '==', '!=']),
            value: finite,
            cooldownSeconds: z.number().int().min(1).max(86400),
          })
          .strict(),
      )
      .max(64)
      .default([]),
  })
  .strict()
  .refine((config) => {
    const ids = new Set(config.profiles.map((p) => p.id));
    return (
      ids.size === config.profiles.length &&
      ids.has(config.activeProfile) &&
      config.queue.every((id) => ids.has(id))
    );
  }, '当前方案和轮播项必须存在，方案标识不能重复');
export type HudConfig = z.infer<typeof hudConfigSchema>;
export type HudProfile = z.infer<typeof hudProfileSchema>;
export const hudRenderSchema = z
  .object({
    tagline: text,
    title: text,
    primaryText: text,
    secondaryText: text,
    rightText: text,
    rightSuffix: text,
    progress: finite.min(0).max(1),
    leftIcon: text,
    rightIcon: text,
    accentColor: color,
    simpleAnimation: z.boolean(),
    progressAvailable: z.boolean().optional(),
  })
  .strict();
const media = z
  .object({
    available: z.boolean(),
    title: text,
    artist: text,
    source: text,
    status: text,
    error: z.string().nullable(),
    positionSeconds: finite.min(0).max(10000000).nullable().optional(),
    durationSeconds: finite.min(0).max(10000000).nullable().optional(),
    album: z.string().max(2048).optional(),
  })
  .strict();
export const hudLiveSchema = z
  .object({
    scene: z.string().max(128).optional(),
    game: z.boolean().optional(),
    gameInfo: z
      .object({
        processId: z.number().int().nonnegative(),
        name: text.nullable().optional(),
        reason: text.nullable().optional(),
        capturedAt: finite.optional(),
      })
      .strict()
      .optional(),
    metrics: z.record(z.string().max(80), finite.nullable()).optional(),
    fps: hardwareFpsSchema.optional(),
    media: media.optional(),
    downloads: z
      .array(
        z
          .object({
            id: z.string(),
            name: text,
            downloaded: z.number().nonnegative(),
            total: z.number().nonnegative().nullable(),
            status: text,
          })
          .strict(),
      )
      .max(8)
      .optional(),
    render: hudRenderSchema.nullable().optional(),
    capturedAt: finite.optional(),
    missing: z.array(text).nullable().optional(),
    error: z.string().nullable().optional(),
    transition: z.enum(['full', 'simple', 'roll']).optional(),
  })
  .strict();
export type HudLive = z.infer<typeof hudLiveSchema>;
export type HudRender = z.infer<typeof hudRenderSchema>;
export const hudSnapshotSchema = z
  .object({ config: hudConfigSchema, live: hudLiveSchema })
  .strict();
export type HudSnapshot = z.infer<typeof hudSnapshotSchema>;
export const hudRequestSchema = z.discriminatedUnion('operation', [
  z
    .object({
      operation: z.enum([
        'snapshot',
        'toggle',
        'next',
        'drag',
        'remember',
        'displays',
        'open-settings',
        'import',
        'export',
        'catalog',
      ]),
    })
    .strict(),
  z.object({ operation: z.literal('configure'), config: hudConfigSchema }).strict(),
  z
    .object({ operation: z.literal('media'), action: z.enum(['previous', 'play-pause', 'next']) })
    .strict(),
  z
    .object({
      operation: z.literal('locale'),
      locale: z.enum(['zh-CN', 'zh-TW', 'en', 'ja', 'de', 'fr']),
    })
    .strict(),
]);
export type HudRequest = z.infer<typeof hudRequestSchema>;
export const hudDisplaysSchema = z
  .array(
    z
      .object({
        id: z.number().int(),
        name: z.string().nullable(),
        width: finite,
        height: finite,
        scale: finite,
      })
      .strict(),
  )
  .max(32);
const variable = z.object({
  key: text,
  name: text,
  category: text,
  description: z.string().max(4096),
  valueType: text,
  unit: text,
  recommendedUse: text,
  recommendedFormats: text,
  templateToken: text,
});
const target = z.object({ id: z.string().max(256), name: z.string().max(2048) }).strict();
export const hudCatalogSchema = z.object({
  catalog: z
    .object({
      profiles: z.array(hudProfileSchema),
      variables: z.array(variable).max(8192),
      timeZones: z.array(z.object({ minutes: finite, zh: text, en: text })),
      gpus: z.array(target).max(32),
      frameWindows: z.array(target).max(4096),
      frameDisplays: z.array(target).max(32),
    })
    .nullable(),
  variables: z.record(z.string(), z.json()).nullable(),
});
