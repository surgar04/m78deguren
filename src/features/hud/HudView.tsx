import { renderScene } from './presentation';
import { useRef, useState, type CSSProperties } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { CustomEase } from 'gsap/CustomEase';
import type { HudConfig, HudLive, HudRender } from '@/lib/hud-contracts';
import paths from './icons.json';
import './hud.css';

gsap.registerPlugin(useGSAP, CustomEase);
const easeIn = CustomEase.create('hud-in', '0.42,0,1,1');
const easeOut = CustomEase.create('hud-out', '0,0,0.58,1');
const easeInOut = CustomEase.create('hud-inout', '0.42,0,0.58,1');
const smooth = CustomEase.create('hud-smooth', '0.65,0,0.35,1');
const iconPaths: Readonly<Record<string, string>> = paths;
export function HudIcon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={iconPaths[name] ?? iconPaths['bolt']} fill="currentColor" fillRule="evenodd" />
    </svg>
  );
}
const number = (value: number | null | undefined, digits = 0) =>
  typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '—';
function Badge({ render }: { render: HudRender }) {
  return (
    <span className="hud-badge" style={{ color: render.accentColor }}>
      <svg
        viewBox="0 0 46 46"
        className="hud-progress"
        aria-label={
          render.progressAvailable === false
            ? '进度不可用'
            : `进度 ${Math.round(render.progress * 100)}%`
        }
      >
        <circle cx="23" cy="23" r="20" fill="#262425" />
        <circle
          className="hud-progress-arc"
          cx="23"
          cy="23"
          r="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="4.5"
          strokeLinecap="round"
          strokeDasharray={Math.PI * 40}
          strokeDashoffset={Math.PI * 40 * (1 - render.progress)}
          transform="rotate(-90 23 23)"
        />
      </svg>
      <span className="hud-badge-icon">
        <HudIcon name={render.rightIcon} />
      </span>
    </span>
  );
}
function GameReadings({ live }: { live: HudLive }) {
  const m = live.metrics;
  const cells = [
    ['CPU', `${number(m?.['cpu'])}%`],
    ['GPU', `${number(m?.['gpu'])}%`],
    ['CPU TEMP', `${number(m?.['cpuTemperature'])}°C`],
    ['GPU TEMP', `${number(m?.['gpuTemperature'])}°C`],
    ['VRAM', `${number(m?.['vramUsed'], 1)} / ${number(m?.['vramTotal'], 1)} GB`],
    ['RAM', `${number(m?.['memoryUsed'], 1)} / ${number(m?.['memoryTotal'], 1)} GB`],
    ['↓ NET', `${number(m?.['download'], 2)} MB/s`],
    ['↑ NET', `${number(m?.['upload'], 2)} MB/s`],
  ];
  return (
    <div className="hud-game">
      <div className="hud-game-heading">
        <span className="hud-game-tag">/// GAME TELEMETRY</span>
        <span className="hud-game-name">{live.gameInfo?.name ?? '手动游戏视图'}</span>
        <span className="hud-source" title={live.fps?.message}>
          ETW PRESENT
        </span>
      </div>
      <div className="hud-frame-numbers">
        <strong>
          {number(live.fps?.fps)}
          <small> FPS</small>
        </strong>
        <span>
          <b>{number(live.fps?.low1, 1)}</b>
          <small>1% LOW</small>
        </span>
        <span>
          <b>{number(live.fps?.low01, 1)}</b>
          <small>0.1% LOW</small>
        </span>
        <span className="hud-game-status" title={live.fps?.message}>
          {live.fps?.enabled ? (live.fps.fps == null ? '等待帧事件' : '实时采集') : '采样未开启'}
        </span>
      </div>
      <div className="hud-game-grid">
        {cells.map(([label, value]) => (
          <div key={label}>
            <small>{label}</small>
            <b title={value}>{value}</b>
          </div>
        ))}
      </div>
    </div>
  );
}
function Content({ live }: { live: HudLive }) {
  if (live.game) return <GameReadings live={live} />;
  const render = renderScene(live);
  const media = live.scene === '@media' || live.scene?.startsWith('@downloads');
  return (
    <>
      <span className="hud-icon">
        <span className="hud-icon-circle">
          <HudIcon name={render.leftIcon} />
        </span>
        <span className="hud-icon-square">
          <HudIcon name={render.leftIcon} />
        </span>
      </span>
      <div className={`hud-numbers ${media ? 'is-media' : ''}`}>
        <span className="hud-main-value">
          <strong title={render.primaryText}>{render.primaryText}</strong>
          <small title={render.secondaryText}>{render.secondaryText}</small>
        </span>
        <span className="hud-right-value">
          <strong>{render.rightText}</strong>
          <small>{render.rightSuffix}</small>
        </span>
        <Badge render={render} />
      </div>
    </>
  );
}
interface Props {
  config: HudConfig;
  live: HudLive;
  closing?: boolean;
  epoch?: number;
  preview?: boolean;
}
/** 旧帧仅在 820ms 翻滚过渡内保留，属于动画状态；服务数据始终来自同一个 Query。 */
export function HudView({ config, live, closing = false, epoch = 0, preview = false }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<{ current: HudLive; previous: HudLive | null }>({
    current: live,
    previous: null,
  });
  if (frame.current !== live)
    setFrame({
      current: live,
      previous: frame.current.scene !== live.scene ? frame.current : frame.previous,
    });
  const render = renderScene(live);
  const simpleScene = live.scene === '@media' || live.scene?.startsWith('@downloads');
  const animation =
    simpleScene || (!config.autoCycle && render.simpleAnimation)
      ? 'simple'
      : (live.transition ?? config.animation);
  const scene = live.scene;
  const game = live.game ?? false;
  useGSAP(
    () => {
      const media = gsap.matchMedia();
      const staticState = () => {
        gsap.set('.hud-pill', {
          opacity: 1,
          scale: 1,
          height: game ? 100 : 60 * config.fontScale,
          borderRadius: game ? 18 : 30,
        });
        gsap.set('.hud-content-new', { y: 0, opacity: 1 });
        if (!game) gsap.set('.hud-content-new .hud-icon', { left: 19, x: 0, scale: 1, opacity: 1 });
        gsap.set('.hud-icon-circle,.hud-title,.hud-ripple', { opacity: 0 });
        if (!game) gsap.set('.hud-icon-square,.hud-content-new .hud-numbers', { opacity: 1 });
      };
      const run = () => {
        const end = () =>
          setFrame((value) => (value.previous ? { ...value, previous: null } : value));
        if (closing) {
          gsap.to('.hud-shell', { scale: 0, duration: 0.18, ease: easeIn });
          return;
        }
        gsap.set('.hud-shell', { scale: 1 });
        if (config.reducedMotion) {
          staticState();
          return;
        }
        const timeline = gsap.timeline({ onComplete: end });
        if (animation === 'roll' && frame.previous && !game) {
          staticState();
          gsap.set('.hud-content-new', { y: 60 });
          timeline
            .to('.hud-content-old', { y: -60, duration: 0.36, ease: easeIn }, 0)
            .to('.hud-content-new', { y: 0, duration: 0.46, ease: easeOut }, 0.36);
          return;
        }
        if (animation === 'simple' || game) {
          staticState();
          gsap.set('.hud-pill', { opacity: 0, scale: 0.6 });
          gsap.set('.hud-content-new', { opacity: 0 });
          timeline
            .to('.hud-pill', { opacity: 1, scale: 1, duration: 0.25, ease: easeOut }, 0)
            .to('.hud-content-new', { opacity: 1, duration: 0.15, ease: easeOut }, 0.25);
          return;
        }
        // 对应 HudAnimations.cs 的 6 秒基准：TStart .04、TAppear .07、
        // TExpand .12、TMove .20、THoldB .30、TContract .36、TNumReady .42。
        // 常驻模式停在 C 状态；避免每个读数更新都重复整套入场。
        const back = CustomEase.create('hud-back', `0.175,0.885,0.32,${1 + config.bounce}`);
        const height = config.fontScale;
        gsap.set('.hud-pill', { opacity: 0, scale: 0.6, height: 60 * height, borderRadius: 30 });
        gsap.set('.hud-content-new .hud-icon', { left: 264, x: 0, scale: 0.4, opacity: 0 });
        gsap.set('.hud-icon-circle', { opacity: 0 });
        gsap.set('.hud-icon-square,.hud-numbers,.hud-title', { opacity: 0 });
        gsap.set('.hud-ripple', { opacity: 0, scale: 0, y: 16 });
        gsap.set('.hud-ripples', { x: 0 });
        timeline
          .to('.hud-pill', { opacity: 1, scale: 1, duration: 0.12, ease: back }, 0.42)
          .to(
            '.hud-pill',
            { height: 90 * height, borderRadius: 18, duration: 0.3, ease: back },
            0.42,
          )
          .to(
            '.hud-content-new .hud-icon',
            { opacity: 1, scale: 1.12, duration: 0.36, ease: back },
            0.24,
          )
          .to('.hud-content-new .hud-icon', { scale: 1, duration: 0.12, ease: easeOut }, 0.6)
          .to('.hud-icon-circle', { opacity: 1, duration: 0.18, ease: easeOut }, 0.24)
          .to('.hud-content-new .hud-icon', { x: -179, duration: 0.48, ease: smooth }, 0.72)
          .to('.hud-ripples', { x: -179, duration: 0.48, ease: smooth }, 0.72)
          .to('.hud-title', { opacity: 1, duration: 0.3, ease: easeOut }, 1.2)
          .to(
            '.hud-pill',
            { height: 60 * height, borderRadius: 30, duration: 0.36, ease: easeInOut },
            1.8,
          )
          .to('.hud-content-new .hud-icon', { x: -245, duration: 0.36, ease: smooth }, 1.8)
          .to('.hud-ripples', { x: -245, duration: 0.36, ease: smooth }, 1.8)
          .to('.hud-title,.hud-icon-circle', { opacity: 0, duration: 0.36, ease: easeInOut }, 1.8)
          .to('.hud-icon-square', { opacity: 1, duration: 0.36, ease: easeInOut }, 1.8)
          .to('.hud-content-new .hud-numbers', { opacity: 1, duration: 0.24, ease: easeOut }, 2.28);
        for (const [selector, scale, peak] of [
          ['.ripple-inner', 1.5, 0.5],
          ['.ripple-mid', 2, 0.5],
          ['.ripple-outer', 2.5, 0.6],
        ] as const) {
          timeline
            .to(
              selector,
              {
                opacity: Math.min(1, peak * config.ripple),
                scale: 0.05,
                duration: 0.12,
                ease: easeOut,
              },
              0.72,
            )
            .to(
              selector,
              { scale: scale * config.spread, y: 0, duration: 0.96, ease: easeOut },
              0.84,
            )
            .to(selector, { opacity: 0, duration: 0.36, ease: easeInOut }, 1.8);
        }
      };
      media.add('(prefers-reduced-motion: reduce)', () => {
        gsap.set('.hud-shell', { scale: closing ? 0 : 1 });
        staticState();
      });
      media.add('(prefers-reduced-motion: no-preference)', run);
      return () => media.revert();
    },
    {
      scope: root,
      dependencies: [
        scene,
        animation,
        config.bounce,
        config.ripple,
        config.spread,
        config.fontScale,
        config.reducedMotion,
        game,
        closing,
        epoch,
      ],
      revertOnUpdate: true,
    },
  );
  return (
    <div
      className={`hud-stage ${preview ? 'is-preview' : ''}`}
      ref={root}
      style={{
        width: (game ? 720 : 580) * config.scale,
        height: 180 * config.scale * config.fontScale,
      }}
    >
      <div
        className={`hud-scale ${game ? 'is-game' : ''}`}
        style={{ transform: `scale(${config.scale})` }}
      >
        <div
          className={`hud-shell ${game ? 'is-game' : ''}`}
          style={{ opacity: config.opacity, '--hud-font-scale': config.fontScale } as CSSProperties}
        >
          <div className="hud-pill">
            <div className="hud-ripples">
              <i className="hud-ripple ripple-inner" />
              <i className="hud-ripple ripple-mid" />
              <i className="hud-ripple ripple-outer" />
            </div>
          </div>
          <div className="hud-title">
            <span>{render.tagline}</span>
            <strong>{render.title}</strong>
          </div>
          <div className="hud-content-clip">
            {animation === 'roll' && frame.previous && (
              <div className="hud-content hud-content-old" aria-hidden="true">
                <Content live={frame.previous} />
              </div>
            )}
            <div className="hud-content hud-content-new">
              <Content live={live} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
