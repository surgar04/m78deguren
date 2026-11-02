export type GraphicsPolicy = 'auto' | 'original' | 'efficient';
/** 只探测一次，不按每帧性能分数来回切画质；原画策略完全保留上游像素预算。 */
function detectGraphics() {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
  if (!gl) return { available: false, software: true };
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer: unknown = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : '';
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  canvas.width = 1;
  canvas.height = 1;
  return {
    available: true,
    software:
      typeof renderer === 'string' &&
      /swiftshader|llvmpipe|software|microsoft basic|warp/iu.test(renderer),
  };
}
const device = detectGraphics();
let policy: GraphicsPolicy = 'auto';
export function configureGraphics(next: GraphicsPolicy) {
  policy = next;
  return { ...device, efficient: next === 'efficient' || (next === 'auto' && device.software) };
}
export function graphicsPixelBudget(original: number) {
  return policy === 'efficient' || (policy === 'auto' && device.software)
    ? Math.min(original, 320 * 180)
    : original;
}
