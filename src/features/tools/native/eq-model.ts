import type { EqConfig } from '@/lib/builtin-contracts';

/** 这些是用户可选择的标准频率与初始处理参数，不属于设备读数或模拟业务数据。 */
const ISO_FREQUENCIES = [
  20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600,
  2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000,
];
export function frequencies(count: number): number[] {
  if (count === 31) return [...ISO_FREQUENCIES];
  if (count === 10) return [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  if (count === 5) return [63, 250, 1000, 4000, 16000];
  return Array.from({ length: count }, (_, index) =>
    Math.round(20 * 1000 ** (index / (count - 1))),
  );
}
/** 曲线与 Rust 的 RBJ peaking 参数一致，显示稳定后的 EQ 响应，而非虚构实时音频频谱。 */
export function eqResponse(config: EqConfig, frequency: number, rate = 48000): number {
  const reserve = config.headroom
    ? Math.max(0, ...config.bands.map((band) => (config.enabled ? band.gain : 0))) +
      config.effects.bass * 6 +
      config.effects.clarity * 3
    : 0;
  let response = config.preamp - reserve;
  const q =
    config.bands.length === 5
      ? 0.7
      : config.bands.length === 10
        ? 1.4
        : config.bands.length === 15
          ? 2.2
          : config.bands.length === 20
            ? 3
            : 4.3;
  const bands = [
    ...(config.enabled ? config.bands.map((band) => ({ ...band, q })) : []),
    { frequency: 4000, gain: config.effects.clarity * 6, q: 0.7 },
    { frequency: 90, gain: config.effects.bass * 10, q: 0.6 },
  ];
  const omega = (2 * Math.PI * frequency) / rate;
  const c1 = Math.cos(omega),
    s1 = Math.sin(omega),
    c2 = Math.cos(2 * omega),
    s2 = Math.sin(2 * omega);
  for (const band of bands) {
    if (Math.abs(band.gain) < 0.0001) continue;
    const a = 10 ** (band.gain / 40),
      w = (2 * Math.PI * Math.min(band.frequency, rate * 0.45)) / rate,
      alpha = Math.sin(w) / (2 * band.q),
      a0 = 1 + alpha / a;
    const b0 = (1 + alpha * a) / a0,
      b1 = (-2 * Math.cos(w)) / a0,
      b2 = (1 - alpha * a) / a0,
      a1 = (-2 * Math.cos(w)) / a0,
      a2 = (1 - alpha / a) / a0;
    const top = (b0 + b1 * c1 + b2 * c2) ** 2 + (-b1 * s1 - b2 * s2) ** 2,
      bottom = (1 + a1 * c1 + a2 * c2) ** 2 + (-a1 * s1 - a2 * s2) ** 2;
    response += 10 * Math.log10(Math.max(1e-16, top / bottom));
  }
  return response;
}
