import { useCallback, useId, useMemo, useState } from 'react';
import {
  faClock,
  faChevronDown,
  faWifi,
  faArrowDown,
  faArrowUp,
  faGamepad,
} from '@fortawesome/free-solid-svg-icons';
import { Icon } from '@/features/home/components/Icon';
import type { HardwareSnapshot, HardwareSeriesKey } from './types';
import { numberText, percent, samplesInWindow } from './model';
import { useCanvas } from './useCanvas';

const SERIES: readonly { key: HardwareSeriesKey; label: string; color: string }[] = [
  { key: 'cpu', label: 'CPU', color: '#22cda5' },
  { key: 'gpu', label: 'GPU', color: '#1475ff' },
  { key: 'memory', label: '内存', color: '#86b3e7' },
];
const PADDING = { left: 48, right: 10, top: 14, bottom: 34 };

/** 可交互的原生Canvas数据图；图例/时间窗/键盘与读屏状态均由同一采样数组派生。 */
export function PerformanceChart({
  data,
  seconds,
  onSecondsChange,
}: {
  data: HardwareSnapshot;
  seconds: number;
  onSecondsChange: (seconds: number) => void;
}) {
  const samples = useMemo(() => samplesInWindow(data.samples, seconds), [data.samples, seconds]);
  const [visible, setVisible] = useState<HardwareSeriesKey[]>(['cpu', 'gpu', 'memory']);
  const [position, setPosition] = useState<number | null>(null);
  const hintId = useId();
  const active = position === null ? null : samples[Math.min(position, samples.length - 1)];
  const draw = useCallback(
    (context: CanvasRenderingContext2D, width: number, height: number) => {
      const plotWidth = Math.max(1, width - PADDING.left - PADDING.right);
      const plotHeight = Math.max(1, height - PADDING.top - PADDING.bottom);
      context.font = '330 12px MiSans, sans-serif';
      context.lineWidth = 1;
      for (let tick = 0; tick <= 4; tick++) {
        const y = PADDING.top + (tick / 4) * plotHeight;
        context.strokeStyle = '#dfeaf5';
        context.beginPath();
        context.moveTo(PADDING.left, y);
        context.lineTo(width - PADDING.right, y);
        context.stroke();
        context.fillStyle = '#627f9f';
        context.textAlign = 'right';
        context.textBaseline = 'middle';
        context.fillText(`${100 - tick * 25}%`, PADDING.left - 13, y);
      }
      for (let tick = 0; tick <= 6; tick++) {
        const x = PADDING.left + (tick / 6) * plotWidth;
        context.strokeStyle = '#e2edf6';
        context.beginPath();
        context.moveTo(x, PADDING.top);
        context.lineTo(x, height - PADDING.bottom);
        context.stroke();
        context.fillStyle = '#6b87a6';
        context.textAlign = 'center';
        context.fillText(
          tick === 6 ? '现在' : `${Math.round(seconds * (1 - tick / 6))}秒前`,
          x,
          height - 12,
        );
      }
      if (samples.length === 0) return;
      const start = samples.at(-1)?.timestamp;
      if (start === undefined) return;
      for (const series of SERIES) {
        if (!visible.includes(series.key)) continue;
        context.strokeStyle = series.color;
        context.lineWidth = 2;
        context.lineJoin = 'round';
        context.lineCap = 'round';
        context.beginPath();
        let connected = false;
        for (const sample of samples) {
          const value = percent(sample[series.key]);
          if (value === null) {
            connected = false;
            continue;
          }
          const x =
            PADDING.left +
            ((sample.timestamp - (start - seconds * 1000)) / (seconds * 1000)) * plotWidth;
          const y = PADDING.top + ((100 - value) / 100) * plotHeight;
          if (connected) context.lineTo(x, y);
          else context.moveTo(x, y);
          connected = true;
        }
        context.stroke();
      }
      const selected = position === null ? null : samples[Math.min(position, samples.length - 1)];
      if (selected) {
        const x =
          PADDING.left +
          ((selected.timestamp - (start - seconds * 1000)) / (seconds * 1000)) * plotWidth;
        context.strokeStyle = '#8ea4bb';
        context.lineWidth = 1;
        context.setLineDash([3, 3]);
        context.beginPath();
        context.moveTo(x, PADDING.top);
        context.lineTo(x, height - PADDING.bottom);
        context.stroke();
        context.setLineDash([]);
      }
    },
    [samples, seconds, visible, position],
  );
  const canvas = useCanvas(draw);
  return (
    <section className="hw-trend glass" aria-labelledby="hw-trend-title">
      <div className="hw-trend-toolbar">
        <h2 id="hw-trend-title">性能趋势</h2>
        <label className="hw-window">
          <Icon icon={faClock} />
          <select
            aria-label="趋势时间范围"
            value={seconds}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (value === 15 || value === 30 || value === 60) {
                setPosition(null);
                onSecondsChange(value);
              }
            }}
          >
            <option value={60}>最近 60 秒</option>
            <option value={30}>最近 30 秒</option>
            <option value={15}>最近 15 秒</option>
          </select>
          <Icon icon={faChevronDown} />
        </label>
        <div className="hw-legend" role="group" aria-label="图表曲线">
          {SERIES.map((series) => (
            <button
              type="button"
              key={series.key}
              aria-pressed={visible.includes(series.key)}
              aria-label={`${visible.includes(series.key) ? '隐藏' : '显示'}${series.label}曲线`}
              className={!visible.includes(series.key) ? 'muted' : ''}
              onClick={() =>
                setVisible((current) =>
                  current.includes(series.key)
                    ? current.filter((key) => key !== series.key)
                    : [...current, series.key],
                )
              }
            >
              <span style={{ background: series.color }} />
              {series.label}
            </button>
          ))}
        </div>
      </div>
      <div className="hw-plot">
        <canvas
          ref={canvas}
          role="img"
          tabIndex={0}
          aria-label={`最近${seconds}秒性能趋势`}
          aria-describedby={hintId}
          onPointerMove={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            const fraction =
              (event.clientX - box.left - PADDING.left) /
              (box.width - PADDING.left - PADDING.right);
            setPosition(
              samples.length
                ? Math.min(
                    samples.length - 1,
                    Math.max(0, Math.round(fraction * (samples.length - 1))),
                  )
                : null,
            );
          }}
          onPointerLeave={() => setPosition(null)}
          onBlur={() => setPosition(null)}
          onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || !samples.length)
              return;
            event.preventDefault();
            setPosition((current) =>
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? samples.length - 1
                  : Math.min(
                      samples.length - 1,
                      Math.max(
                        0,
                        (current ?? samples.length - 1) + (event.key === 'ArrowLeft' ? -1 : 1),
                      ),
                    ),
            );
          }}
        />
        <p id={hintId} className="sr-only">
          左右方向键查看采样，Home和End跳到起点或终点。曲线仅展示已载入数据。
        </p>
        {samples.length === 0 && <p className="hw-plot-empty">尚未连接硬件监测，暂无历史数据</p>}
        {active && (
          <div className="hw-chart-tooltip" role="status">
            {new Intl.DateTimeFormat('zh-CN', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
              hour12: false,
            }).format(active.timestamp)}
            {SERIES.filter((series) => visible.includes(series.key)).map((series) => (
              <span key={series.key}>
                {series.label} {numberText(active[series.key], '%')}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="hw-network">
        <Icon icon={faWifi} />
        <div className="hw-network-title">网络速度</div>
        <div className="hw-network-value">
          <Icon icon={faArrowDown} />
          <div>
            {numberText(data.network?.downloadMBps, ' MB/s')}
            <small>下载</small>
          </div>
        </div>
        <div className="hw-network-value upload">
          <Icon icon={faArrowUp} />
          <div>
            {numberText(data.network?.uploadKBps, ' KB/s', 0)}
            <small>上传</small>
          </div>
        </div>
        <div className="hw-current-game">
          <Icon icon={faGamepad} />
          <div>
            <strong>前台进程</strong>
            <p>{data.currentGame ?? '无可读取的前台进程'}</p>
          </div>
          <span>—</span>
        </div>
      </div>
    </section>
  );
}
