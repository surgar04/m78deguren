import { useRef, useState } from 'react';
import { z } from 'zod';
import {
  audioPresetSchema,
  audioSnapshotSchema,
  eqConfigSchema,
  type EqConfig,
} from '@/lib/builtin-contracts';
import { useBuiltinAction, useBuiltinQuery } from './builtin-hooks';
import { Feedback } from './Feedback';
import { SystemChangeHistory, SystemChangeReview } from './SystemChangeReview';
import { useSystemChange } from './use-system-change';
import { eqResponse, frequencies } from './eq-model';

const EFFECTS = [
  { key: 'clarity', label: '清晰度' },
  { key: 'ambience', label: '环境' },
  { key: 'width', label: '立体声宽度' },
  { key: 'dynamics', label: '动态压缩' },
  { key: 'bass', label: '低音' },
] as const;
function Editor({ config }: { config: EqConfig }) {
  const [draft, setDraft] = useState(config);
  const [source, setSource] = useState('');
  const [output, setOutput] = useState('');
  const [consent, setConsent] = useState(false);
  const [name, setName] = useState('我的音频预设');
  const [fileError, setFileError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const status = useBuiltinQuery({ operation: 'audio-status' }, audioSnapshotSchema, 1000);
  const presets = useBuiltinQuery({ operation: 'audio-presets' }, z.array(audioPresetSchema));
  const action = useBuiltinAction(z.null()),
    save = useBuiltinAction(audioPresetSchema),
    exportPreset = useBuiltinAction(z.object({ path: z.string() }));
  const control = useSystemChange();
  const valid = eqConfigSchema.safeParse(draft);
  const selected =
    status.data?.devices.find((value) => value.id === source) ??
    status.data?.devices.find(
      (value) => value.flow === 'loopback' && value.name.toLocaleLowerCase().includes('fxsound'),
    );
  const outputs =
    status.data?.devices.filter(
      (value) => value.flow === 'loopback' && value.id !== selected?.id,
    ) ?? [];
  const sink =
    outputs.find((value) => value.id === output) ??
    outputs.find((value) => !value.virtualDevice && value.defaultDevice) ??
    outputs.find((value) => !value.virtualDevice);
  const busy = action.isPending || control.busy;
  const [prepared, setPrepared] = useState(false);
  const bandCount = (count: number) =>
    setDraft((value) => ({
      ...value,
      bands: frequencies(count).map((frequency) => ({
        frequency,
        gain: value.bands.reduce(
          (nearest, band) =>
            Math.abs(Math.log(band.frequency / frequency)) <
            Math.abs(Math.log(nearest.frequency / frequency))
              ? band
              : nearest,
          value.bands[0] ?? { frequency, gain: 0 },
        ).gain,
      })),
    }));
  const curve = valid.success
    ? Array.from({ length: 160 }, (_, index) => {
        const frequency = 20 * 1000 ** (index / 159);
        return `${30 + (index * 740) / 159},${120 - eqResponse(valid.data, frequency) * 2.6}`;
      }).join(' ')
    : '';
  async function importFile(file: File) {
    setFileError('');
    try {
      if (file.size > 262144) throw new Error('预设不能超过 256 KB');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const decoder = new TextDecoder(
        bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : 'utf-8',
        { fatal: true },
      );
      save.mutate({ operation: 'audio-preset-import', content: decoder.decode(bytes) });
    } catch (cause) {
      setFileError(cause instanceof Error ? cause.message : '预设无法读取');
    }
  }
  return (
    <div className="native-tool-panel">
      <div className="native-status-banner">
        <strong>{status.data?.running ? '音频引擎运行中' : '音频引擎已停止'}</strong>
        <span>
          输出峰值 {status.data ? Math.round(status.data.peak * 100) + '%' : '—'} · 欠载帧{' '}
          {status.data?.underruns ?? '—'} · 丢弃帧 {status.data?.dropped ?? '—'}
        </span>
      </div>
      <div className="native-tool-form">
        <label>
          输入 / 回环捕获
          <select
            value={selected?.id ?? ''}
            disabled={status.data?.running || busy}
            onChange={(e) => {
              setSource(e.target.value);
              setConsent(false);
            }}
          >
            <option value="" disabled>
              选择输入
            </option>
            {status.data?.devices.map((value) => (
              <option key={value.id} value={value.id}>
                {value.flow === 'loopback' ? '回环' : '录音'} · {value.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          实际播放设备
          <select
            value={sink?.id ?? ''}
            disabled={status.data?.running || busy}
            onChange={(e) => {
              setOutput(e.target.value);
              setConsent(false);
            }}
          >
            <option value="" disabled>
              选择物理输出
            </option>
            {outputs.map((value) => (
              <option key={value.id} value={value.id}>
                {value.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="native-tool-note">
        系统音频 EQ：将游戏或 Windows 播放输出设为 FxSound
        虚拟设备，再在这里选择真实耳机/音箱。引擎不自动改变系统默认设备；停止后可在 Windows
        声音设置中切回物理设备。录音设备会捕获对应输入，请确认后启动。
      </p>
      <label className="native-checkbox">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          disabled={busy || status.data?.running}
        />
        确认捕获所选来源，并将处理后的声音播放到所选设备
      </label>
      <div className="native-tool-actions">
        <button
          type="button"
          className="mint-button"
          disabled={!selected || !sink || !consent || busy || status.data?.running}
          onClick={() => {
            if (selected && sink)
              action.mutate({
                operation: 'audio-start',
                input: selected.id,
                output: sink.id,
                capture: selected.flow === 'capture',
                consent: true,
              });
          }}
        >
          启动音频引擎
        </button>
        <button
          type="button"
          className="native-button"
          disabled={busy}
          onClick={() => action.mutate({ operation: 'audio-stop' })}
        >
          停止音频引擎
        </button>
        <button
          type="button"
          className="native-button"
          disabled={busy}
          onClick={() => {
            void status.refetch();
          }}
        >
          重新扫描设备
        </button>
      </div>
      <Feedback
        pending={busy || save.isPending || exportPreset.isPending}
        error={
          status.error ?? action.error ?? save.error ?? exportPreset.error ?? (fileError || null)
        }
      />
      {status.data?.message && <p role="status">{status.data.message}</p>}
      <section className="native-device-card">
        <div className="native-tool-actions">
          <h4>均衡器</h4>
          {[5, 10, 15, 20, 31].map((count) => (
            <button
              key={count}
              type="button"
              className={draft.bands.length === count ? 'mint-button' : 'native-button'}
              onClick={() => bandCount(count)}
            >
              {count} 段
            </button>
          ))}
          <label className="native-checkbox">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(e) => setDraft((value) => ({ ...value, enabled: e.target.checked }))}
            />
            启用 EQ
          </label>
        </div>
        <svg
          className="native-eq-curve"
          viewBox="0 0 800 230"
          role="img"
          aria-label="EQ 稳态频率响应曲线"
        >
          <title>EQ 稳态频率响应，不代表实时音频频谱</title>
          {[-24, -12, 0, 12, 24].map((db) => (
            <g key={db}>
              <line x1="30" x2="770" y1={120 - db * 2.6} y2={120 - db * 2.6} stroke="#cbdce5" />
              <text x="1" y={123 - db * 2.6} fontSize="11" fill="#5e7891">
                {db}
              </text>
            </g>
          ))}
          <polyline points={curve} fill="none" stroke="#00b89b" strokeWidth="2.5" />
          <text x="30" y="220" fontSize="12" fill="#5e7891">
            20 Hz
          </text>
          <text x="725" y="220" fontSize="12" fill="#5e7891">
            20 kHz
          </text>
        </svg>
        <div className="native-eq-bands">
          {draft.bands.map((band, index) => (
            <label key={index}>
              <span>
                {band.frequency >= 1000 ? `${(band.frequency / 1000).toFixed(1)}k` : band.frequency}{' '}
                Hz
              </span>
              <input
                aria-label={`频段 ${index + 1} 增益`}
                type="range"
                min={-24}
                max={24}
                step={0.5}
                value={band.gain}
                onChange={(e) =>
                  setDraft((value) => ({
                    ...value,
                    bands: value.bands.map((item, n) =>
                      n === index ? { ...item, gain: Number(e.target.value) } : item,
                    ),
                  }))
                }
              />
              <input
                aria-label={`频段 ${index + 1} 频率`}
                type="number"
                min={20}
                max={20000}
                value={band.frequency}
                onChange={(e) =>
                  setDraft((value) => ({
                    ...value,
                    bands: value.bands.map((item, n) =>
                      n === index ? { ...item, frequency: Number(e.target.value) } : item,
                    ),
                  }))
                }
              />
              <output>{band.gain.toFixed(1)} dB</output>
            </label>
          ))}
        </div>
        <div className="native-tool-form">
          <label>
            前级增益 {draft.preamp.toFixed(1)} dB
            <input
              type="range"
              min={-24}
              max={12}
              step={0.5}
              value={draft.preamp}
              onChange={(e) => setDraft((value) => ({ ...value, preamp: Number(e.target.value) }))}
            />
          </label>
          <label className="native-checkbox">
            <input
              type="checkbox"
              checked={draft.headroom}
              onChange={(e) => setDraft((value) => ({ ...value, headroom: e.target.checked }))}
            />
            自动预留增益余量
          </label>
        </div>
      </section>
      <section className="native-device-card">
        <h4>音效</h4>
        <div className="native-tool-form">
          {EFFECTS.map((effect) => (
            <label key={effect.key}>
              {effect.label} {Math.round(draft.effects[effect.key] * 100)}%
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={draft.effects[effect.key]}
                onChange={(e) =>
                  setDraft((value) => ({
                    ...value,
                    effects: { ...value.effects, [effect.key]: Number(e.target.value) },
                  }))
                }
              />
            </label>
          ))}
        </div>
      </section>
      <div className="native-tool-actions">
        <button
          type="button"
          className="mint-button"
          disabled={!valid.success || busy}
          onClick={() => action.mutate({ operation: 'audio-configure', config: draft })}
        >
          应用音频参数
        </button>
        <button
          type="button"
          className="native-button"
          onClick={() =>
            setDraft((value) => ({
              ...value,
              preamp: 0,
              bands: value.bands.map((band) => ({ ...band, gain: 0 })),
              effects: { clarity: 0, width: 0, ambience: 0, dynamics: 0, bass: 0 },
            }))
          }
        >
          重置为平直
        </button>
      </div>
      {!valid.success && <p role="alert">频率必须递增，频段与增益需处于允许范围内。</p>}
      <section className="native-device-card">
        <h4>预设与导入导出</h4>
        <div className="native-tool-actions">
          <label>
            预设名称
            <input maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <button
            type="button"
            className="native-button"
            disabled={!valid.success || !name.trim() || save.isPending}
            onClick={() => save.mutate({ operation: 'audio-preset-save', name, config: draft })}
          >
            保存用户预设
          </button>
          <button
            type="button"
            className="native-button"
            disabled={save.isPending}
            onClick={() => inputRef.current?.click()}
          >
            导入 JSON / FAC
          </button>
          <input
            hidden
            ref={inputRef}
            type="file"
            accept=".json,.fac"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void importFile(file);
              e.target.value = '';
            }}
          />
          {[false, true].map((fac) => (
            <button
              key={String(fac)}
              type="button"
              className="native-button"
              disabled={!valid.success || !name.trim() || exportPreset.isPending}
              onClick={() =>
                exportPreset.mutate({ operation: 'audio-preset-export', name, config: draft, fac })
              }
            >
              导出 {fac ? 'FAC' : '完整 JSON'}
            </button>
          ))}
        </div>
        <p className="native-tool-note">
          FAC 交换 EQ 与五种音效；前级增益、余量和程序选项请用完整 JSON 保存。
        </p>
        <Feedback error={presets.error} />
        <div className="native-tool-list">
          {presets.data?.map((preset) => (
            <div key={preset.id} className="native-tool-list-row">
              <button
                type="button"
                className="native-button"
                onClick={() => {
                  setDraft(preset.config);
                  setName(preset.name);
                }}
              >
                {preset.name} · {preset.config.bands.length} 段
              </button>
              <button
                type="button"
                className="native-button"
                disabled={action.isPending}
                onClick={() => action.mutate({ operation: 'audio-preset-remove', id: preset.id })}
              >
                删除预设
              </button>
            </div>
          ))}
        </div>
      </section>
      <section className="native-device-card">
        <h4>虚拟音频驱动</h4>
        <p className="native-tool-note">
          驱动包下载、哈希和微软 WHQL 校验通过后，再单独确认安装或移除。移除后驱动包保留，便于恢复。
        </p>
        <div className="native-tool-actions">
          <button
            type="button"
            className="native-button"
            disabled={busy}
            onClick={() =>
              action.mutate(
                { operation: 'audio-driver-prepare' },
                { onSuccess: () => setPrepared(true) },
              )
            }
          >
            准备并验证官方驱动包
          </button>
          <button
            type="button"
            className="native-button"
            disabled={!prepared || busy || status.data?.running}
            onClick={() => control.prepare({ kind: 'audio-driver', install: true })}
          >
            预览安装虚拟设备
          </button>
          <button
            type="button"
            className="native-button"
            disabled={!prepared || busy || status.data?.running}
            onClick={() => control.prepare({ kind: 'audio-driver', install: false })}
          >
            预览移除虚拟设备
          </button>
        </div>
      </section>
      <SystemChangeReview control={control} />
      <SystemChangeHistory control={control} />
    </div>
  );
}
export function AudioPanel() {
  const query = useBuiltinQuery({ operation: 'audio-status' }, audioSnapshotSchema);
  return (
    <>
      <Feedback pending={query.isPending} error={query.error} />
      {query.data && <Editor config={query.data.config} />}
    </>
  );
}
