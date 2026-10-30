import { z } from 'zod';

const digest = z.string().regex(/^[a-f0-9]{64}$/u);
/** 客户端路径只来自原生检测/选择器；请求不接受前端提供的执行路径。 */
export const accelerationClientSchema = z
  .object({
    path: z.string().min(1).max(4096),
    version: z.string().max(128),
    publisher: z.literal('厦门科臻赛科技有限公司'),
    sha256: digest,
  })
  .strict();
export const accelerationSessionSchema = z
  .object({
    id: z.uuid(),
    gameId: z.uuid(),
    gameName: z.string().max(256),
    phase: z.enum(['waiting', 'launch-requested', 'playing', 'finished', 'cancelled', 'failed']),
    message: z.string().max(8000),
    createdAt: z.number().int(),
    confirmedAt: z.number().int().nullable(),
  })
  .strict();
export const accelerationSnapshotSchema = z
  .object({
    config: z
      .object({ client: accelerationClientSchema.nullable(), remindOnExit: z.boolean() })
      .strict(),
    revision: digest,
    clients: z.array(accelerationClientSchema).max(8),
    clientRunning: z.boolean(),
    session: accelerationSessionSchema.nullable(),
    warnings: z.array(z.string().max(8000)).max(32),
  })
  .strict();
export const accelerationRequestSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('snapshot') }).strict(),
  z.object({ operation: z.literal('discover') }).strict(),
  z.object({ operation: z.literal('choose') }).strict(),
  z
    .object({
      operation: z.literal('select'),
      index: z.number().int().min(0).max(7),
      hash: digest,
      revision: digest,
    })
    .strict(),
  z.object({ operation: z.literal('remind'), enabled: z.boolean(), revision: digest }).strict(),
  z.object({ operation: z.literal('open') }).strict(),
  z.object({ operation: z.literal('website'), kind: z.enum(['download', 'help']) }).strict(),
  z.object({ operation: z.literal('prepare'), gameId: z.uuid() }).strict(),
  z.object({ operation: z.literal('confirm'), id: z.uuid(), consent: z.literal(true) }).strict(),
  z.object({ operation: z.literal('cancel'), id: z.uuid() }).strict(),
  z.object({ operation: z.literal('stop-tracking'), id: z.uuid() }).strict(),
]);
export type AccelerationRequest = z.infer<typeof accelerationRequestSchema>;
export type AccelerationSession = z.infer<typeof accelerationSessionSchema>;
export const ACCELERATION_PHASES: Record<AccelerationSession['phase'], string> = {
  waiting: '等待本次确认',
  'launch-requested': '启动请求已提交',
  playing: '游戏运行中',
  finished: '游戏已结束',
  cancelled: '准备已取消',
  failed: '准备已失效',
};
export function isPreparationActive(session: AccelerationSession | null | undefined) {
  return (
    session !== null &&
    session !== undefined &&
    ['waiting', 'launch-requested', 'playing'].includes(session.phase)
  );
}
