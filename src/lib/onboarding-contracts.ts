import { z } from 'zod';
export const setupSteps = [
  'storage',
  'migration',
  'hardware',
  'drivers',
  'runtimes',
  'steam',
  'appearance',
  'identity',
] as const;
export const setupIdentitySchema = z
  .object({
    steamId: z.string().regex(/^\d{17}$/u),
    name: z
      .string()
      .max(80)
      .refine((value) => Array.from(value).length <= 40 && !/\p{Cc}/u.test(value)),
  })
  .strict();
export const setupProgressSchema = z
  .object({
    version: z.literal(1),
    complete: z.boolean(),
    stage: z.enum([...setupSteps, 'done']),
    completed: z.array(z.enum(setupSteps)),
    identity: setupIdentitySchema.nullable(),
  })
  .strict();
export const setupJobSchema = z
  .object({
    phase: z.string().max(40),
    kind: z.string().max(40),
    message: z.string().max(8000),
    restartRequired: z.boolean(),
  })
  .strict();
export const setupStatusSchema = z
  .object({ progress: setupProgressSchema, job: setupJobSchema, restrictedMode: z.boolean() })
  .strict();
export const setupStorageSchema = z
  .object({
    systemDrive: z.string().regex(/^[A-Z]$/iu),
    volumes: z
      .array(
        z
          .object({
            letter: z.string().regex(/^[A-Z]$/iu),
            name: z.string(),
            totalBytes: z.number().nonnegative(),
            freeBytes: z.number().nonnegative(),
          })
          .strict(),
      )
      .max(26),
    onlySystemVolume: z.boolean(),
    canSplit: z.boolean(),
    minNewGiB: z.number().nonnegative(),
    maxNewGiB: z.number().nonnegative(),
    systemSizeGiB: z.number().nonnegative(),
    reason: z.string(),
    installationPath: z.string().nullable(),
    installedOnSystem: z.boolean(),
  })
  .strict();
export const setupDriversSchema = z
  .object({
    gpus: z
      .array(
        z
          .object({ name: z.string(), vendor: z.string(), version: z.string(), pnpId: z.string() })
          .strict(),
      )
      .max(32),
    updates: z
      .array(
        z
          .object({
            id: z.uuid(),
            revision: z.number().int().nonnegative(),
            title: z.string(),
            manufacturer: z.string(),
            model: z.string(),
            date: z.string(),
            downloaded: z.boolean(),
          })
          .strict(),
      )
      .max(64),
    message: z.string(),
    checked: z.boolean(),
    source: z.string(),
  })
  .strict();
export const setupRequestSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('driver-backups') }).strict(),
  z.object({ operation: z.literal('back') }).strict(),
  z.object({ operation: z.literal('storage-elevate'), consent: z.literal(true) }).strict(),
  z
    .object({
      operation: z.literal('partition-prepare'),
      gib: z.number().int().min(32).max(1048576),
    })
    .strict(),
  z
    .object({
      operation: z.literal('partition-apply'),
      token: z.uuid(),
      confirmation: z.literal('创建 D 盘'),
      backupConfirmed: z.literal(true),
      consent: z.literal(true),
    })
    .strict(),
  z.object({ operation: z.literal('disk-recovery') }).strict(),
  z
    .object({ operation: z.literal('migration-prepare'), drive: z.string().regex(/^[A-Z]$/u) })
    .strict(),
  z
    .object({
      operation: z.literal('migration-apply'),
      token: z.uuid(),
      confirmation: z.literal('迁移臻境'),
      cleanupSource: z.boolean(),
      consent: z.literal(true),
    })
    .strict(),
  z.object({ operation: z.literal('migration-recovery') }).strict(),
  z.object({ operation: z.literal('driver-recovery') }).strict(),
  z.object({ operation: z.literal('job-acknowledge'), consent: z.literal(true) }).strict(),
  z.object({ operation: z.literal('status') }).strict(),
  z.object({ operation: z.literal('advance'), step: z.enum(setupSteps) }).strict(),
  z.object({ operation: z.literal('storage') }).strict(),
  z.object({ operation: z.literal('hardware') }).strict(),
  z.object({ operation: z.literal('drivers') }).strict(),
  z
    .object({ operation: z.literal('driver-apply'), id: z.uuid(), consent: z.literal(true) })
    .strict(),
  z
    .object({
      operation: z.literal('identity'),
      steamId: z
        .string()
        .regex(/^\d{17}$/u)
        .nullable(),
    })
    .strict(),
  z.object({ operation: z.literal('steam-pick') }).strict(),
  z.object({ operation: z.literal('steam-prepare') }).strict(),
  z
    .object({
      operation: z.literal('steam-install'),
      token: z.uuid(),
      drive: z.string().regex(/^[A-Z]$/u),
      consent: z.literal(true),
    })
    .strict(),
]);
export const partitionPlanSchema = z
  .object({
    token: z.uuid(),
    newGiB: z.number().int().positive(),
    systemDrive: z.string().regex(/^[A-Z]$/iu),
    systemBeforeGiB: z.number().positive(),
    systemAfterGiB: z.number().positive(),
    backupPath: z.string(),
    expiresInSeconds: z.number().positive(),
  })
  .strict();
export const migrationPlanSchema = z
  .object({
    token: z.uuid(),
    oldApplication: z.string(),
    newApplication: z.string(),
    oldData: z.string(),
    newData: z.string(),
    recoveryDirectory: z.string(),
    expiresInSeconds: z.number().positive(),
  })
  .strict();
export type SetupRequest = z.infer<typeof setupRequestSchema>;
