/** 与 Rust 的 150,000,000 个 100ns 刻度一致，不以循环截断代替上传限制。 */
export const MAX_BACKGROUND_VIDEO_SECONDS = 15;
export function validBackgroundVideoDuration(duration: number): boolean {
  return Number.isFinite(duration) && duration > 0 && duration <= MAX_BACKGROUND_VIDEO_SECONDS;
}
