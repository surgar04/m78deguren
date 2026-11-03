import { z } from 'zod';

export const developerRequestSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('status') }).strict(),
  z
    .object({
      operation: z.literal('authenticate'),
      email: z.email().max(254),
      stoken: z.string().min(1).max(4096),
    })
    .strict(),
  z.object({ operation: z.literal('fallback') }).strict(),
]);
export type DeveloperRequest = z.infer<typeof developerRequestSchema>;
export const developerStatusSchema = z
  .object({
    edition: z.enum(['stable', 'developer']),
    mode: z.enum(['locked', 'stable', 'developer']),
    build: z.string().max(80),
    expiresAt: z.number().int().positive().nullable(),
    message: z.string().max(1024),
  })
  .strict();
