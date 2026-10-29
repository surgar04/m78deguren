import { z } from 'zod';
import { optimizationSelectionsSchema, registryPreviewSchema } from './optimization-contracts.ts';

/** 新工具的边界契约：系统不可读的值必须保留 null，禁止用 0 冒充探测结果。 */
export const systemQuerySchema = z.enum([
  'apps',
  'gpus',
  'virtualization',
  'disks',
  'context',
  'vac',
  'displays',
  'nvidia',
  'dlss',
  'features-runtime',
  'features-boot',
]);
export type SystemQuery = z.infer<typeof systemQuerySchema>;
export const clickConfigSchema = z
  .object({
    button: z.enum(['left', 'right']),
    intervalMs: z.number().int().min(4).max(60_000),
    key: z
      .number()
      .int()
      .refine(
        (value) =>
          [4, 5, 6, 32].includes(value) ||
          (value >= 65 && value <= 90) ||
          (value >= 112 && value <= 123),
      ),
    control: z.boolean(),
    alt: z.boolean(),
    shift: z.boolean(),
  })
  .strict();
export type ClickConfig = z.infer<typeof clickConfigSchema>;
export const clickSnapshotSchema = z.object({
  config: clickConfigSchema,
  armed: z.boolean(),
  running: z.boolean(),
  clicks: z.number().int().nonnegative(),
  message: z.string(),
});
const targetId = z.string().regex(/^[a-f0-9]{64}$/u);
const drive = z.string().regex(/^[A-Z]:$/u);
export const eqConfigSchema = z
  .object({
    enabled: z.boolean(),
    preamp: z.number().finite().min(-24).max(12),
    headroom: z.boolean(),
    bands: z
      .array(
        z
          .object({
            frequency: z.number().finite().min(20).max(20000),
            gain: z.number().finite().min(-24).max(24),
          })
          .strict(),
      )
      .refine(
        (value) =>
          [5, 10, 15, 20, 31].includes(value.length) &&
          value.every(
            (band, index) => index === 0 || band.frequency > (value[index - 1]?.frequency ?? 0),
          ),
        '频段数不支持或频率未递增',
      ),
    effects: z
      .object({
        clarity: z.number().min(0).max(1),
        ambience: z.number().min(0).max(1),
        width: z.number().min(0).max(1),
        dynamics: z.number().min(0).max(1),
        bass: z.number().min(0).max(1),
      })
      .strict(),
  })
  .strict();
export type EqConfig = z.infer<typeof eqConfigSchema>;
export const audioPresetSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  config: eqConfigSchema,
});
export const deltaPasswordsSchema = z.object({
  source: z.string(),
  fetchedAt: z.number().int(),
  items: z.array(z.object({ name: z.string(), password: z.string().regex(/^\d{4}$/u) })),
});
export const filterLayerSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[a-z0-9-]+$/iu),
    name: z.string().min(1).max(40),
    enabled: z.boolean(),
    temperature: z.number().int().min(1000).max(12000),
    brightness: z.number().int().min(50).max(150),
    contrast: z.number().int().min(50).max(150),
    gamma: z.number().min(0.3).max(3),
    shadow: z.number().int().min(-50).max(50),
    red: z.number().min(0.3).max(3),
    green: z.number().min(0.3).max(3),
    blue: z.number().min(0.3).max(3),
  })
  .strict();
export const filterTargetSchema = z
  .object({
    monitor: targetId.nullable(),
    icc: targetId.nullable(),
    layers: z.array(filterLayerSchema).min(1).max(8),
  })
  .strict();
export const filterConfigSchema = z
  .object({
    targets: z.array(filterTargetSchema).min(1).max(16),
    saturation: z.number().int().min(0).max(200),
    autoGame: z.boolean(),
    rules: z
      .array(
        z
          .object({
            process: z
              .string()
              .min(1)
              .max(80)
              .regex(/^[^\\/:*?<>|"\p{Cc}]+\.exe$/iu),
            preset: z.string().min(1).max(80),
          })
          .strict(),
      )
      .max(20),
  })
  .strict();
export type FilterConfig = z.infer<typeof filterConfigSchema>;
export type FilterLayer = z.infer<typeof filterLayerSchema>;
export const filterSnapshotSchema = z.object({
  config: filterConfigSchema,
  presets: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      config: filterConfigSchema,
      builtin: z.boolean(),
    }),
  ),
  profiles: z.array(z.object({ id: targetId, name: z.string() })),
  enabled: z.boolean(),
  phase: z.enum(['idle', 'starting', 'active', 'waiting', 'restored', 'failed']),
  message: z.string(),
  activePreset: z.string().nullable(),
  previewRemaining: z.number().int().min(0).max(10),
  recoveryId: z.uuid().nullable(),
});
export const systemChangeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('optimization'), selections: optimizationSelectionsSchema }).strict(),
  z
    .object({
      kind: z.literal('gpu-rename'),
      id: targetId,
      name: z
        .string()
        .trim()
        .min(1)
        .max(80)
        .refine((value) => !/[\p{Cc}]/u.test(value)),
    })
    .strict(),
  z.object({ kind: z.literal('gpu-restart') }).strict(),
  z.object({ kind: z.literal('dlss-indicator'), enabled: z.boolean() }).strict(),
  z.object({ kind: z.literal('virtualization'), enabled: z.boolean() }).strict(),
  z.object({ kind: z.literal('context-toggle'), id: targetId, hidden: z.boolean() }).strict(),
  z.object({ kind: z.literal('namespace-toggle'), id: targetId, hidden: z.boolean() }).strict(),
  z.object({ kind: z.literal('drive-visibility'), letter: drive, hidden: z.boolean() }).strict(),
  z.object({ kind: z.literal('app-uninstall'), id: targetId }).strict(),
  z.object({ kind: z.literal('disk-optimize'), id: targetId, drive, trim: z.boolean() }).strict(),
  z.object({ kind: z.literal('vac-repair') }).strict(),
  z.object({ kind: z.literal('audio-driver'), install: z.boolean() }).strict(),
  z
    .object({
      kind: z.literal('nvidia'),
      scope: z.enum(['global', 'delta']),
      settings: z
        .array(
          z
            .object({
              id: z.number().int().min(0).max(0xffffffff),
              value: z.number().int().min(0).max(0xffffffff).nullable(),
            })
            .strict(),
        )
        .min(1)
        .max(45),
    })
    .strict(),
  z
    .object({
      kind: z.literal('feature'),
      store: z.union([z.literal(0), z.literal(1)]),
      id: z.number().int().min(1).max(0xffffffff),
      priority: z
        .number()
        .int()
        .min(0)
        .max(15)
        .refine((value) => ![0, 1, 3, 9, 15].includes(value)),
      state: z.number().int().min(0).max(2),
      variant: z.number().int().min(0).max(63),
      payloadKind: z.number().int().min(0).max(3),
      payload: z.number().int().min(0).max(0xffffffff),
      reset: z.boolean(),
    })
    .strict(),
  z.object({ kind: z.literal('restore'), id: z.uuid() }).strict(),
]);
export type SystemChange = z.infer<typeof systemChangeSchema>;
export const changePreviewSchema = z.object({
  token: z.uuid(),
  expiresInSeconds: z.number().int().positive(),
  preview: z.object({
    title: z.string(),
    summary: z.array(z.string()),
    requiresAdmin: z.boolean(),
    restartRequired: z.boolean(),
    reversible: z.boolean(),
    changes: z.array(registryPreviewSchema).max(1024).default([]),
  }),
});
export const changeReceiptSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  state: z.enum(['running', 'completed', 'cancelled', 'failed', 'unknown']),
  message: z.string(),
  restartRequired: z.boolean(),
  reversible: z.boolean(),
  createdAt: z.number().int().nonnegative(),
  domain: z.literal('optimization').optional(),
  itemIds: z.array(z.string().max(80)).max(201).default([]),
});
export const builtinRequestSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('query'), tool: systemQuerySchema }).strict(),
  z.object({ operation: z.literal('click-status') }).strict(),
  z
    .object({
      operation: z.literal('click-configure'),
      config: clickConfigSchema,
      enabled: z.boolean(),
      immediate: z.boolean(),
    })
    .strict(),
  z.object({ operation: z.literal('change-prepare'), change: systemChangeSchema }).strict(),
  z.object({ operation: z.literal('change-discard'), token: z.uuid() }).strict(),
  z
    .object({ operation: z.literal('change-apply'), token: z.uuid(), consent: z.literal(true) })
    .strict(),
  z.object({ operation: z.literal('change-history') }).strict(),
  z.object({ operation: z.literal('app-file'), id: targetId, reveal: z.boolean() }).strict(),
  z.object({ operation: z.literal('display-status') }).strict(),
  z.object({ operation: z.literal('display-history') }).strict(),
  z
    .object({ operation: z.literal('display-restore'), id: z.uuid(), consent: z.literal(true) })
    .strict(),
  z
    .object({
      operation: z.literal('display-switch'),
      target: z
        .object({
          id: targetId,
          width: z.number().int().min(320).max(16384),
          height: z.number().int().min(200).max(16384),
          refresh: z.number().int().min(20).max(1000),
        })
        .strict(),
      consent: z.literal(true),
    })
    .strict(),
  z.object({ operation: z.literal('display-decide'), id: z.uuid(), keep: z.boolean() }).strict(),
  z.object({ operation: z.literal('driver-history'), refresh: z.boolean() }).strict(),
  z.object({ operation: z.literal('driver-open'), id: z.string().regex(/^\d{1,12}$/u) }).strict(),
  z.object({ operation: z.literal('feature-dictionary-update') }).strict(),
  z.object({ operation: z.literal('audio-status') }).strict(),
  z.object({ operation: z.literal('audio-configure'), config: eqConfigSchema }).strict(),
  z
    .object({
      operation: z.literal('audio-start'),
      input: targetId,
      output: targetId,
      capture: z.boolean(),
      consent: z.literal(true),
    })
    .strict(),
  z.object({ operation: z.literal('audio-stop') }).strict(),
  z.object({ operation: z.literal('audio-driver-prepare') }).strict(),
  z.object({ operation: z.literal('audio-presets') }).strict(),
  z
    .object({
      operation: z.literal('audio-preset-save'),
      name: z.string().trim().min(1).max(80),
      config: eqConfigSchema,
    })
    .strict(),
  z.object({ operation: z.literal('audio-preset-remove'), id: z.uuid() }).strict(),
  z
    .object({ operation: z.literal('audio-preset-import'), content: z.string().max(262144) })
    .strict(),
  z
    .object({
      operation: z.literal('audio-preset-export'),
      name: z.string().trim().min(1).max(80),
      config: eqConfigSchema,
      fac: z.boolean(),
    })
    .strict(),
  z.object({ operation: z.literal('delta-passwords') }).strict(),
  z.object({ operation: z.literal('filter-status') }).strict(),
  z
    .object({
      operation: z.literal('filter-configure'),
      config: filterConfigSchema,
      enabled: z.boolean(),
      preview: z.boolean(),
      consent: z.boolean(),
    })
    .strict(),
  z.object({ operation: z.literal('filter-keep') }).strict(),
  z
    .object({
      operation: z.literal('filter-preset-save'),
      name: z.string().trim().min(1).max(80),
      config: filterConfigSchema,
    })
    .strict(),
  z.object({ operation: z.literal('filter-preset-remove'), id: z.uuid() }).strict(),
  z.object({ operation: z.literal('filter-import') }).strict(),
  z.object({ operation: z.literal('filter-profile-remove'), id: targetId }).strict(),
  z.object({ operation: z.literal('filter-export'), target: filterTargetSchema }).strict(),
  z
    .object({ operation: z.literal('filter-recover'), id: z.uuid(), consent: z.literal(true) })
    .strict(),
]);
export type BuiltinRequest = z.infer<typeof builtinRequestSchema>;
const opaqueId = z.string().regex(/^[a-f0-9]{64}$/u);
export const appsSnapshotSchema = z.object({
  apps: z.array(
    z.object({
      id: opaqueId,
      name: z.string(),
      version: z.string(),
      publisher: z.string(),
      installedOn: z.string(),
      bytes: z.number().nonnegative(),
      location: z.string(),
      uninstallable: z.boolean(),
    }),
  ),
});
export const gpuSnapshotSchema = z.object({
  admin: z.boolean(),
  gpus: z.array(
    z.object({
      id: opaqueId,
      name: z.string(),
      instance: z.string(),
      driver: z.string(),
      status: z.string(),
    }),
  ),
});
export const virtualizationSnapshotSchema = z.object({
  admin: z.boolean(),
  memoryIntegrity: z.number().nullable(),
  vbs: z.number().nullable(),
  hypervisorLaunch: z.string().nullable(),
  vbsRunning: z.number().nullable(),
  restartRequired: z.boolean(),
});
export const disksSnapshotSchema = z.object({
  admin: z.boolean(),
  disks: z.array(
    z.object({
      id: opaqueId,
      index: z.number().int().nonnegative(),
      name: z.string(),
      serial: z.string(),
      bytes: z.number().nonnegative(),
      interface: z.string(),
      firmware: z.string(),
      mediaType: z.string(),
      health: z.string().nullable(),
      temperature: z.number().nullable(),
      powerOnHours: z.number().nullable(),
      wear: z.number().nullable(),
      readErrors: z.number().nullable(),
      writeErrors: z.number().nullable(),
      volumes: z.array(
        z.object({
          drive: z.string(),
          label: z.string(),
          bytes: z.number().nonnegative(),
          freeBytes: z.number().nonnegative(),
        }),
      ),
    }),
  ),
});
export const contextSnapshotSchema = z.object({
  admin: z.boolean(),
  entries: z.array(
    z.object({
      id: opaqueId,
      name: z.string(),
      category: z.enum(['file', 'folder', 'desktop', 'drive', 'all-files']),
      source: z.string(),
      kind: z.string(),
      command: z.string(),
      hidden: z.boolean(),
    }),
  ),
  namespaces: z.array(
    z.object({ id: opaqueId, name: z.string(), hidden: z.boolean(), clsid: z.string() }),
  ),
  drives: z.array(
    z.object({ letter: drive, name: z.string(), hidden: z.boolean(), type: z.number().int() }),
  ),
});
export const vacSnapshotSchema = z.object({
  admin: z.boolean(),
  installed: z.boolean(),
  path: z.string().nullable(),
  serviceExists: z.boolean(),
  running: z.boolean(),
});
export const displaySnapshotSchema = z.object({
  monitors: z.array(
    z.object({
      id: opaqueId,
      device: z.string(),
      name: z.string(),
      primary: z.boolean(),
      width: z.number().int(),
      height: z.number().int(),
      refresh: z.number().int(),
      modes: z.array(
        z.object({ width: z.number().int(), height: z.number().int(), refresh: z.number().int() }),
      ),
    }),
  ),
});
export const displaySwitchSchema = z.object({
  id: z.uuid().nullable(),
  phase: z.enum(['idle', 'preparing', 'confirming', 'kept', 'restored', 'failed']),
  remaining: z.number().int().min(0).max(15),
  message: z.string(),
});
export const nvidiaSnapshotSchema = z.object({
  scope: z.enum(['global', 'delta']),
  indicator: z.number().int().nullable(),
  admin: z.boolean(),
  settings: z.array(
    z.object({
      id: z.number().int(),
      label: z.string(),
      group: z.string(),
      name: z.string(),
      current: z.number().int().nonnegative(),
      default: z.number().int().nonnegative(),
      location: z.number().int(),
      predefined: z.boolean(),
      supported: z.boolean(),
      reason: z.string(),
      values: z.array(z.number().int().nonnegative()),
    }),
  ),
});
export const displayHistorySchema = z.array(
  z.object({
    id: z.uuid(),
    monitor: targetId,
    width: z.number().int(),
    height: z.number().int(),
    refresh: z.number().int(),
    state: z.string(),
  }),
);
export const featuresSnapshotSchema = z.object({
  store: z.number().int(),
  stamp: z.string(),
  admin: z.boolean(),
  dictionary: z.record(z.string(), z.string()),
  features: z.array(
    z.object({
      id: z.number().int(),
      priority: z.number().int(),
      state: z.number().int(),
      variant: z.number().int(),
      payloadKind: z.number().int(),
      payload: z.number().int(),
      wexp: z.boolean(),
    }),
  ),
});
export const driverHistorySchema = z.object({
  updatedAt: z.number().int(),
  warnings: z.array(z.string()),
  drivers: z.array(
    z.object({
      id: z.string().regex(/^\d{1,12}$/u),
      version: z.string(),
      name: z.string(),
      date: z.string(),
      channel: z.enum(['desktop', 'laptop']),
      detailUrl: z.url(),
    }),
  ),
});
export const audioSnapshotSchema = z.object({
  config: eqConfigSchema,
  devices: z.array(
    z.object({
      id: targetId,
      name: z.string(),
      flow: z.enum(['loopback', 'capture']),
      virtualDevice: z.boolean(),
      defaultDevice: z.boolean(),
      sampleRate: z.number().int().positive(),
      channels: z.number().int().positive(),
    }),
  ),
  running: z.boolean(),
  underruns: z.number().int().nonnegative(),
  dropped: z.number().int().nonnegative(),
  peak: z.number().min(0).max(1),
  message: z.string(),
});
