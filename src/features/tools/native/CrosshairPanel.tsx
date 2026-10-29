import { Link } from 'react-router-dom';
import { useState } from 'react';
import type { z } from 'zod';
import {
  crosshairSnapshotSchema,
  displaysSchema,
  crosshairConfigSchema,
  type CrosshairConfig,
} from '@/lib/tool-contracts';
import { useToolAction, useToolQuery } from './hooks';
import { Feedback } from './Feedback';
import { CrosshairCanvas } from './CrosshairCanvas';
import { BUILTIN_CROSSHAIRS, reticleImage } from './builtin-crosshairs';

function Editor({ snapshot }: { snapshot: z.infer<typeof crosshairSnapshotSchema> }) {
  const [draft, setDraft] = useState(snapshot.config);
  const [name, setName] = useState('');
  const [fileError, setFileError] = useState('');
  const displays = useToolQuery('displays', displaysSchema);
  const action = useToolAction();
  const change = <K extends keyof CrosshairConfig>(key: K, value: CrosshairConfig[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const valid = crosshairConfigSchema.safeParse(draft);
  const dirty = JSON.stringify(snapshot.config) !== JSON.stringify(draft);
  const number = (
    key: 'size' | 'thickness' | 'gap' | 'outline' | 'offsetX' | 'offsetY' | 'holdDelayMs',
    label: string,
    min: number,
    max: number,
  ) => (
    <label key={key}>
      {label}
      <input
        type="number"
        min={min}
        max={max}
        value={draft[key]}
        onChange={(e) => change(key, Number(e.target.value))}
      />
    </label>
  );
  return (
    <div className="native-tool-panel">
      <div className="native-tool-columns">
        <div>
          <CrosshairCanvas config={draft} className="native-crosshair-preview" />
          <p className="native-tool-note">
            覆盖层为鼠标穿透窗口；独占全屏或反作弊策略可能限制覆盖显示。
          </p>
        </div>
        <div className="native-tool-form">
          <label>
            准心样式
            <select
              value={draft.shape}
              onChange={(e) => {
                const shape = crosshairConfigSchema.shape.shape.safeParse(e.target.value);
                if (shape.success) change('shape', shape.data);
              }}
            >
              <option value="cross">十字</option>
              <option value="dot">圆点</option>
              <option value="circle">圆形</option>
              <option value="cross-circle">十字与圆形</option>
              <option value="cross-dot">十字与圆点</option>
              <option value="dot-box">方框与圆点</option>
              <option value="image">自定义图片</option>
            </select>
          </label>
          <label>
            目标显示器
            <select
              value={draft.monitor}
              onChange={(e) => change('monitor', Number(e.target.value))}
            >
              {displays.data?.map((display) => (
                <option key={display.index} value={display.index}>
                  {display.name} · {display.width} × {display.height}
                </option>
              ))}
            </select>
          </label>
          <label>
            颜色
            <input
              type="color"
              value={draft.color}
              onChange={(e) => change('color', e.target.value)}
            />
          </label>
          <label>
            透明度
            <input
              type="range"
              min=".05"
              max="1"
              step=".05"
              value={draft.opacity}
              onChange={(e) => change('opacity', Number(e.target.value))}
            />
            <output>{Math.round(draft.opacity * 100)}%</output>
          </label>
          {number('size', '大小', 4, 200)}
          {number('thickness', '粗细', 1, 20)}
          {number('gap', '间隙', 0, 100)}
          {number('outline', '描边', 0, 8)}
          {number('offsetX', '水平偏移', -4096, 4096)}
          {number('offsetY', '垂直偏移', -4096, 4096)}
          <label className="native-checkbox">
            <input
              type="checkbox"
              checked={draft.centerDot}
              onChange={(e) => change('centerDot', e.target.checked)}
            />
            中心点
          </label>
          <Link to="/settings?tab=shortcuts">在设置中管理准心快捷键</Link>
          <label className="native-checkbox">
            <input
              type="checkbox"
              checked={draft.hold}
              onChange={(e) => change('hold', e.target.checked)}
            />
            按住时显示
          </label>
          <label>
            按住按键
            <select
              value={draft.holdKey}
              onChange={(e) => {
                const key = crosshairConfigSchema.shape.holdKey.safeParse(e.target.value);
                if (key.success) change('holdKey', key.data);
              }}
            >
              {[
                ['right', '鼠标右键'],
                ['left', '鼠标左键'],
                ['middle', '鼠标中键'],
                ['x1', '鼠标侧键1'],
                ['x2', '鼠标侧键2'],
                ['shift', 'Shift'],
                ['control', 'Ctrl'],
                ['alt', 'Alt'],
              ].map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {number('holdDelayMs', '显示延迟（毫秒）', 0, 2000)}
          <label className="native-full-width">
            自定义图片（最大1MB）
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                if (
                  file.size > 1_048_576 ||
                  !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)
                ) {
                  setFileError('请选择不超过1MB的PNG、JPEG或WebP图片');
                  return;
                }
                const reader = new FileReader();
                reader.onload = () => {
                  const result = reader.result;
                  if (typeof result === 'string') {
                    setDraft((current) => ({ ...current, image: result, shape: 'image' }));
                    setFileError('');
                  }
                };
                reader.onerror = () => setFileError('图片读取失败');
                reader.readAsDataURL(file);
              }}
            />
          </label>
        </div>
      </div>
      <label>
        描边颜色
        <input
          type="color"
          value={draft.outlineColor}
          onChange={(event) => change('outlineColor', event.target.value)}
        />
      </label>
      <section>
        <h4>内置图片准心</h4>
        <div className="native-preset-buttons">
          {BUILTIN_CROSSHAIRS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className="native-button"
              onClick={() => {
                try {
                  const image = reticleImage(preset.id, draft.color);
                  setDraft((value) => ({ ...value, shape: 'image', image }));
                } catch (cause) {
                  setFileError(cause instanceof Error ? cause.message : '准心生成失败');
                }
              }}
            >
              {preset.name}
            </button>
          ))}
        </div>
        <p className="native-tool-note">
          图片准心保留生成或导入时的颜色；整体大小、不透明度和偏移仍可调整。
        </p>
      </section>
      <div className="native-tool-actions">
        <button
          type="button"
          className="mint-button"
          disabled={action.isPending || !valid.success}
          onClick={() =>
            action.mutate({
              operation: 'crosshair-update',
              config: draft,
              enabled: !snapshot.enabled,
            })
          }
        >
          {snapshot.enabled ? '关闭准心' : '启用准心'}
        </button>
        <button
          type="button"
          className="native-button"
          disabled={action.isPending || !valid.success}
          onClick={() =>
            action.mutate({
              operation: 'crosshair-update',
              config: draft,
              enabled: snapshot.enabled,
            })
          }
        >
          应用修改
        </button>
        <span>
          {snapshot.enabled ? '已启用' : '已关闭'}
          {dirty ? ' · 尚有未应用修改' : ''}
        </span>
      </div>
      <Feedback
        pending={action.isPending}
        error={action.error || displays.error || fileError || snapshot.message}
      />
      <div className="native-presets">
        <h3>我的预设</h3>
        <label>
          预设名称
          <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        </label>
        <button
          type="button"
          className="native-button"
          disabled={dirty || !name.trim() || action.isPending}
          onClick={() =>
            action.mutate({ operation: 'crosshair-preset', action: 'save', name: name.trim() })
          }
        >
          保存已应用配置
        </button>
        {snapshot.presets.length === 0 && <p>尚未保存预设</p>}
        {snapshot.presets.map((preset) => (
          <div className="native-tool-list-row" key={preset.id}>
            <button type="button" className="native-button" onClick={() => setDraft(preset.config)}>
              {preset.name}
            </button>
            <button
              type="button"
              className="native-button"
              onClick={() =>
                action.mutate({ operation: 'crosshair-preset', action: 'remove', id: preset.id })
              }
            >
              移除预设
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
export function CrosshairPanel() {
  const query = useToolQuery('crosshair-status', crosshairSnapshotSchema, 700);
  return query.data ? (
    <Editor snapshot={query.data} />
  ) : (
    <Feedback pending={query.isPending} error={query.error} />
  );
}
