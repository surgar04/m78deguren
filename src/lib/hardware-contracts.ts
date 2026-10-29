import { z } from 'zod';
import { localWindowsPathSchema } from './local-path.ts';

const text = z
  .string()
  .max(1024)
  .refine((value) => !/\p{Cc}/u.test(value));
export const hardwareMetricsSchema = z
  .record(z.string().max(64), z.number().finite().nullable())
  .refine((value) => Object.keys(value).length <= 32);
export const hardwareDeviceSchema = z
  .object({
    id: text,
    kind: z.enum([
      'cpu',
      'gpu',
      'memory',
      'motherboard',
      'bios',
      'disk',
      'volume',
      'audio',
      'network',
      'monitor',
      'os',
    ]),
    name: text,
    fields: z.array(z.object({ label: text, value: text }).strict()).max(64),
  })
  .strict();
export const hardwareSensorSchema = z
  .object({
    id: text,
    hardwareId: text,
    hardware: text,
    hardwareType: text,
    name: text,
    sensorType: text,
    unit: text,
    value: z.number().finite().nullable(),
    min: z.number().finite().nullable(),
    max: z.number().finite().nullable(),
  })
  .strict();
export const hardwareGpuSchema = z
  .object({ id: text, name: text, metrics: hardwareMetricsSchema })
  .strict();
export const hardwareFpsSchema = z
  .object({
    enabled: z.boolean(),
    processId: z.number().int().nonnegative(),
    fps: z.number().finite().nonnegative().nullable(),
    low1: z.number().finite().nonnegative().nullable(),
    low01: z.number().finite().nonnegative().nullable(),
    frameCount: z.number().int().nonnegative(),
    message: text,
  })
  .strict();
export const hardwareSampleSchema = z
  .object({
    timestamp: z.number().int().positive(),
    metrics: hardwareMetricsSchema,
    gpus: z.array(hardwareGpuSchema).max(32),
    fps: hardwareFpsSchema,
  })
  .strict();
export const hardwareSnapshotSchema = z
  .object({
    status: z.enum(['stopped', 'starting', 'ready', 'degraded', 'failed', 'stale']),
    capturedAt: z.number().int().positive().nullable(),
    devices: z.array(hardwareDeviceSchema).max(256),
    sensors: z.array(hardwareSensorSchema).max(8192),
    metrics: hardwareMetricsSchema,
    gpus: z.array(hardwareGpuSchema).max(32),
    samples: z.array(hardwareSampleSchema).max(360),
    fps: hardwareFpsSchema,
    recording: z
      .object({
        count: z.number().int().nonnegative(),
        start: z.number().nullable(),
        end: z.number().nullable(),
        bytes: z.number().int().nonnegative(),
        error: z.string().max(8000).nullable(),
      })
      .strict(),
    warnings: z.array(text).max(128),
    privileged: z.boolean(),
    processId: z.number().int().nonnegative(),
    processName: text.nullable(),
  })
  .strict();
export const hardwareRemoteSchema = z
  .object({
    enabled: z.boolean(),
    url: z.string().max(512).nullable(),
    qrSvg: z.string().max(131072).nullable(),
    addresses: z.array(z.ipv4()).max(64),
    expiresAt: z.number().nullable(),
  })
  .strict();
export const hardwareReceiptSchema = z
  .object({
    path: localWindowsPathSchema,
    bytes: z.number().int().positive(),
    points: z.number().int().nonnegative(),
    totalSamples: z.number().int().nonnegative(),
  })
  .strict();
export const hardwareRequestSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('snapshot') }).strict(),
  z
    .object({ operation: z.literal('restart'), privileged: z.boolean(), consent: z.boolean() })
    .strict(),
  z.object({ operation: z.literal('sensors-open') }).strict(),
  z.object({ operation: z.literal('copy') }).strict(),
  z
    .object({
      operation: z.literal('export'),
      from: z.number().int().nonnegative().nullable(),
      to: z.number().int().nonnegative().nullable(),
    })
    .strict(),
  z.object({ operation: z.literal('clear'), consent: z.literal(true) }).strict(),
  z
    .object({
      operation: z.literal('fps-start'),
      pid: z.number().int().positive().max(4294967295).nullable(),
      consent: z.literal(true),
    })
    .strict(),
  z.object({ operation: z.literal('fps-stop') }).strict(),
  z.object({ operation: z.literal('remote-info') }).strict(),
  z
    .object({ operation: z.literal('remote-start'), address: z.ipv4(), consent: z.literal(true) })
    .strict(),
  z.object({ operation: z.literal('remote-stop') }).strict(),
]);
export type HardwareRequest = z.infer<typeof hardwareRequestSchema>;
export type LiveHardware = z.infer<typeof hardwareSnapshotSchema>;
export type HardwareDevice = z.infer<typeof hardwareDeviceSchema>;
export type HardwareSensor = z.infer<typeof hardwareSensorSchema>;
