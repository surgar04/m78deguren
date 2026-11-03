import { z } from 'zod';
export const workspaceRequestSchema = z.discriminatedUnion('operation', [
  z
    .object({
      operation: z.enum(['status', 'select', 'defer', 'cancel', 'open', 'logs', 'prerequisites']),
    })
    .strict(),
  z.object({ operation: z.literal('prepare'), ticket: z.uuid(), consent: z.boolean() }).strict(),
]);
export type WorkspaceRequest = z.infer<typeof workspaceRequestSchema>;
export const workspaceStatusSchema = z
  .object({
    phase: z.enum([
      'idle',
      'selected',
      'preparing',
      'ready',
      'action-required',
      'failed',
      'cancelled',
      'deferred',
    ]),
    message: z.string().max(4096),
    root: z.string().max(1024).nullable(),
    branch: z.literal('codex/develop'),
    commit: z
      .string()
      .regex(/^[a-f0-9]{40}$/u)
      .nullable(),
    promptRequired: z.boolean(),
    ticket: z.uuid().nullable(),
  })
  .strict();
