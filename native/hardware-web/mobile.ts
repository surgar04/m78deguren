import { z } from 'zod';
import {
  hardwareMetricsSchema,
  hardwareGpuSchema,
  hardwareFpsSchema,
} from '../../src/lib/hardware-contracts.ts';
import { element } from './dom.ts';
const responseSchema = z
  .object({
    status: z.string().max(64),
    capturedAt: z.number().nullable(),
    metrics: hardwareMetricsSchema,
    gpus: z.array(hardwareGpuSchema).max(32),
    fps: hardwareFpsSchema,
  })
  .strict();
(() => {
  'use strict';
  const secret = location.hash.slice(1);
  history.replaceState(null, '', '/');
  const status = element('status', HTMLParagraphElement),
    gpu = element('gpu', HTMLSelectElement),
    container = element('metrics', HTMLDListElement);
  const rows = [
    ['CPU 使用率', 'cpu', '%'],
    ['CPU 温度', 'cpuTemperature', '°C'],
    ['CPU 频率', 'cpuClock', 'MHz'],
    ['CPU 功率', 'cpuPower', 'W'],
    ['GPU 使用率', 'gpu', '%'],
    ['GPU 温度', 'gpuTemperature', '°C'],
    ['显存已用', 'vramUsed', 'GB'],
    ['显存总量', 'vramTotal', 'GB'],
    ['内存使用率', 'memory', '%'],
    ['已用内存', 'memoryUsed', 'GB'],
    ['总内存', 'memoryTotal', 'GB'],
    ['下载', 'download', 'MiB/s'],
    ['上传', 'upload', 'MiB/s'],
    ['Present FPS', 'fps', 'FPS'],
    ['1% Low', 'low1', 'FPS'],
    ['0.1% Low', 'low01', 'FPS'],
  ] as const;
  const cells = rows.map(([label]) => {
    const term = document.createElement('dt'),
      cell = document.createElement('dd');
    term.textContent = label;
    container.append(term, cell);
    return cell;
  });
  let latest: z.infer<typeof responseSchema> | null = null;
  function paint() {
    const data = latest;
    if (!data) return;
    const selected = data.gpus.find((item) => item.id === gpu.value);
    rows.forEach(([, key, unit], index) => {
      const value =
        key.startsWith('gpu') || key.startsWith('vram')
          ? selected?.metrics[key]
          : key === 'fps' || key === 'low1' || key === 'low01'
            ? data.fps[key]
            : data.metrics[key];
      const cell = cells[index];
      if (cell)
        cell.textContent =
          typeof value === 'number' && Number.isFinite(value)
            ? `${Number(value.toFixed(2))} ${unit}`
            : '—';
    });
  }
  gpu.onchange = paint;
  async function refresh() {
    if (!/^[a-f0-9]{64}$/.test(secret)) {
      status.textContent = '请使用电脑端生成的完整访问链接或二维码重新打开。';
      return;
    }
    if (document.hidden) {
      setTimeout(() => {
        void refresh();
      }, 1500);
      return;
    }
    try {
      const result = await fetch('/api/metrics', {
        headers: { Authorization: `Bearer ${secret}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(4000),
      });
      if (!result.ok)
        throw new Error(result.status === 401 ? '访问凭证已撤销或过期。' : '电脑端服务暂不可用。');
      latest = responseSchema.parse(await result.json());
      const previous = gpu.value;
      gpu.replaceChildren();
      latest.gpus.forEach((card) => {
        const option = document.createElement('option');
        option.value = card.id;
        option.textContent = card.name;
        gpu.append(option);
      });
      if (latest.gpus.some((card) => card.id === previous)) gpu.value = previous;
      status.textContent = latest.capturedAt
        ? `${latest.status} · 更新于 ${new Date(latest.capturedAt).toLocaleTimeString()}`
        : '等待首次采样';
      paint();
    } catch (cause) {
      latest = null;
      status.textContent = cause instanceof Error ? cause.message : '连接失败';
      cells.forEach((cell) => (cell.textContent = '—'));
    }
    setTimeout(() => {
      void refresh();
    }, 1000);
  }
  void refresh();
})();
