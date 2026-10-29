/** 硬件数据契约与数据源无关；null 表示不可用，禁止用0冒充采集成功。 */
export type HardwareSeriesKey = 'cpu' | 'gpu' | 'memory';
export interface HardwareSample {
  timestamp: number;
  cpu: number | null;
  gpu: number | null;
  memory: number | null;
  cpuTemperature: number | null;
  gpuTemperature: number | null;
}
export interface HardwareSnapshot {
  available: boolean;
  source: 'live' | 'unavailable';
  capturedAt: number | null;
  sampleIntervalMs: number | null;
  /** 保留首页既有摘要字段，避免另建一份读数状态源。 */
  cpu: number | null;
  gpu: number | null;
  memoryUsed: number | null;
  memoryTotal: number | null;
  processor: {
    model: string;
    cores: number | null;
    threads: number | null;
    temperature: number | null;
    frequencyGHz: number | null;
    powerW: number | null;
  } | null;
  graphics: {
    model: string;
    temperature: number | null;
    vramUsedGB: number | null;
    vramTotalGB: number | null;
    memoryType: string;
    fanRpm: number | null;
  } | null;
  memoryInfo: { kind: string; speedMTs: number | null } | null;
  motherboard: string | null;
  disk: { label: string; kind: string; totalGB: number; usedGB: number } | null;
  operatingSystem: string | null;
  network: { downloadMBps: number | null; uploadKBps: number | null } | null;
  currentGame: string | null;
  samples: HardwareSample[];
}
