import { z } from 'zod';
import { TOOL_ICON_IDS } from '../features/tools/types.ts';

/** IPC契约集中定义，输入先在TS验证，Rust枚举和服务再验证一次。 */
const id = z.string().min(1).max(128);
const filename = z
  .string()
  .min(1)
  .max(120)
  .refine((s) => !/[<>:"/\\|?*\p{Cc}]/u.test(s) && !/[. ]$/u.test(s), '文件名包含不允许的字符');
const color = z.string().regex(/^#[\da-f]{6}$/iu);
export const crosshairConfigSchema = z
  .object({
    shape: z.enum(['cross', 'dot', 'circle', 'cross-dot', 'cross-circle', 'dot-box', 'image']),
    color,
    size: z.number().finite().min(4).max(200),
    thickness: z.number().finite().min(1).max(20),
    gap: z.number().finite().min(0).max(100),
    opacity: z.number().finite().min(0.05).max(1),
    outline: z.number().finite().min(0).max(8),
    outlineColor: color.default('#10232c'),
    centerDot: z.boolean(),
    offsetX: z.number().int().min(-4096).max(4096),
    offsetY: z.number().int().min(-4096).max(4096),
    monitor: z.number().int().min(0).max(63),
    image: z.string().max(1_400_000).nullable(),
    shortcut: z.string().max(64),
    hold: z.boolean(),
    holdKey: z.enum(['left', 'right', 'middle', 'x1', 'x2', 'shift', 'control', 'alt']),
    holdDelayMs: z.number().int().min(0).max(2000),
  })
  .strict();
export type CrosshairConfig = z.infer<typeof crosshairConfigSchema>;
export const crosshairSnapshotSchema = z.object({
  config: crosshairConfigSchema,
  enabled: z.boolean(),
  message: z.string(),
  presets: z.array(z.object({ id, name: z.string(), config: crosshairConfigSchema })).max(30),
});
export const SCREEN_PATTERNS = [
  { id: 'pixels', name: '坏点测试' },
  { id: 'gradient', name: '渐变测试' },
  { id: 'response', name: '响应测试' },
  { id: 'refresh', name: '刷新率测试' },
  { id: 'uniformity', name: '均匀性' },
  { id: 'tearing', name: '撕裂测试' },
  { id: 'subpixel', name: '子像素' },
  { id: 'black', name: '黑阶' },
  { id: 'gray', name: '灰阶' },
  { id: 'text', name: '文本清晰度' },
  { id: 'geometry', name: '几何形状' },
  { id: 'viewing', name: '视角测试' },
] as const;
export const screenConfigSchema = z
  .object({
    pattern: z.enum([
      'pixels',
      'gradient',
      'response',
      'refresh',
      'uniformity',
      'tearing',
      'subpixel',
      'black',
      'gray',
      'text',
      'geometry',
      'viewing',
    ]),
    monitor: z.number().int().min(0).max(63),
    color,
    speed: z.number().finite().min(0.1).max(5),
  })
  .strict();
export type ScreenConfig = z.infer<typeof screenConfigSchema>;
export const displaysSchema = z.array(
  z.object({
    index: z.number().int().nonnegative(),
    name: z.string(),
    width: z.number().positive(),
    height: z.number().positive(),
    x: z.number(),
    y: z.number(),
    scale: z.number().positive(),
  }),
);
export const downloadInputSchema = z
  .object({
    url: z
      .url()
      .max(4096)
      .refine((v) => /^https?:\/\//iu.test(v), '仅支持HTTP/HTTPS链接'),
    fileName: filename,
    connections: z.number().int().min(1).max(8),
    limitKib: z.number().int().min(0).max(1_048_576),
    expectedSha256: z
      .string()
      .regex(/^[\da-f]{64}$/iu)
      .nullable(),
  })
  .strict();
export type DownloadInput = z.infer<typeof downloadInputSchema>;
export const downloadsSchema = z.array(
  z.object({
    id,
    url: z.string(),
    fileName: z.string(),
    status: z.enum([
      'paused',
      'probing',
      'running',
      'pausing',
      'cancelling',
      'cancelled',
      'complete',
      'failed',
    ]),
    total: z.number().nonnegative().nullable(),
    downloaded: z.number().nonnegative(),
    bytesPerSecond: z.number().finite().nonnegative(),
    connections: z.number().int(),
    limitKib: z.number().nonnegative(),
    sha256: z.string().nullable(),
    expectedSha256: z.string().nullable(),
    message: z.string(),
    etag: z.string().nullable(),
    modified: z.string().nullable(),
  }),
);
export const downloadSettingsSchema = z.object({
  limitKib: z.number().int().min(0).max(1_048_576),
});
export type DownloadTask = z.infer<typeof downloadsSchema>[number];
export const recordingSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/),
  rootId: id,
  name: z.string(),
  bytes: z.number().nonnegative(),
  modifiedMs: z.number().nonnegative(),
  relativePath: z.string(),
});
export type Recording = z.infer<typeof recordingSchema>;
export const recordingsSchema = z.object({
  roots: z.array(z.object({ id, path: z.string() })),
  files: z.array(recordingSchema),
  removed: z.array(z.object({ id, name: z.string(), original: z.string(), stored: z.string() })),
  truncated: z.boolean(),
});
export const speedSchema = z.object({
  node: z.string(),
  connections: z.number().int().nonnegative(),
  jitterMs: z.number().finite().nonnegative().nullable(),
  failurePercent: z.number().min(0).max(100).nullable(),
  series: z.array(
    z.object({
      seconds: z.number().finite().nonnegative(),
      mbps: z.number().finite().nonnegative(),
      phase: z.string(),
    }),
  ),
  running: z.boolean(),
  phase: z.string(),
  latencyMs: z.number().finite().nullable(),
  downloadMbps: z.number().finite().nonnegative().nullable(),
  uploadMbps: z.number().finite().nonnegative().nullable(),
  transferred: z.number().nonnegative(),
  message: z.string(),
  capturedAt: z.number().nullable(),
});
export const ntpServersSchema = z.array(z.object({ id, name: z.string(), host: z.string() }));
export const ntpResultSchema = z.object({
  token: id,
  server: z.string(),
  localTimeMs: z.number().finite(),
  serverTimeMs: z.number().finite(),
  offsetMs: z.number().finite(),
  delayMs: z.number().finite().nonnegative(),
  stratum: z.number().int().min(1).max(15),
});
export const runtimesSchema = z.object({
  components: z.array(
    z.object({
      id,
      name: z.string(),
      installed: z.boolean(),
      version: z.string(),
      complete: z.boolean(),
    }),
  ),
  admin: z.boolean(),
  operatingSystem: z.string(),
});
export const runtimeJobSchema = z.object({
  phase: z.string(),
  packageId: z.string(),
  name: z.string(),
  message: z.string(),
  downloadId: z.string().nullable(),
  token: z.string().nullable(),
  sha256: z.string().nullable(),
  publisher: z.string().nullable(),
  bytes: z.number().nullable(),
  exitCode: z.number().nullable(),
  restartRequired: z.boolean(),
});
const crashEventSchema = z.object({
  id: z.number().int(),
  time: z.string(),
  provider: z.string(),
  message: z.string(),
  data: z.record(z.string(), z.string()),
});
export const crashesSchema = z.object({
  events: z.array(crashEventSchema),
  dumps: z.array(
    z.object({
      id: z.string().regex(/^[a-f0-9]{64}$/u),
      name: z.string(),
      path: z.string(),
      bytes: z.number().nonnegative(),
      modified: z.string(),
      header: z.object({
        format: z.string(),
        codeKind: z.string(),
        code: z.number().int().nullable(),
        parameters: z.array(z.string()),
        exceptionAddress: z.string().nullable(),
        architecture: z.string().nullable(),
        osVersion: z.string().nullable(),
        processors: z.number().int().nullable(),
        note: z.string(),
      }),
    }),
  ),
  admin: z.boolean(),
  capturedAt: z.number().finite(),
  system: z.object({
    name: z.string(),
    version: z.string(),
    lastBoot: z.string(),
    dumpMode: z.number().nullable(),
    autoReboot: z.number().nullable(),
    dumpFile: z.string(),
    minidumpDirectory: z.string(),
  }),
  timeline: z.array(
    z.object({
      time: z.string(),
      code: z.number().nullable(),
      name: z.string().nullable(),
      source: z.string(),
      eventId: z.number().nullable(),
      kind: z.enum(['bugcheck', 'unexpected-shutdown']),
      related: z.array(z.number().int().nonnegative()),
    }),
  ),
  findings: z.array(
    z.object({
      title: z.string(),
      confidence: z.string(),
      evidence: z.string(),
      suggestion: z.string(),
      events: z.array(z.number().int().nonnegative()),
    }),
  ),
});
export const externalSchema = z.array(
  z.object({ id, name: z.string(), description: z.string(), website: z.url() }),
);
export const catalogSchema = z.object({
  source: z.literal('native'),
  tools: z.array(
    z.object({
      id,
      name: z.string(),
      description: z.string(),
      aliases: z.array(z.string()),
      category: z.enum(['gaming', 'network', 'maintenance']),
      icon: z.enum(TOOL_ICON_IDS),
      tone: z.enum(['mint', 'blue', 'violet', 'orange', 'rose']),
      origin: z.enum(['builtin', 'third-party']),
      details: z.array(z.string()),
    }),
  ),
  external: z.object({
    id,
    name: z.string(),
    description: z.string(),
    aliases: z.array(z.string()),
    category: z.enum(['gaming', 'network', 'maintenance']),
    icon: z.enum(TOOL_ICON_IDS),
    tone: z.enum(['mint', 'blue', 'violet', 'orange', 'rose']),
    origin: z.literal('third-party'),
    details: z.array(z.string()),
  }),
});
const read = <T extends string>(operation: T) =>
  z.object({ operation: z.literal(operation) }).strict();
export const toolRequestSchema = z.discriminatedUnion('operation', [
  read('catalog'),
  read('displays'),
  read('crosshair-status'),
  read('crosshair-ready'),
  z
    .object({
      operation: z.literal('crosshair-update'),
      config: crosshairConfigSchema,
      enabled: z.boolean(),
    })
    .strict(),
  z
    .object({
      operation: z.literal('crosshair-preset'),
      action: z.enum(['save', 'remove']),
      id: id.optional(),
      name: z.string().min(1).max(40).optional(),
    })
    .strict(),
  z.object({ operation: z.literal('screen-open'), config: screenConfigSchema }).strict(),
  read('screen-status'),
  z.object({ operation: z.literal('screen-update'), config: screenConfigSchema }).strict(),
  read('screen-close'),
  read('downloads-list'),
  read('downloads-settings'),
  z
    .object({
      operation: z.literal('download-limit'),
      limitKib: z.number().int().min(0).max(1_048_576),
    })
    .strict(),
  z.object({ operation: z.literal('download-create'), input: downloadInputSchema }).strict(),
  z
    .object({
      operation: z.literal('download-action'),
      id,
      action: z.enum(['pause', 'resume', 'cancel', 'remove']),
    })
    .strict(),
  z
    .object({
      operation: z.literal('download-file'),
      id,
      action: z.enum(['open', 'reveal', 'copy']),
    })
    .strict(),
  read('recording-scan'),
  read('recording-discover'),
  z
    .object({
      operation: z.literal('recording-batch'),
      ids: z.array(id).min(1).max(100),
      action: z.enum(['copy', 'remove']),
      consent: z.literal(true),
    })
    .strict(),
  z.object({ operation: z.literal('recording-purge'), id, consent: z.literal(true) }).strict(),
  read('recording-add'),
  z.object({ operation: z.literal('recording-root-remove'), id }).strict(),
  z.object({ operation: z.literal('recording-rename'), id, name: filename }).strict(),
  z.object({ operation: z.literal('recording-remove'), id }).strict(),
  z.object({ operation: z.literal('recording-restore'), id }).strict(),
  z
    .object({
      operation: z.literal('recording-file'),
      id,
      action: z.enum(['open', 'reveal', 'copy']),
    })
    .strict(),
  read('speed-status'),
  z
    .object({
      operation: z.literal('speed-start'),
      node: z.enum(['cloudflare', 'nuaa', 'zju', 'ustc']).optional(),
      connections: z.union([z.literal(1), z.literal(4), z.literal(8)]).optional(),
    })
    .strict(),
  read('speed-stop'),
  read('ntp-servers'),
  z
    .object({
      operation: z.literal('ntp-query'),
      server: z.enum(['aliyun', 'tencent', 'neu', 'pool', 'apple', 'microsoft']),
    })
    .strict(),
  z.object({ operation: z.literal('ntp-apply'), token: id, consent: z.literal(true) }).strict(),
  read('runtime-detect'),
  read('runtime-status'),
  z.object({ operation: z.literal('runtime-prepare'), id }).strict(),
  z
    .object({ operation: z.literal('runtime-install'), token: id, consent: z.literal(true) })
    .strict(),
  read('crash-scan'),
  z.object({ operation: z.literal('crash-reveal'), id }).strict(),
  read('crash-export'),
  read('external-catalog'),
  z.object({ operation: z.literal('external-open'), id }).strict(),
]);
export type ToolRequest = z.infer<typeof toolRequestSchema>;
