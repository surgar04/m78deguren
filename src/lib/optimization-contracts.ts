import { z } from 'zod';
export const optimizationCategoryIdSchema = z.enum([
  'gaming',
  'gpu',
  'performance',
  'privacy',
  'ai',
  'services',
  'disk',
  'apps',
  'network',
  'explorer',
  'audio',
]);
export const optimizationRiskSchema = z.enum(['low', 'medium', 'high']);
export const optimizationSelectionSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[A-Za-z][A-Za-z0-9]+$/u),
    value: z.enum(['apply', 'restore', 'program', 'background', 'extreme']),
  })
  .strict();
export const optimizationSelectionsSchema = z
  .array(optimizationSelectionSchema)
  .min(1)
  .max(201)
  .refine((rows) => new Set(rows.map((row) => row.id)).size === rows.length, '配置项不能重复');
export const registryValueSchema = z
  .object({
    exists: z.boolean(),
    kind: z
      .enum(['String', 'ExpandString', 'DWord', 'QWord', 'Binary', 'None', 'MultiString'])
      .nullable(),
    data: z.string().max(1_398_104).nullable(),
    multi: z.array(z.string().max(1_048_576)).max(4096),
  })
  .strict();
export const registryPreviewSchema = z
  .object({
    path: z.string().max(4096),
    name: z.string().max(512),
    before: registryValueSchema,
    after: registryValueSchema,
    owners: z.array(z.string().max(80)).max(201),
  })
  .strict();
const operationSchema = z
  .object({
    path: z.string().max(4096),
    name: z.string().max(512),
    kind: z.enum(['DWord', 'String']),
    value: z.string().max(65_536).nullable(),
    mode: z.literal('string-map').optional(),
    referenceValue: z.string().nullable().optional(),
  })
  .strict();
export const optimizationDefinitionSchema = z
  .object({
    id: optimizationSelectionSchema.shape.id,
    category: optimizationCategoryIdSchema,
    name: z.string().min(1),
    description: z.string(),
    risk: optimizationRiskSchema,
    sourceRisk: optimizationRiskSchema,
    vendor: z.enum(['nvidia', 'amd', 'intel']).nullable(),
    cpuVendor: z.literal('intel').nullable(),
    defaultValue: optimizationSelectionSchema.shape.value,
    variants: z
      .array(
        z
          .object({
            value: optimizationSelectionSchema.shape.value,
            label: z.string(),
            operations: z.array(operationSchema).min(1).max(128),
          })
          .strict(),
      )
      .min(1)
      .max(8),
    restore: z
      .object({
        operations: z.array(operationSchema).max(128),
        pruneKeys: z.array(z.string()).max(16),
      })
      .strict(),
    safeEligible: z.boolean(),
    securitySensitive: z.boolean(),
    restartRequired: z.boolean(),
    notes: z.array(z.string()).max(16),
  })
  .strict();
export const optimizationCatalogSchema = z
  .object({
    version: z.literal(1),
    source: z
      .object({
        repository: z.literal('https://github.com/MuLiuSaMa/NexBox'),
        commit: z.string().regex(/^[a-f0-9]{40}$/u),
        items: z.literal(201),
      })
      .strict(),
    items: z
      .array(optimizationDefinitionSchema)
      .length(201)
      .refine((items) => new Set(items.map((item) => item.id)).size === 201),
  })
  .strict();
export const optimizationRowSchema = z
  .object({
    id: optimizationSelectionSchema.shape.id,
    state: z.enum(['configured', 'baseline', 'custom', 'partial', 'unsupported', 'error']),
    selectedValue: z.string().nullable(),
    checks: z
      .array(
        z
          .object({
            path: z.string(),
            name: z.string(),
            current: registryValueSchema,
            target: registryValueSchema,
            matches: z.boolean(),
          })
          .strict(),
      )
      .max(128),
    skipped: z.array(z.string()).max(128),
    error: z.string().max(4000).nullable(),
  })
  .strict();
export const optimizationSnapshotSchema = z
  .object({
    checkedAt: z.number().int().nonnegative(),
    osBuild: z.string().max(80),
    admin: z.boolean(),
    rows: z.array(optimizationRowSchema).length(201),
  })
  .strict();
export const optimizerRequestSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('catalog') }).strict(),
  z.object({ operation: z.literal('scan') }).strict(),
  z.object({ operation: z.literal('history') }).strict(),
]);
export type OptimizerRequest = z.infer<typeof optimizerRequestSchema>;
export type OptimizationDefinition = z.infer<typeof optimizationDefinitionSchema>;
export type OptimizationSnapshot = z.infer<typeof optimizationSnapshotSchema>;
export type OptimizationRow = z.infer<typeof optimizationRowSchema>;
export type RegistryValue = z.infer<typeof registryValueSchema>;
