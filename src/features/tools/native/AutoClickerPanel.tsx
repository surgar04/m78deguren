import { Link } from 'react-router-dom';
import { useState } from 'react';
import { z } from 'zod';
import { clickConfigSchema, clickSnapshotSchema, type ClickConfig } from '@/lib/builtin-contracts';
import { useBuiltinAction, useBuiltinQuery } from './builtin-hooks';
import { Feedback } from './Feedback';

/** 输入循环属于 Rust 服务；页面退出不复制或伪造运行状态，Esc 始终提供紧急停止。 */
function Editor({ config }: { config: ClickConfig }) {
  const [draft, setDraft] = useState(config);
  const state = useBuiltinQuery({ operation: 'click-status' }, clickSnapshotSchema, 500);
  const action = useBuiltinAction(z.null());
  const update = <K extends keyof ClickConfig>(key: K, value: ClickConfig[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const valid = clickConfigSchema.safeParse(draft);
  const apply = (enabled: boolean, immediate: boolean) =>
    action.mutate({ operation: 'click-configure', config: draft, enabled, immediate });
  return (
    <div className="native-tool-panel">
      <div className="native-status-banner" role="status">
        <strong>
          {state.data?.running ? '正在连点' : state.data?.armed ? '热键待命' : '已停止'}
        </strong>
        <span>本次已发送 {state.data?.clicks ?? 0} 次点击</span>
      </div>
      <p className="native-tool-note">
        按 Esc 可立即停止点击。点击完整提交按下与抬起，不向游戏进程注入代码；输入仍受 Windows
        权限控制。
      </p>
      <div className="native-tool-form">
        <label>
          鼠标按键
          <select
            value={draft.button}
            onChange={(e) => {
              const value = clickConfigSchema.shape.button.safeParse(e.target.value);
              if (value.success) update('button', value.data);
            }}
          >
            <option value="left">左键</option>
            <option value="right">右键</option>
          </select>
        </label>
        <label>
          点击间隔（毫秒）
          <input
            type="number"
            min={4}
            max={60_000}
            value={draft.intervalMs}
            onChange={(e) => update('intervalMs', Number(e.target.value))}
          />
        </label>
        <div className="native-preset-buttons">
          {[10, 20, 50, 100, 200, 500, 1000].map((interval) => (
            <button
              key={interval}
              type="button"
              className="native-button"
              onClick={() => update('intervalMs', interval)}
            >
              {1000 / interval} 次/秒
            </button>
          ))}
        </div>
        <Link to="/settings?tab=shortcuts">在设置中管理连点器快捷键</Link>
      </div>
      <div className="native-tool-actions">
        <button
          className="mint-button"
          type="button"
          disabled={!valid.success || action.isPending}
          onClick={() => apply(true, false)}
        >
          保存并启用热键
        </button>
        <button
          className="native-button"
          type="button"
          disabled={!valid.success || action.isPending}
          onClick={() => apply(true, true)}
        >
          立即开始
        </button>
        <button
          className="native-button"
          type="button"
          disabled={action.isPending}
          onClick={() =>
            action.mutate({
              operation: 'click-configure',
              config,
              enabled: false,
              immediate: false,
            })
          }
        >
          停止并关闭热键
        </button>
      </div>
      {state.data?.message && <p role="status">{state.data.message}</p>}
      <Feedback error={state.error ?? action.error} />
    </div>
  );
}
export function AutoClickerPanel() {
  const state = useBuiltinQuery({ operation: 'click-status' }, clickSnapshotSchema);
  if (!state.data) return <Feedback pending={state.isPending} error={state.error} />;
  return <Editor config={state.data.config} />;
}
