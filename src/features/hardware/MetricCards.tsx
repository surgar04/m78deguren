import { useCallback, type ReactNode } from 'react';
import {
  faMicrochip,
  faMemory,
  faTemperatureHalf,
  faGear,
  faBolt,
  faFan,
  faChartPie,
  faGaugeHigh,
} from '@fortawesome/free-solid-svg-icons';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { Icon } from '@/features/home/components/Icon';
import type { HardwareSnapshot } from './types';
import { memoryPercent, numberText, percent } from './model';
import { useCanvas } from './useCanvas';

function Gauge({
  value,
  label,
  children,
  caption,
}: {
  value: number | null;
  label: string;
  children: ReactNode;
  caption: string;
}) {
  const progress = percent(value);
  const draw = useCallback(
    (context: CanvasRenderingContext2D, width: number, height: number) => {
      const radius = Math.min(width, height) / 2 - 6;
      context.lineWidth = 9;
      context.lineCap = 'round';
      context.strokeStyle = '#e3ebf2';
      context.beginPath();
      context.arc(width / 2, height / 2, radius, 0, Math.PI * 2);
      context.stroke();
      if (progress !== null && progress > 0) {
        context.strokeStyle = '#60dcb8';
        context.beginPath();
        context.arc(
          width / 2,
          height / 2,
          radius,
          -Math.PI / 2,
          -Math.PI / 2 + (progress / 100) * Math.PI * 2,
        );
        context.stroke();
      }
    },
    [progress],
  );
  const canvas = useCanvas(draw);
  return (
    <div
      className="hw-gauge"
      role={progress === null ? 'img' : 'meter'}
      aria-label={progress === null ? `${label}读数不可用` : `${label}使用率`}
      aria-valuenow={progress ?? undefined}
      aria-valuemin={progress === null ? undefined : 0}
      aria-valuemax={progress === null ? undefined : 100}
    >
      <canvas ref={canvas} aria-hidden="true" />
      <div className="hw-gauge-value">
        {progress === null ? <strong>—</strong> : children}
        <span>{progress === null ? '不可用' : caption}</span>
      </div>
    </div>
  );
}

function Reading({ icon, children }: { icon: IconDefinition; children: ReactNode }) {
  return (
    <div className="hw-reading">
      <Icon icon={icon} />
      <span>{children}</span>
    </div>
  );
}
function Card({
  title,
  icon,
  model,
  subtitle,
  children,
}: {
  title: string;
  icon: IconDefinition;
  model: string;
  subtitle?: string | undefined;
  children: ReactNode;
}) {
  return (
    <section className="hw-metric glass" aria-label={`${title}状态`}>
      <div className="hw-metric-heading">
        <Icon icon={icon} />
        <div>
          <h2>{title}</h2>
          <p>{model}</p>
          {subtitle && <p className="hw-cores">{subtitle}</p>}
        </div>
      </div>
      <div className="hw-metric-body">{children}</div>
    </section>
  );
}

/** 三张卡只格式化同一硬件快照，不维护第二份读数或补造不可用指标。 */
export function MetricCards({ data }: { data: HardwareSnapshot }) {
  const { processor, graphics, memoryInfo } = data;
  const available = data.available;
  return (
    <div className="hw-metrics" data-home-enter>
      <Card
        title="CPU"
        icon={faMicrochip}
        model={processor?.model ?? '尚未连接设备'}
        subtitle={
          processor
            ? `${numberText(processor.cores, '', 0)} 核心 ${numberText(processor.threads, '', 0)} 线程`
            : undefined
        }
      >
        <Gauge value={available ? data.cpu : null} label="CPU" caption="使用率">
          <strong>{numberText(data.cpu, '%')}</strong>
        </Gauge>
        <div className="hw-readings">
          <Reading icon={faTemperatureHalf}>{numberText(processor?.temperature, ' °C')}</Reading>
          <Reading icon={faGear}>{numberText(processor?.frequencyGHz, ' GHz')}</Reading>
          <Reading icon={faBolt}>{numberText(processor?.powerW, ' W')}</Reading>
        </div>
      </Card>
      <Card title="GPU" icon={faMicrochip} model={graphics?.model ?? '尚未连接设备'}>
        <Gauge value={available ? data.gpu : null} label="GPU" caption="使用率">
          <strong>{numberText(data.gpu, '%')}</strong>
        </Gauge>
        <div className="hw-readings">
          <Reading icon={faTemperatureHalf}>{numberText(graphics?.temperature, ' °C')}</Reading>
          <Reading icon={faMemory}>
            {graphics?.vramUsedGB !== null &&
            graphics?.vramUsedGB !== undefined &&
            graphics.vramTotalGB !== null
              ? `${graphics.vramUsedGB} / ${graphics.vramTotalGB} GB`
              : '—'}
          </Reading>
          <Reading icon={faFan}>{numberText(graphics?.fanRpm, ' RPM')}</Reading>
        </div>
      </Card>
      <Card
        title="内存"
        icon={faMemory}
        model={
          memoryInfo
            ? `${numberText(data.memoryTotal)} GB ${memoryInfo.kind} ${numberText(memoryInfo.speedMTs, ' MT/s', 0)}`
            : '尚未连接设备'
        }
      >
        <Gauge value={memoryPercent(data)} label="内存" caption="已使用">
          <div>
            <strong>{numberText(data.memoryUsed)}</strong>
            <small> / {numberText(data.memoryTotal)} GB</small>
          </div>
        </Gauge>
        <div className="hw-readings">
          <Reading icon={faChartPie}>{numberText(memoryPercent(data), '%')}</Reading>
          <Reading icon={faGaugeHigh}>{numberText(memoryInfo?.speedMTs, ' MT/s', 0)}</Reading>
        </div>
      </Card>
    </div>
  );
}
