import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { executeTool } from '@/lib/desktop';
import {
  SCREEN_PATTERNS,
  crosshairSnapshotSchema,
  displaysSchema,
  screenConfigSchema,
  type ScreenConfig,
} from '@/lib/tool-contracts';
import { CrosshairCanvas } from './CrosshairCanvas';
import { Feedback } from './Feedback';
import { useToolAction, useToolQuery } from './hooks';
import './native-tools.css';

export function CrosshairOverlay() {
  const query = useToolQuery('crosshair-status', crosshairSnapshotSchema, 120);
  useEffect(() => {
    void executeTool({ operation: 'crosshair-ready' }, z.null()).catch(() => {
      /* 主窗口仍可关闭该覆盖层。 */
    });
  }, []);
  return (
    <div className="crosshair-overlay">
      {query.data && (
        <CrosshairCanvas config={query.data.config} className="crosshair-overlay-canvas" />
      )}
    </div>
  );
}

function ScreenEditor({ initial }: { initial: ScreenConfig }) {
  const [config, setConfig] = useState(initial);
  const displays = useToolQuery('displays', displaysSchema);
  const action = useToolAction();
  return (
    <div className="native-tool-panel">
      <div className="native-tool-form">
        <label>
          目标显示器
          <select
            value={config.monitor}
            onChange={(e) =>
              setConfig((current) => ({ ...current, monitor: Number(e.target.value) }))
            }
          >
            {displays.data?.map((display) => (
              <option key={display.index} value={display.index}>
                {display.name} · {display.width} × {display.height}
              </option>
            ))}
          </select>
        </label>
        <label>
          测试图样
          <select
            value={config.pattern}
            onChange={(e) => {
              const pattern = screenConfigSchema.shape.pattern.safeParse(e.target.value);
              if (pattern.success) setConfig((current) => ({ ...current, pattern: pattern.data }));
            }}
          >
            {SCREEN_PATTERNS.map((pattern) => (
              <option key={pattern.id} value={pattern.id}>
                {pattern.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          坏点测试颜色
          <input
            type="color"
            value={config.color}
            onChange={(e) => setConfig((current) => ({ ...current, color: e.target.value }))}
          />
        </label>
        <label>
          动画速度
          <input
            type="range"
            min=".1"
            max="5"
            step=".1"
            value={config.speed}
            onChange={(e) =>
              setConfig((current) => ({ ...current, speed: Number(e.target.value) }))
            }
          />
          <output>{config.speed.toFixed(1)} ×</output>
        </label>
      </div>
      <p className="native-tool-note">
        12类图样用于目测，不自动判断坏点或校准显示器。响应、刷新率和撕裂图样含动态变化；全屏窗口按
        Esc 退出，H 隐藏控件，空格切换图样。
      </p>
      <div className="native-tool-actions">
        <button
          type="button"
          className="mint-button"
          disabled={action.isPending || !displays.data?.length}
          onClick={() => action.mutate({ operation: 'screen-open', config })}
        >
          开始全屏测试
        </button>
        <button
          type="button"
          className="native-button"
          onClick={() => action.mutate({ operation: 'screen-close' })}
        >
          关闭测试窗口
        </button>
      </div>
      <Feedback pending={action.isPending} error={action.error || displays.error} />
    </div>
  );
}
export function ScreenPanel() {
  const query = useToolQuery('screen-status', screenConfigSchema);
  return query.data ? (
    <ScreenEditor initial={query.data} />
  ) : (
    <Feedback pending={query.isPending} error={query.error} />
  );
}

/** 测试图样在本机Canvas实时绘制；rAF值明确为绘制FPS，不冒充硬件标称刷新率。 */
function drawPattern(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  config: ScreenConfig,
  time: number,
  frame: number,
) {
  context.clearRect(0, 0, width, height);
  context.fillStyle = config.color;
  context.fillRect(0, 0, width, height);
  const text = (label: string, x: number, y: number, color = '#ffffff', size = 18) => {
    context.fillStyle = color;
    context.font = `${size}px MiSans, sans-serif`;
    context.fillText(label, x, y);
  };
  switch (config.pattern) {
    case 'gradient': {
      const fill = context.createLinearGradient(0, 0, width, 0);
      fill.addColorStop(0, '#000000');
      fill.addColorStop(0.25, '#ff0000');
      fill.addColorStop(0.5, '#00ff00');
      fill.addColorStop(0.75, '#0000ff');
      fill.addColorStop(1, '#ffffff');
      context.fillStyle = fill;
      context.fillRect(0, 0, width, height);
      break;
    }
    case 'response':
    case 'tearing': {
      context.fillStyle = '#202020';
      context.fillRect(0, 0, width, height);
      const x = ((time * 0.25 * config.speed) % (width + 160)) - 80;
      if (config.pattern === 'response') {
        context.fillStyle = '#ffffff';
        context.fillRect(x, height * 0.2, 80, height * 0.6);
        context.fillStyle = '#777777';
        context.fillRect((x + width * 0.4) % width, height * 0.2, 80, height * 0.6);
      } else {
        for (let row = 0; row < height; row += 24) {
          context.fillStyle = '#ffffff';
          context.fillRect((x + row * 0.3) % width, row, width * 0.25, 12);
        }
      }
      break;
    }
    case 'refresh': {
      context.fillStyle = '#161d25';
      context.fillRect(0, 0, width, height);
      context.fillStyle = '#ffffff';
      const x = (time * 0.4 * config.speed) % width;
      context.fillRect(x, 0, 8, height);
      text(`Frame ${frame}`, width * 0.4, height * 0.5);
      break;
    }
    case 'uniformity': {
      context.fillStyle = '#808080';
      context.fillRect(0, 0, width, height);
      for (let y = 0; y < 3; y++)
        for (let x = 0; x < 3; x++)
          text('50% gray', (width * (x + 0.5)) / 3 - 40, (height * (y + 0.5)) / 3, '#555555');
      break;
    }
    case 'subpixel': {
      const pixel = 1 / (devicePixelRatio || 1);
      for (let x = 0; x < width; x += pixel) {
        context.fillStyle =
          ['#ff0000', '#00ff00', '#0000ff'][Math.round(x / pixel) % 3] ?? '#000000';
        context.fillRect(x, 0, pixel, height);
      }
      break;
    }
    case 'black':
    case 'gray': {
      context.fillStyle = '#000000';
      context.fillRect(0, 0, width, height);
      for (let i = 0; i < 16; i++) {
        const value = Math.round(config.pattern === 'black' ? i * 2 : (255 * i) / 15);
        context.fillStyle = `rgb(${value} ${value} ${value})`;
        context.fillRect((width * i) / 16, 0, width / 16 + 1, height);
        text(
          String(value),
          (width * (i + 0.5)) / 16 - 8,
          height * 0.6,
          value > 128 ? '#000000' : '#ffffff',
          14,
        );
      }
      break;
    }
    case 'text': {
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);
      [10, 12, 14, 16, 20, 24, 32].forEach((size, index) =>
        text(
          '臻境 屏幕文字清晰度 The quick brown fox 0123456789',
          width * 0.12,
          height * 0.15 + index * height * 0.1,
          '#000000',
          size,
        ),
      );
      break;
    }
    case 'geometry': {
      context.fillStyle = '#111111';
      context.fillRect(0, 0, width, height);
      context.strokeStyle = '#ffffff';
      context.lineWidth = 1;
      for (let x = 0; x < width; x += 40) {
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, height);
        context.stroke();
      }
      for (let y = 0; y < height; y += 40) {
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(width, y);
        context.stroke();
      }
      context.strokeStyle = '#00e3b4';
      context.lineWidth = 3;
      context.beginPath();
      context.arc(width / 2, height / 2, Math.min(width, height) * 0.35, 0, Math.PI * 2);
      context.stroke();
      break;
    }
    case 'viewing': {
      ['#ea3333', '#27b565', '#2b60e8', '#808080'].forEach((color, index) => {
        context.fillStyle = color;
        context.fillRect(
          ((index % 2) * width) / 2,
          (Math.floor(index / 2) * height) / 2,
          width / 2,
          height / 2,
        );
      });
      context.fillStyle = '#b3b3b3';
      context.fillRect(width * 0.35, height * 0.35, width * 0.3, height * 0.3);
      break;
    }
    default:
      break;
  }
}
export function ScreenTestWindow() {
  const query = useToolQuery('screen-status', screenConfigSchema, 300);
  const action = useToolAction();
  const ref = useRef<HTMLCanvasElement>(null);
  const [fps, setFps] = useState<number | null>(null);
  const [controls, setControls] = useState(true);
  const mutate = action.mutate;
  const config = query.data;
  useEffect(() => {
    if (!config) return;
    const canvas = ref.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    let request = 0;
    let frame = 0;
    let count = 0;
    let measured = performance.now();
    let width = 0;
    let height = 0;
    let needsPaint = true;
    const animated = ['response', 'tearing', 'refresh'].includes(config.pattern);
    const resize = () => {
      width = innerWidth;
      height = innerHeight;
      const ratio = devicePixelRatio || 1;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      needsPaint = true;
    };
    const paint = (time: number) => {
      frame++;
      count++;
      if (animated || needsPaint) {
        drawPattern(context, width, height, config, time, frame);
        needsPaint = false;
      }
      if (time - measured >= 1500) {
        setFps((count * 1000) / (time - measured));
        count = 0;
        measured = time;
      }
      request = requestAnimationFrame(paint);
    };
    resize();
    window.addEventListener('resize', resize);
    request = requestAnimationFrame(paint);
    return () => {
      cancelAnimationFrame(request);
      window.removeEventListener('resize', resize);
    };
  }, [config]);
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement)
        return;
      if (event.key === 'Escape') {
        event.preventDefault();
        mutate({ operation: 'screen-close' });
      } else if (event.key.toLowerCase() === 'h') setControls((current) => !current);
      else if (event.code === 'Space' && config) {
        event.preventDefault();
        const next =
          SCREEN_PATTERNS[
            (SCREEN_PATTERNS.findIndex((item) => item.id === config.pattern) + 1) %
              SCREEN_PATTERNS.length
          ];
        if (next) mutate({ operation: 'screen-update', config: { ...config, pattern: next.id } });
      }
    };
    window.addEventListener('keydown', keys);
    return () => window.removeEventListener('keydown', keys);
  }, [mutate, config]);
  return (
    <div className="native-screen-window">
      <canvas ref={ref} aria-label="全屏显示测试图样" />
      {controls && (
        <div className="native-screen-controls">
          <label>
            图样
            <select
              aria-label="全屏测试图样"
              value={config?.pattern ?? 'pixels'}
              onChange={(e) => {
                const result = screenConfigSchema.shape.pattern.safeParse(e.target.value);
                if (config && result.success)
                  action.mutate({
                    operation: 'screen-update',
                    config: { ...config, pattern: result.data },
                  });
              }}
            >
              {SCREEN_PATTERNS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          {config?.pattern === 'pixels' && (
            <label>
              颜色
              <input
                type="color"
                value={config.color}
                onChange={(e) =>
                  action.mutate({
                    operation: 'screen-update',
                    config: { ...config, color: e.target.value },
                  })
                }
              />
            </label>
          )}
          <span>绘制FPS：{fps === null ? '测量中' : fps.toFixed(1)} · H 隐藏控件</span>
          <button type="button" onClick={() => action.mutate({ operation: 'screen-close' })}>
            退出（Esc）
          </button>
          <Feedback error={action.error || query.error} />
        </div>
      )}
    </div>
  );
}
