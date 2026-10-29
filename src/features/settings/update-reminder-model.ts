import { z } from 'zod';
export const REMINDER_KEY = 'zhenjing.update-reminder';
const dismissalSchema = z
  .object({
    version: z.string().max(60),
    stage: z.enum(['available', 'ready', 'unverified']),
    until: z.number().finite().nonnegative(),
  })
  .strict();
export type Dismissal = z.infer<typeof dismissalSchema>;
export function readDismissal(): Dismissal | null {
  try {
    return dismissalSchema.parse(JSON.parse(localStorage.getItem(REMINDER_KEY) ?? 'null'));
  } catch {
    return null;
  }
}
/** 下载就绪与签名清单补齐都会重新提醒，旧阶段的“稍后处理”不能屏蔽新阶段。 */
export function reminderVisible(
  version: string,
  stage: Dismissal['stage'],
  dismissed: Dismissal | null,
  now: number,
): boolean {
  return (
    !dismissed ||
    dismissed.version !== version ||
    dismissed.stage !== stage ||
    dismissed.until <= now
  );
}
