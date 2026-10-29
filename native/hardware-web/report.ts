import { z } from 'zod';
import { hardwareDeviceSchema, hardwareSampleSchema } from '../../src/lib/hardware-contracts.ts';
import { element } from './dom.ts';
type Sample = z.infer<typeof hardwareSampleSchema>;
// 完全离线绘图：只显示实测样本，null 中断曲线，不插值补造缺失区间。
(() => {
  'use strict';
  const data = z
    .object({
      version: z.literal(1),
      devices: z.array(hardwareDeviceSchema).max(256),
      warnings: z.array(z.string()).max(128),
      samples: z.array(hardwareSampleSchema).max(60000),
      totalSamples: z.number().int().nonnegative(),
    })
    .strict()
    .parse(JSON.parse(element('report-data', HTMLScriptElement).textContent ?? ''));
  const samples = data.samples;
  const range = element('range', HTMLSelectElement),
    from = element('from', HTMLInputElement),
    to = element('to', HTMLInputElement);
  const gpu = element('gpu', HTMLSelectElement);
  const names = new Map<string, string>();
  samples.forEach((point) => point.gpus.forEach((card) => names.set(card.id, card.name)));
  names.forEach((name, id) => {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = name;
    gpu.append(option);
  });
  const definitions: readonly (readonly [
    string,
    string,
    readonly (readonly [string, string, string])[],
  ])[] = [
    [
      '使用率',
      '%',
      [
        ['CPU', '#12b793', 'cpu'],
        ['GPU', '#2468da', 'gpu'],
        ['内存', '#8876d8', 'memory'],
      ],
    ],
    [
      '温度',
      '°C',
      [
        ['CPU', '#12b793', 'cpuTemperature'],
        ['GPU', '#2468da', 'gpuTemperature'],
        ['磁盘最高', '#8876d8', 'diskTemperature'],
      ],
    ],
    [
      '时钟频率',
      'MHz',
      [
        ['CPU', '#12b793', 'cpuClock'],
        ['GPU', '#2468da', 'gpuClock'],
        ['显存', '#8876d8', 'gpuMemoryClock'],
      ],
    ],
    [
      '功率',
      'W',
      [
        ['CPU', '#12b793', 'cpuPower'],
        ['GPU', '#2468da', 'gpuPower'],
      ],
    ],
    [
      '帧率',
      'FPS',
      [
        ['Present FPS', '#12b793', 'fps'],
        ['1% Low', '#2468da', 'low1'],
        ['0.1% Low', '#8876d8', 'low01'],
      ],
    ],
    [
      '网络速度',
      'MiB/s',
      [
        ['下载', '#12b793', 'download'],
        ['上传', '#2468da', 'upload'],
      ],
    ],
    [
      '显存',
      'GB',
      [
        ['已用显存', '#2468da', 'vramUsed'],
        ['专用显存总量', '#8876d8', 'vramTotal'],
      ],
    ],
    [
      '内存容量',
      'GB',
      [
        ['已用内存', '#12b793', 'memoryUsed'],
        ['总内存', '#8876d8', 'memoryTotal'],
      ],
    ],
    [
      '风扇转速',
      'RPM',
      [
        ['CPU', '#12b793', 'cpuFan'],
        ['GPU', '#2468da', 'gpuFan'],
      ],
    ],
    [
      '电压',
      'V',
      [
        ['CPU', '#12b793', 'cpuVoltage'],
        ['GPU', '#2468da', 'gpuVoltage'],
      ],
    ],
  ];
  const charts = definitions.map(([title, unit, series]) => {
    const section = document.createElement('section'),
      heading = document.createElement('h2'),
      legend = document.createElement('div'),
      canvas = document.createElement('canvas');
    heading.textContent = `${title} (${unit})`;
    legend.className = 'legend';
    series.forEach(([name, color]) => {
      const label = document.createElement('span');
      label.textContent = name;
      label.style.color = color;
      legend.append(label);
    });
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', `${title}随时间变化曲线`);
    section.append(heading, legend, canvas);
    element('charts', HTMLDivElement).append(section);
    return { canvas, series };
  });
  const selectedValue = (sample: Sample, key: string) => {
    if (key === 'fps' || key === 'low1' || key === 'low01') return sample.fps[key];
    if (key.startsWith('gpu') || key.startsWith('vram'))
      return sample.gpus.find((card) => card.id === gpu.value)?.metrics[key] ?? null;
    return sample.metrics[key] ?? null;
  };
  const inputTime = (timestamp: number) =>
    new Date(timestamp - new Date(timestamp).getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 23);
  let selected = samples;
  function draw() {
    const first = selected[0],
      last = selected.at(-1);
    element('range-status', HTMLParagraphElement).textContent =
      first && last
        ? `${selected.length} 个实测点 · ${new Date(first.timestamp).toLocaleString()} 至 ${new Date(last.timestamp).toLocaleString()}`
        : '该范围没有实测数据';
    charts.forEach(({ canvas, series }) => {
      const width = canvas.clientWidth,
        height = canvas.clientHeight,
        ratio = Math.min(devicePixelRatio || 1, 2);
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      const context = canvas.getContext('2d');
      if (!context) return;
      context.scale(ratio, ratio);
      context.font = '12px system-ui';
      const left = 52,
        right = width - 20,
        top = 15,
        bottom = height - 35;
      const values = selected
        .flatMap((sample) => series.map(([, , key]) => selectedValue(sample, key)))
        .filter((value) => Number.isFinite(value));
      const max =
        values.reduce<number>(
          (max, value) => (typeof value === 'number' ? Math.max(max, value) : max),
          1,
        ) * 1.12;
      context.fillStyle = '#65808c';
      context.strokeStyle = '#e2ecec';
      for (let index = 0; index <= 4; index++) {
        const y = bottom - ((bottom - top) * index) / 4;
        context.fillText(((max * index) / 4).toFixed(max > 10 ? 0 : 2), 3, y + 4);
        context.beginPath();
        context.moveTo(left, y);
        context.lineTo(right, y);
        context.stroke();
      }
      if (!first || !last) {
        context.fillText('无数据', left + 15, top + 25);
        return;
      }
      if (values.length === 0) {
        context.fillText('该时间范围无可用读数', left + 15, top + 25);
        return;
      }
      const start = first.timestamp,
        span = Math.max(1000, last.timestamp - start);
      [0, 0.5, 1].forEach((fraction) =>
        context.fillText(
          new Date(start + span * fraction).toLocaleTimeString(),
          left + (right - left) * fraction - 20,
          height - 9,
        ),
      );
      series.forEach(([, color, key]) => {
        context.strokeStyle = color;
        context.lineWidth = 1.7;
        context.beginPath();
        let connected = false,
          previous = 0;
        selected.forEach((sample) => {
          const value = selectedValue(sample, key);
          if (typeof value !== 'number' || !Number.isFinite(value)) {
            connected = false;
            return;
          }
          const x = left + ((sample.timestamp - start) / span) * (right - left),
            y = bottom - (value / max) * (bottom - top);
          if (connected && sample.timestamp - previous <= 5000) context.lineTo(x, y);
          else context.moveTo(x, y);
          connected = true;
          previous = sample.timestamp;
        });
        context.stroke();
      });
    });
  }
  range.onchange = () => {
    const first = samples[0],
      last = samples.at(-1);
    if (!first || !last) return;
    const end = last.timestamp;
    const start =
      range.value === 'all'
        ? first.timestamp
        : Math.max(first.timestamp, end - Number(range.value) * 1000);
    from.value = inputTime(start);
    to.value = inputTime(end);
    selected = samples.filter((sample) => sample.timestamp >= start && sample.timestamp <= end);
    draw();
  };
  element('apply', HTMLButtonElement).onclick = () => {
    const start = new Date(from.value).getTime(),
      end = new Date(to.value).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) {
      element('range-status', HTMLParagraphElement).textContent = '请输入有效的开始和结束时间';
      return;
    }
    selected = samples.filter((sample) => sample.timestamp >= start && sample.timestamp <= end);
    draw();
  };
  gpu.onchange = draw;
  window.addEventListener('resize', draw);
  data.devices.forEach((device) => {
    const details = document.createElement('details'),
      summary = document.createElement('summary'),
      list = document.createElement('dl');
    summary.textContent = `${device.kind} · ${device.name}`;
    device.fields.forEach((field) => {
      const term = document.createElement('dt'),
        value = document.createElement('dd');
      term.textContent = field.label;
      value.textContent = field.value;
      list.append(term, value);
    });
    details.append(summary, list);
    element('devices', HTMLDivElement).append(details);
  });
  element('status', HTMLParagraphElement).textContent =
    `原始记录 ${data.totalSamples} 条，报告包含 ${samples.length} 个实测点。数据过多时保留原始点进行降采样；缺失指标不补零。本报告无需联网。`;
  range.dispatchEvent(new Event('change'));
  draw();
})();
