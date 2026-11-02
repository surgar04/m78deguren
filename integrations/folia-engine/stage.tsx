import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { motionValue } from 'framer-motion';
import { Buffer } from 'buffer';
import { z } from 'zod';
import {
  musicBackgroundSchema,
  musicLyricsSchema,
  musicStyleSchema,
  musicThemeSchema,
  musicTrackSchema,
} from '../../src/lib/music-contracts';
import VisualizerRenderer from './upstream/src/components/visualizer/VisualizerRenderer';
import {
  getVisualizerRegistryEntry,
  getVisualizerModeLabel,
  VISUALIZER_REGISTRY,
} from './upstream/src/components/visualizer/registry';
import {
  collectVisualizerTunings,
  getVisualizerTuning,
  getBackgroundTunings,
} from './upstream/src/components/visualizer/tuningRegistry';
import { useVisualizerSettingsStore } from './upstream/src/stores/useVisualizerSettingsStore';
import { useVisualizerBackgroundConfig } from './upstream/src/components/visualizer/useVisualizerBackgroundConfig';
import {
  getVisualizerBackgroundModeLabel,
  getVisualizerBackgroundRegistryEntry,
  VISUALIZER_BACKGROUND_REGISTRY,
} from './upstream/src/components/visualizer/backgrounds/registry';
import { useThemeSettingsStore } from './upstream/src/stores/useThemeSettingsStore';
import i18n from './upstream/src/i18n/config';
import type { AudioBands, Line, Theme } from './upstream/src/types';
import './upstream/src/index.css';
import './stage.css';
import { connectEmbeds, receiveEmbed } from './embed';
import { useAppPreferences } from './upstream/src/hooks/useAppPreferences';
import { GraphicsBoundary } from './GraphicsBoundary';
import { VISUALIZER_FRAME_RATE_STORAGE_KEY } from './upstream/src/utils/frameRateLimiter';
import { configureGraphics } from './performance';

// 原始渲染器在独立文档中运行，防止 Tailwind 全局样式改变臻境的普通页面。
Object.assign(globalThis, { Buffer });
const stateSchema = z.object({
  renderPolicy: z.enum(['auto', 'original', 'efficient']).default('auto'),
  kind: z.literal('state'),
  track: musicTrackSchema,
  lyrics: musicLyricsSchema,
  style: musicStyleSchema,
  background: musicBackgroundSchema,
  theme: musicThemeSchema,
  daylight: z.boolean(),
});
const clockSchema = z.object({
  kind: z.literal('clock'),
  seconds: z.number().finite().nonnegative(),
  paused: z.boolean(),
  power: z.number().finite().min(0).max(255),
  bands: z.array(z.number().finite().min(0).max(255)).length(5),
  spectrum: z.array(z.number().int().min(0).max(255)).max(2048),
});
type StageState = z.infer<typeof stateSchema>;
type Clock = z.infer<typeof clockSchema>;
const initialClock: Clock = {
  kind: 'clock',
  seconds: 0,
  paused: true,
  power: 0,
  bands: [0, 0, 0, 0, 0],
  spectrum: [],
};

/** 用二分查找更新当前行；逐帧时间与频谱写 MotionValue，React 只在换行或用户改设置时更新。 */
function lineAt(lines: StageState['lyrics']['lines'], seconds: number): number {
  let low = 0,
    high = lines.length - 1,
    result = -1;
  while (low <= high) {
    const mid = (low + high) >>> 1,
      line = lines[mid];
    if (line && line.startTime <= seconds) {
      result = mid;
      low = mid + 1;
    } else high = mid - 1;
  }
  return result;
}

function Stage() {
  // 原项目的图片、群唱头像与字体恢复逻辑也属于视觉呈现，不只迁入着色器。
  useAppPreferences();
  const [state, setState] = useState<StageState | null>(null);
  const [paused, setPaused] = useState(true);
  const [line, setLine] = useState(-1);
  const [controls, setControls] = useState(true);
  const [manualHidden, setManualHidden] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const clock = useRef({ value: initialClock, arrived: performance.now() });
  const data = useRef(state);
  data.current = state;
  const port = useRef<MessagePort | null>(null);
  const policy = useRef<string | null>(null);
  const hide = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentTime = useMemo(() => motionValue(0), []);
  const audioPower = useMemo(() => motionValue(0), []);
  const audioBands: AudioBands = useMemo(
    () => ({
      bass: motionValue(0),
      lowMid: motionValue(0),
      mid: motionValue(0),
      vocal: motionValue(0),
      treble: motionValue(0),
      spectrum: motionValue<Uint8Array<ArrayBuffer>>(new Uint8Array(256)),
    }),
    [],
  );
  const settings = useVisualizerSettingsStore();
  useEffect(() => {
    if (localStorage.getItem(VISUALIZER_FRAME_RATE_STORAGE_KEY) === null)
      useVisualizerSettingsStore.getState().handleSetVisualizerFrameRate(60);
  }, []);
  const background = useVisualizerBackgroundConfig();
  const tunings = useMemo(() => collectVisualizerTunings({ ...settings }), [settings]);
  const notify = (message: object) => port.current?.postMessage(message);
  const reveal = (event?: React.SyntheticEvent) => {
    if (manualHidden) return;
    setControls(true);
    if (hide.current) clearTimeout(hide.current);
    // 鼠标或键盘正在操作工具栏时保持显示，不能在用户准备点击时把控件收走。
    if (
      event?.target instanceof Element &&
      event.target.closest('.zj-stage-chrome,.zj-stage-settings')
    ) {
      hide.current = null;
      return;
    }
    hide.current = setTimeout(() => setControls(false), 2800);
  };
  useEffect(() => {
    hide.current = setTimeout(() => setControls(false), 2800);
    // MessagePort 由宿主明确移交。消息只从父窗口接收，外部网页和导航背景不能接入时钟。
    const connect = (event: MessageEvent<unknown>) => {
      if (event.source !== window.parent || event.data !== 'zhenjing-music-stage-connect') return;
      const channel = event.ports[0];
      if (!channel || port.current) return;
      port.current = channel;
      connectEmbeds((message) => channel.postMessage(message));
      channel.onmessage = (incoming: MessageEvent<unknown>) => {
        if (receiveEmbed(incoming.data)) return;
        const time = clockSchema.safeParse(incoming.data);
        if (time.success) {
          clock.current = { value: time.data, arrived: performance.now() };
          setPaused((previous) => (previous === time.data.paused ? previous : time.data.paused));
          audioPower.set(time.data.power);
          audioBands.bass.set(time.data.bands[0] ?? 0);
          audioBands.lowMid.set(time.data.bands[1] ?? 0);
          audioBands.mid.set(time.data.bands[2] ?? 0);
          audioBands.vocal.set(time.data.bands[3] ?? 0);
          audioBands.treble.set(time.data.bands[4] ?? 0);
          audioBands.spectrum?.set(Uint8Array.from(time.data.spectrum));
          return;
        }
        const next = stateSchema.safeParse(incoming.data);
        if (next.success) {
          const profile = configureGraphics(next.data.renderPolicy);
          if (policy.current !== next.data.renderPolicy) {
            policy.current = next.data.renderPolicy;
            useVisualizerSettingsStore
              .getState()
              .handleSetLyricRenderQuality({ scale: profile.efficient ? 0.5 : 1 });
          }
          setState(next.data);
          const held = useVisualizerSettingsStore.getState();
          held.handleSetVisualizerMode(next.data.style, { notify: false });
          held.handleSetVisualizerBackgroundMode(
            profile.efficient || (!profile.available && next.data.renderPolicy === 'auto')
              ? 'common'
              : next.data.background,
          );
        }
      };
      channel.start();
      channel.postMessage({
        kind: 'ready',
        styles: VISUALIZER_REGISTRY.map((entry) => entry.mode),
      });
    };
    window.addEventListener('message', connect);
    window.parent.postMessage('zhenjing-music-stage-ready', window.location.origin);
    return () => {
      window.removeEventListener('message', connect);
      port.current?.close();
      if (hide.current) clearTimeout(hide.current);
    };
  }, [audioBands, audioPower]);
  useEffect(() => {
    let frame = 0,
      lastLine = -2;
    const advance = () => {
      const held = clock.current,
        elapsed = held.value.paused ? 0 : Math.min(2, (performance.now() - held.arrived) / 1000);
      const seconds = held.value.seconds + elapsed;
      currentTime.set(seconds);
      const index = lineAt(data.current?.lyrics.lines ?? [], seconds);
      if (index !== lastLine) {
        lastLine = index;
        setLine(index);
      }
      frame = requestAnimationFrame(advance);
    };
    frame = requestAnimationFrame(advance);
    return () => cancelAnimationFrame(frame);
  }, [currentTime]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        event.code === 'KeyH' &&
        !event.repeat &&
        !(event.target instanceof HTMLElement && event.target.closest('input,select,textarea'))
      ) {
        event.preventDefault();
        setManualHidden((previous) => !previous);
        setSettingsOpen(false);
        setControls(true);
      }
      if (event.key === 'Escape') {
        if (settingsOpen) setSettingsOpen(false);
        else notify({ kind: 'exit' });
      }
      if (
        event.code === 'Space' &&
        event.target instanceof HTMLElement &&
        !event.target.closest('input,select,textarea,button')
      ) {
        event.preventDefault();
        notify({ kind: 'toggle' });
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [settingsOpen]);
  if (!state)
    return (
      <div className="zj-stage-loading" role="status">
        正在准备沉浸演绎…
      </div>
    );
  const mode = settings.visualizerMode;
  const entry = getVisualizerRegistryEntry(mode),
    tuning = getVisualizerTuning(mode);
  const selectedTuning: unknown = tuning ? Reflect.get(settings, tuning.settingsKey) : {};
  const theme: Theme = { ...state.theme };
  const lines: Line[] = state.lyrics.lines;
  const onTuningChange = (patch: object) => {
    const setter: unknown = tuning ? Reflect.get(settings, tuning.settingsSetterKey) : undefined;
    if (typeof setter === 'function') Reflect.apply(setter, undefined, [patch]);
  };
  const backgroundActions = {
    ...Object.fromEntries(
      getBackgroundTunings().map((item) => [
        item.mode,
        {
          onTuningChange: (patch: object) => {
            const setter: unknown = Reflect.get(settings, item.settingsSetterKey);
            if (typeof setter === 'function') Reflect.apply(setter, undefined, [patch]);
          },
          onResetTuning: () => {
            const reset: unknown = Reflect.get(settings, item.settingsResetterKey);
            if (typeof reset === 'function') Reflect.apply(reset, undefined, []);
          },
        },
      ]),
    ),
    common: {
      onCoverColorChange: useThemeSettingsStore.getState().handleToggleCoverColorBg,
      onOpacityChange: settings.handleSetBackgroundOpacity,
      onDisableGeometricChange: settings.handleToggleDisableVisualizerGeometricBackground,
      onDisableVignetteChange: settings.handleToggleDisableVisualizerVignette,
    },
    customImage: {
      onUpload: settings.handleUploadMonetBackgroundImage,
      onClear: settings.handleClearMonetBackgroundImage,
    },
    url: {
      onAdd: settings.handleAddUrlBackgroundItem,
      onUpdate: settings.handleUpdateUrlBackgroundItem,
      onDelete: settings.handleDeleteUrlBackgroundItem,
      onSelect: settings.handleSetUrlBackgroundSelectedId,
    },
  };
  return (
    <div
      className={`zj-stage ${!manualHidden && (controls || settingsOpen) ? 'zj-controls-visible' : ''}`}
      onPointerMove={reveal}
      style={{ background: theme.backgroundColor, color: theme.primaryColor }}
    >
      <GraphicsBoundary
        resetKey={`${mode}:${background.mode}:${state.renderPolicy}`}
        onFallback={() => {
          settings.handleSetVisualizerMode('still');
          settings.handleSetVisualizerBackgroundMode('common');
          notify({ kind: 'style', style: 'still' });
          notify({ kind: 'background', background: 'common' });
        }}
      >
        <VisualizerRenderer
          mode={mode}
          currentTime={currentTime}
          duration={state.track.durationMs / 1000}
          currentLineIndex={line}
          lines={lines}
          theme={theme}
          isDaylight={state.daylight}
          audioPower={audioPower}
          audioBands={audioBands}
          paused={paused}
          songTitle={state.track.title}
          songArtist={state.track.artists.join(' / ')}
          songAlbum={state.track.album}
          coverUrl={state.track.cover}
          seed={state.track.key}
          background={background}
          visualizerTunings={tunings}
          onVisualizerTuningChange={onTuningChange}
          animateStyleSwitch
          showText
          isPlayerChromeHidden={manualHidden || !controls}
          showSubtitleTranslation
          showHarmonySubtitle
          onLyricLineSeek={(seconds) => notify({ kind: 'seek', seconds })}
          onBack={() => notify({ kind: 'exit' })}
        />
      </GraphicsBoundary>
      <div
        className="zj-stage-chrome"
        inert={manualHidden || !(controls || settingsOpen)}
        onPointerEnter={reveal}
        onPointerLeave={() => reveal()}
        onFocusCapture={reveal}
        onBlurCapture={(event) => {
          if (!(
            event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)
          ))
            reveal();
        }}
      >
        <button type="button" onClick={() => notify({ kind: 'exit' })}>
          退出沉浸演绎 <kbd>Esc</kbd>
        </button>
        <span>
          {state.track.title} · {state.track.artists.join(' / ')}
        </span>
        <button type="button" onClick={() => notify({ kind: 'previous' })} aria-label="上一曲">
          上一曲
        </button>
        <button type="button" onClick={() => notify({ kind: 'toggle' })}>
          {paused ? '播放' : '暂停'}
        </button>
        <button type="button" onClick={() => notify({ kind: 'next' })} aria-label="下一曲">
          下一曲
        </button>
        <button type="button" onClick={() => setSettingsOpen((value) => !value)}>
          演绎设置
        </button>
        <button
          type="button"
          onClick={() => {
            setManualHidden(true);
            setSettingsOpen(false);
          }}
          title="按 H 重新显示；Esc 退出"
        >
          隐藏操作栏 <kbd>H</kbd>
        </button>
      </div>
      {settingsOpen && (
        <aside className="zj-stage-settings" aria-label="演绎设置">
          <div className="zj-stage-settings-heading">
            <h2>沉浸演绎</h2>
            <button type="button" onClick={() => setSettingsOpen(false)}>
              关闭
            </button>
          </div>
          <label>
            渲染策略
            <select
              aria-label="渲染策略"
              value={state.renderPolicy}
              onChange={(event) =>
                notify({
                  kind: 'policy',
                  policy: z.enum(['auto', 'original', 'efficient']).parse(event.target.value),
                })
              }
            >
              <option value="auto">自动 · 软件显卡使用低开销</option>
              <option value="original">原画 · 上游完整像素预算</option>
              <option value="efficient">低开销 · 通用背景与较低采样</option>
            </select>
          </label>
          {configureGraphics(state.renderPolicy).efficient && (
            <p>当前使用通用背景降低图形开销；切换“原画”可恢复已选择的动态背景与完整采样。</p>
          )}
          <label>
            歌词样式
            <select
              aria-label="歌词样式"
              value={mode}
              onChange={(event) => {
                const selected = musicStyleSchema.safeParse(event.target.value);
                if (selected.success) {
                  settings.handleSetVisualizerMode(selected.data);
                  notify({ kind: 'style', style: selected.data });
                }
              }}
            >
              {VISUALIZER_REGISTRY.map((item) => (
                <option key={item.mode} value={item.mode}>
                  {getVisualizerModeLabel(item.mode, (key) => String(i18n.t(key)))}
                </option>
              ))}
            </select>
          </label>
          <label>
            动态背景
            <select
              aria-label="动态背景"
              disabled={configureGraphics(state.renderPolicy).efficient}
              value={background.mode ?? 'latent'}
              onChange={(event) => {
                const selected = musicBackgroundSchema.safeParse(event.target.value);
                if (selected.success) {
                  settings.handleSetVisualizerBackgroundMode(selected.data);
                  notify({ kind: 'background', background: selected.data });
                }
              }}
            >
              {VISUALIZER_BACKGROUND_REGISTRY.map((item) => (
                <option key={item.mode} value={item.mode}>
                  {getVisualizerBackgroundModeLabel(item.mode, (key) => String(i18n.t(key)))}
                </option>
              ))}
            </select>
          </label>
          <label>
            渲染帧率
            <select
              aria-label="渲染帧率"
              value={settings.visualizerFrameRate}
              onChange={(event) => {
                const rate = z
                  .union([z.literal('off'), z.literal('60'), z.literal('90'), z.literal('120')])
                  .parse(event.target.value);
                settings.handleSetVisualizerFrameRate(
                  rate === 'off'
                    ? 'off'
                    : Number(rate) === 60
                      ? 60
                      : Number(rate) === 90
                        ? 90
                        : 120,
                );
              }}
            >
              <option value="60">60 FPS · 省资源</option>
              <option value="90">90 FPS</option>
              <option value="120">120 FPS</option>
              <option value="off">跟随屏幕</option>
            </select>
          </label>
          <label>
            歌词画质
            <select
              aria-label="歌词画质"
              value={settings.lyricRenderQuality.scale}
              onChange={(event) => {
                const scale = z.coerce
                  .number()
                  .pipe(
                    z.union([
                      z.literal(0.5),
                      z.literal(0.75),
                      z.literal(1),
                      z.literal(1.5),
                      z.literal(2),
                    ]),
                  )
                  .parse(event.target.value);
                settings.handleSetLyricRenderQuality({ scale });
              }}
            >
              <option value="0.5">流畅 · 50% 分辨率</option>
              <option value="0.75">均衡 · 75% 分辨率</option>
              <option value="1">原画 · 100% 分辨率</option>
              <option value="1.5">精细 · 150% 分辨率</option>
              <option value="2">超采样 · 200% 分辨率</option>
            </select>
          </label>
          {entry.renderSettingsPanel?.({
            t: (key) => String(i18n.t(key)),
            isDaylight: state.daylight,
            theme,
            controlCardBg: 'rgba(125,125,125,.12)',
            rangeInputClass: 'w-full',
            tuning: selectedTuning,
            onTuningChange,
            settings,
          })}
          <h3>背景参数</h3>
          {getVisualizerBackgroundRegistryEntry(background.mode ?? 'latent').renderSettingsPanel?.({
            config: background,
            actions: backgroundActions,
            t: (key) => String(i18n.t(key)),
            isDaylight: state.daylight,
            theme,
            controlCardBg: 'rgba(125,125,125,.12)',
            rangeInputClass: 'w-full',
          })}
        </aside>
      )}
    </div>
  );
}
const root = document.getElementById('root');
if (!root) throw Error('沉浸演绎挂载点缺失');
createRoot(root).render(<Stage />);
