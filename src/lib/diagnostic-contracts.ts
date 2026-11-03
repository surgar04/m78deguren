import { z } from 'zod';
export const diagnosticEventSchema = z
  .object({
    level: z.enum(['debug', 'info', 'warn', 'error']),
    event: z.enum([
      'ipc.start',
      'ipc.complete',
      'ipc.failed',
      'frontend.error',
      'frontend.rejection',
      'frontend.console',
      'query.failed',
      'mutation.failed',
      'schema.invalid',
      'window.event',
      'log.queue_overflow',
      'media.state',
      'media.error',
      'navigation.changed',
    ]),
    operation: z
      .string()
      .regex(/^[a-zA-Z0-9._:/-]{1,100}$/u)
      .nullable(),
    trace: z.uuid().nullable(),
    durationMs: z.number().int().min(0).max(86400000).nullable(),
    message: z.string().max(16384).nullable(),
  })
  .strict();
export type DiagnosticEvent = z.infer<typeof diagnosticEventSchema>;
export const diagnosticRequestSchema = z.discriminatedUnion('operation', [
  z
    .object({ operation: z.literal('ingest'), entries: z.array(diagnosticEventSchema).max(64) })
    .strict(),
  z
    .object({
      operation: z.literal('read'),
      level: z.enum(['all', 'error', 'warn', 'info', 'debug']),
      search: z.string().max(120),
    })
    .strict(),
  z.object({ operation: z.literal('detail'), enabled: z.boolean() }).strict(),
  z.object({ operation: z.literal('clear'), consent: z.boolean() }).strict(),
  z.object({ operation: z.enum(['open', 'export']) }).strict(),
]);
export type DiagnosticRequest = z.infer<typeof diagnosticRequestSchema>;
export const diagnosticEntrySchema = z
  .object({
    at: z.string(),
    session: z.string(),
    version: z.string(),
    level: z.string(),
    source: z.string(),
    event: z.string(),
    operation: z.string().nullable(),
    trace: z.string().nullable(),
    durationMs: z.number().nullable(),
    message: z.string(),
  })
  .passthrough();
export const diagnosticSnapshotSchema = z
  .object({
    session: z.string(),
    version: z.string(),
    bytes: z.number().nonnegative(),
    files: z.number().int().nonnegative(),
    dropped: z.number().int().nonnegative().default(0),
    detailUntil: z.number(),
    detailed: z.boolean(),
    previousUnclean: z.boolean(),
    entries: z.array(diagnosticEntrySchema).max(500),
  })
  .strict();
