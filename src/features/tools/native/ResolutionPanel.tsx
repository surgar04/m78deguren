import { useState } from 'react';
import { z } from 'zod';
import {
  displaySnapshotSchema,
  displaySwitchSchema,
  displayHistorySchema,
} from '@/lib/builtin-contracts';
import { useBuiltinAction, useBuiltinQuery } from './builtin-hooks';
import { Feedback } from './Feedback';

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
/** 模式来自当前显示驱动；自定义值仍需通过 Windows CDS_TEST，并由独立看门狗恢复。 */
export function ResolutionPanel() {
  const displays = useBuiltinQuery({ operation: 'query', tool: 'displays' }, displaySnapshotSchema);
  const progress = useBuiltinQuery({ operation: 'display-status' }, displaySwitchSchema, 300);
  const action = useBuiltinAction(z.null());
  const history = useBuiltinQuery({ operation: 'display-history' }, displayHistorySchema);
  const [restoreId, setRestoreId] = useState('');
  const [restoreConsent, setRestoreConsent] = useState(false);
  const [monitorId, setMonitorId] = useState('');
  const [width, setWidth] = useState(1920);
  const [height, setHeight] = useState(1080);
  const [refresh, setRefresh] = useState(60);
  const [consent, setConsent] = useState(false);
  const monitor =
    displays.data?.monitors.find((value) => value.id === monitorId) ?? displays.data?.monitors[0];
  const valid =
    Number.isInteger(width) &&
    width >= 320 &&
    width <= 16384 &&
    Number.isInteger(height) &&
    height >= 200 &&
    height <= 16384 &&
    Number.isInteger(refresh) &&
    refresh >= 20 &&
    refresh <= 1000;
  const divisor = valid ? gcd(width, height) : 1;
  const busy =
    action.isPending ||
    progress.data?.phase === 'preparing' ||
    progress.data?.phase === 'confirming';
  return (
    <div className="native-tool-panel">
      <Feedback
        pending={displays.isPending}
        error={displays.error ?? progress.error ?? action.error}
      />
      <p className="native-tool-note">
        切换后有 15
        秒确认。没有确认、应用退出或超时都会恢复原模式；只有点击“保留此模式”才会写入持久设置。
      </p>
      <details className="native-tool-confirm">
        <summary>历史模式与恢复入口</summary>
        <p>
          选取原显示器的历史备份后重新验证，恢复也有 15 秒自动回退保护。切换模式前请停止显示滤镜。
        </p>
        <select
          aria-label="选择显示模式备份"
          value={restoreId}
          onChange={(e) => {
            setRestoreId(e.target.value);
            setRestoreConsent(false);
          }}
        >
          <option value="">选择备份</option>
          {history.data?.map((row) => (
            <option key={row.id} value={row.id}>
              {row.width} × {row.height} · {row.refresh} Hz · {row.state} · {row.id.slice(0, 8)}
            </option>
          ))}
        </select>
        <label className="native-checkbox">
          <input
            type="checkbox"
            checked={restoreConsent}
            onChange={(e) => setRestoreConsent(e.target.checked)}
          />
          确认临时恢复此备份对应显示器的模式
        </label>
        <button
          type="button"
          className="native-button"
          disabled={!restoreId || !restoreConsent || busy}
          onClick={() =>
            action.mutate({ operation: 'display-restore', id: restoreId, consent: true })
          }
        >
          验证并恢复历史模式
        </button>
        <Feedback error={history.error} />
      </details>
      <label>
        目标显示器
        <select
          value={monitor?.id ?? ''}
          disabled={busy}
          onChange={(e) => {
            setMonitorId(e.target.value);
            setConsent(false);
          }}
        >
          {displays.data?.monitors.map((value) => (
            <option key={value.id} value={value.id}>
              {value.name}
              {value.primary ? ' · 主屏幕' : ''} · {value.device}
            </option>
          ))}
        </select>
      </label>
      {monitor && (
        <>
          <p>
            当前：{monitor.width} × {monitor.height} · {monitor.refresh} Hz
          </p>
          <label>
            驱动提供的模式
            <select
              defaultValue=""
              disabled={busy}
              onChange={(e) => {
                const index = Number(e.target.value);
                const mode = monitor.modes[index];
                if (mode) {
                  setWidth(mode.width);
                  setHeight(mode.height);
                  setRefresh(mode.refresh);
                  setConsent(false);
                }
              }}
            >
              <option value="" disabled>
                选择模式，或在下方输入自定义值
              </option>
              {monitor.modes.map((mode, index) => (
                <option key={`${mode.width}:${mode.height}:${mode.refresh}`} value={index}>
                  {mode.width} × {mode.height} · {mode.refresh} Hz
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      <div className="native-tool-form">
        {[
          { label: '宽度', value: width, set: setWidth, min: 320, max: 16384 },
          { label: '高度', value: height, set: setHeight, min: 200, max: 16384 },
          { label: '刷新率（Hz）', value: refresh, set: setRefresh, min: 20, max: 1000 },
        ].map((item) => (
          <label key={item.label}>
            {item.label}
            <input
              type="number"
              min={item.min}
              max={item.max}
              value={item.value}
              disabled={busy}
              onChange={(e) => {
                item.set(Number(e.target.value));
                setConsent(false);
              }}
            />
          </label>
        ))}
        <p>
          比例 {valid ? `${width / divisor}:${height / divisor}` : '—'} · 像素数{' '}
          {valid ? (width * height).toLocaleString('zh-CN') : '—'}
        </p>
      </div>
      <label className="native-checkbox">
        <input
          type="checkbox"
          checked={consent}
          disabled={busy}
          onChange={(e) => setConsent(e.target.checked)}
        />
        确认在所选显示器上临时切换此模式
      </label>
      <button
        type="button"
        className="mint-button"
        disabled={!monitor || !consent || !valid || busy}
        onClick={() => {
          if (monitor)
            action.mutate({
              operation: 'display-switch',
              target: { id: monitor.id, width, height, refresh },
              consent: true,
            });
        }}
      >
        验证并切换
      </button>
      {progress.data?.message && (
        <section className="native-change-review" role="status">
          <strong>{progress.data.message}</strong>
          {progress.data.phase === 'confirming' && progress.data.id && (
            <>
              <p>{progress.data.remaining} 秒后自动恢复</p>
              <div className="native-tool-actions">
                <button
                  type="button"
                  className="mint-button"
                  disabled={action.isPending}
                  onClick={() => {
                    const id = progress.data?.id;
                    if (id) action.mutate({ operation: 'display-decide', id, keep: true });
                  }}
                >
                  保留此模式
                </button>
                <button
                  type="button"
                  className="native-button"
                  disabled={action.isPending}
                  onClick={() => {
                    const id = progress.data?.id;
                    if (id) action.mutate({ operation: 'display-decide', id, keep: false });
                  }}
                >
                  立即恢复
                </button>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
