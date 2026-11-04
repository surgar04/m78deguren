import { deltaRecordSchema } from '@/lib/game-room-contracts';
/** 每一层都从 unknown 重新校验；接口缺失与真实零值保持不同，不用“默认 0”掩盖资料缺项。 */
export function record(value: unknown): Record<string, unknown> {
  const result = deltaRecordSchema.safeParse(value);
  return result.success ? result.data : {};
}
export function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.slice(0, 6000).flatMap((item) => {
        const parsed = deltaRecordSchema.safeParse(item);
        return parsed.success ? [parsed.data] : [];
      })
    : [];
}
export function string(value: unknown): string {
  return typeof value === 'string'
    ? value
    : typeof value === 'number' && Number.isFinite(value)
      ? String(value)
      : '';
}
export function number(value: unknown): number | null {
  if ((typeof value !== 'number' && typeof value !== 'string') || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}
export function firstNumber(data: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const result = number(data[key]);
    if (result !== null) return result;
  }
  return null;
}
export function seasonStats(value: unknown, mode: 'sol' | 'tdm') {
  const data = record(value);
  const season = record(data['season']);
  return { ...record(season['stats']), ...record(season[mode === 'sol' ? 'sol' : 'mp']) };
}
export function battleRows(data: Record<string, unknown>, mode: 'sol' | 'tdm') {
  const list = record(data[`battles_${mode}`]);
  return rows(list[mode === 'sol' ? 'sols' : 'tdms']).sort(
    (a, b) => (number(a['startTime']) ?? 0) - (number(b['startTime']) ?? 0),
  );
}
/** 赛季对局筛选只使用官方起止时间；缺少边界时返回空集，不把全历史当作该赛季。 */
export function inSeason(
  battles: Record<string, unknown>[],
  season: Record<string, unknown> | undefined,
  sid: string,
) {
  if (sid === '0') return battles;
  const epoch = (value: unknown) => {
    const numeric = number(value);
    if (numeric !== null) return numeric > 1e12 ? numeric : numeric * 1000;
    const parsed = Date.parse(string(value));
    return Number.isFinite(parsed) ? parsed : null;
  };
  const start = epoch(season?.['start_time']);
  const end = epoch(season?.['end_time']);
  if (start === null || end === null) return [];
  return battles.filter((row) => {
    const time = epoch(row['startTime']);
    return time !== null && time >= start && time <= end;
  });
}
export function format(value: unknown, digits = 0, suffix = '') {
  const numeric = number(value);
  return numeric === null
    ? '—'
    : `${numeric.toLocaleString('zh-CN', { maximumFractionDigits: digits })}${suffix}`;
}
function clamp(value: number, maximum: number) {
  return Math.max(0, Math.min(maximum, value));
}
/** 参考 NexBox 公开公式，修正百分率单位、近期时间顺序和负分下界；这是本地样本描述，绝非官方隐藏匹配分。 */
export function analyze(battles: Record<string, unknown>[], report: unknown, mode: 'sol' | 'tdm') {
  if (!battles.length) return null;
  const sum = (key: string) => battles.reduce((total, row) => total + (number(row[key]) ?? 0), 0);
  const won = (row: Record<string, unknown>) =>
    mode === 'sol' ? number(row['gameResult']) === 0 : number(row['isWinner']) === 1;
  const stats = seasonStats(report, mode);
  const officialKd = firstNumber(
    stats,
    mode === 'sol' ? 'solKdratio' : 'tdmKdRatio',
    'kill_death_ratio',
  );
  const officialRate = firstNumber(
    stats,
    mode === 'sol' ? 'solEscaperatio' : 'tdmSuccessRatio',
    mode === 'sol' ? 'escape_ratio' : 'win_ratio',
  );
  // 官方这组字段以百分数返回（例如 0.5 表示 0.5%），不能用“是否大于 1”猜单位。
  const normalizedRate = officialRate === null ? null : clamp(officialRate / 100, 1);
  const kd = officialKd ?? (sum('death') > 0 ? sum('killCnt') / sum('death') : sum('killCnt'));
  const winRate = normalizedRate ?? battles.filter(won).length / battles.length;
  const profit = sum('ProfitLoss') / battles.length;
  const minutes = sum('gameTime') / 60;
  const gained = battles.reduce(
    (total, row) => total + (firstNumber(row, 'gainedPrice', 'gained_price') ?? 0),
    0,
  );
  const ppsBase = clamp((minutes > 0 ? gained / minutes : 0) / 100, 12);
  const pps = Math.round(
    clamp(
      340 * ppsBase +
        300 * Math.min(kd, 5) +
        520 * winRate +
        200 * Math.max(-2, Math.min(4, profit / 100000)),
      2000,
    ),
  );
  const mmr = Math.round(
    clamp(
      600 * Math.min(kd, 5) +
        850 * winRate +
        280 * ppsBase +
        400 * Math.max(-2, Math.min(6, profit / 500000)),
      3000,
    ),
  );
  const recent = battles.slice(-10);
  const recentProfit = recent.reduce((total, row) => total + (number(row['ProfitLoss']) ?? 0), 0);
  const mes = Math.round(
    clamp(
      330 +
        recent.reduce((total, row) => total + Math.abs(number(row['ProfitLoss']) ?? 0), 0) /
          recent.length /
          40000,
      1000,
    ),
  );
  const recentRate = recent.filter(won).length / recent.length;
  const base = mes / 1000;
  const low = clamp(
    (1 - base) * (1.1 + 0.25 * (recentProfit >= 0 ? 1 : -1)) - (recentRate - 0.4) * 0.3,
    1,
  );
  const normal = clamp(0.62 - low * 0.5 + base * 0.1, 1);
  const high = clamp(base * 0.65 + (recentRate < 0.35 ? 0.35 : 0), 1);
  const ultra = clamp(
    base * 0.3 + (recentRate < 0.25 ? 0.3 : 0) + (recentProfit < -3000000 ? 0.25 : 0),
    1,
  );
  const total = low + normal + high + ultra || 1;
  return {
    pps,
    mmr,
    mes,
    count: battles.length,
    kd,
    winRate,
    profit,
    pressure: [low, normal, high, ultra].map((value) => Math.round((value / total) * 100)),
  };
}
export function collectionKind(item: Record<string, unknown>, dictionary: Record<string, unknown>) {
  const kind = string(dictionary['secondClass'] ?? item['secondClass'] ?? item['type']);
  const grade = firstNumber(dictionary, 'grade') ?? firstNumber(item, 'grade', 'quality') ?? 0;
  if (grade >= 6 && ['gun', 'dagger'].includes(kind)) return 'collection';
  return ['gun', 'dagger'].includes(kind)
    ? 'weapon'
    : ['vehicle', 'operator', 'pendant'].includes(kind)
      ? kind
      : 'other';
}
