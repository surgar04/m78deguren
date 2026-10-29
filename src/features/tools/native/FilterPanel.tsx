import { useState } from 'react';
import { z } from 'zod';
import {
  displaySnapshotSchema,
  filterConfigSchema,
  filterSnapshotSchema,
  type FilterConfig,
  type FilterLayer,
} from '@/lib/builtin-contracts';
import { useBuiltinAction, useBuiltinQuery } from './builtin-hooks';
import { Feedback } from './Feedback';

/** 新图层的中性参数是可编辑配置；显示器、ICC 和运行状态全部来自 Rust。 */
function neutralLayer(): FilterLayer {
  return {
    id: crypto.randomUUID(),
    name: '颜色调整',
    enabled: true,
    temperature: 6500,
    brightness: 100,
    contrast: 100,
    gamma: 1,
    shadow: 0,
    red: 1,
    green: 1,
    blue: 1,
  };
}
const CONTROLS = [
  { key: 'temperature', label: '色温', min: 1000, max: 12000, step: 100, unit: 'K' },
  { key: 'brightness', label: '亮度', min: 50, max: 150, step: 1, unit: '%' },
  { key: 'contrast', label: '对比度', min: 50, max: 150, step: 1, unit: '%' },
  { key: 'gamma', label: '整体 Gamma', min: 0.3, max: 3, step: 0.05, unit: '' },
  { key: 'shadow', label: '暗部调整', min: -50, max: 50, step: 1, unit: '%' },
  { key: 'red', label: '红色 Gamma', min: 0.3, max: 3, step: 0.05, unit: '' },
  { key: 'green', label: '绿色 Gamma', min: 0.3, max: 3, step: 0.05, unit: '' },
  { key: 'blue', label: '蓝色 Gamma', min: 0.3, max: 3, step: 0.05, unit: '' },
] as const;
function Editor({ initial }: { initial: FilterConfig }) {
  const [draft, setDraft] = useState(initial),
    [targetIndex, setTargetIndex] = useState(0),
    [name, setName] = useState('我的显示滤镜'),
    [consent, setConsent] = useState(false),
    [recoveryConsent, setRecoveryConsent] = useState(false);
  const status = useBuiltinQuery({ operation: 'filter-status' }, filterSnapshotSchema, 500);
  const monitors = useBuiltinQuery({ operation: 'query', tool: 'displays' }, displaySnapshotSchema);
  const action = useBuiltinAction(z.null());
  const exportIcc = useBuiltinAction(z.object({ path: z.string() }));
  const target = draft.targets[targetIndex] ?? draft.targets[0];
  const valid = filterConfigSchema.safeParse(draft);
  const updateTarget = (
    update: (value: NonNullable<typeof target>) => NonNullable<typeof target>,
  ) =>
    setDraft((current) => ({
      ...current,
      targets: current.targets.map((value, index) =>
        index === targetIndex ? update(value) : value,
      ),
    }));
  const updateLayer = <K extends keyof FilterLayer>(id: string, key: K, value: FilterLayer[K]) =>
    updateTarget((current) => ({
      ...current,
      layers: current.layers.map((layer) => (layer.id === id ? { ...layer, [key]: value } : layer)),
    }));
  const moveLayer = (id: string, direction: number) =>
    updateTarget((current) => {
      const layers = [...current.layers],
        index = layers.findIndex((layer) => layer.id === id),
        layer = layers[index];
      if (!layer || index + direction < 0 || index + direction >= layers.length) return current;
      layers.splice(index, 1);
      layers.splice(index + direction, 0, layer);
      return { ...current, layers };
    });
  const apply = (enabled: boolean, preview = false) =>
    action.mutate({ operation: 'filter-configure', config: draft, enabled, preview, consent });
  return (
    <div className="native-tool-panel">
      <div className="native-status-banner">
        <strong>
          {status.data?.enabled
            ? status.data.phase === 'waiting'
              ? '等待前台游戏'
              : '滤镜运行中'
            : '滤镜已停止'}
        </strong>
        <span>{status.data?.message}</span>
      </div>
      <p className="native-tool-note">
        色温、Gamma、明暗和 ICC 校准曲线按显示器应用；真正的饱和度使用 Windows
        全桌面颜色矩阵，会影响所有显示器。HDR、独占全屏或驱动颜色管理可能不支持此路径，失败会显示原因并尝试恢复。
      </p>
      <Feedback
        pending={action.isPending || exportIcc.isPending}
        error={status.error ?? monitors.error ?? action.error ?? exportIcc.error}
      />
      <div className="native-tool-actions">
        {draft.targets.map((value, index) => (
          <button
            key={value.monitor ?? 'automatic'}
            type="button"
            className={index === targetIndex ? 'mint-button' : 'native-button'}
            onClick={() => setTargetIndex(index)}
          >
            显示器 {index + 1}
          </button>
        ))}
        <button
          type="button"
          className="native-button"
          disabled={
            draft.targets.length >= 16 ||
            !monitors.data?.monitors.some(
              (monitor) => !draft.targets.some((value) => value.monitor === monitor.id),
            )
          }
          onClick={() => {
            const monitor = monitors.data?.monitors.find(
              (value) => !draft.targets.some((target) => target.monitor === value.id),
            );
            if (monitor) {
              setDraft((value) => ({
                ...value,
                targets: [
                  ...value.targets,
                  { monitor: monitor.id, icc: null, layers: [neutralLayer()] },
                ],
              }));
              setTargetIndex(draft.targets.length);
            }
          }}
        >
          添加显示器
        </button>
      </div>
      {target && (
        <section className="native-device-card">
          <div className="native-tool-form">
            <label>
              目标显示器
              <select
                value={target.monitor ?? ''}
                onChange={(e) =>
                  updateTarget((value) => ({ ...value, monitor: e.target.value || null }))
                }
              >
                <option value="">自动选择第一台显示器</option>
                {monitors.data?.monitors.map((value) => (
                  <option key={value.id} value={value.id}>
                    {value.name} · {value.device}
                  </option>
                ))}
              </select>
            </label>
            <label>
              ICC 校准曲线
              <select
                value={target.icc ?? ''}
                onChange={(e) =>
                  updateTarget((value) => ({ ...value, icc: e.target.value || null }))
                }
              >
                <option value="">不叠加 ICC 曲线</option>
                {status.data?.profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="native-tool-actions">
            <button
              type="button"
              className="native-button"
              disabled={target.layers.length >= 8}
              onClick={() =>
                updateTarget((value) => ({ ...value, layers: [...value.layers, neutralLayer()] }))
              }
            >
              添加颜色图层
            </button>
            <button
              type="button"
              className="native-button"
              disabled={draft.targets.length <= 1}
              onClick={() => {
                setDraft((value) => ({
                  ...value,
                  targets: value.targets.filter((_, index) => index !== targetIndex),
                }));
                setTargetIndex(0);
              }}
            >
              移除此显示器目标
            </button>
            <button
              type="button"
              className="native-button"
              disabled={!valid.success || exportIcc.isPending}
              onClick={() => exportIcc.mutate({ operation: 'filter-export', target })}
            >
              导出此显示器 ICC 曲线
            </button>
          </div>
          {target.layers.map((layer, index) => (
            <details className="native-filter-layer" key={layer.id} open>
              <summary>
                {index + 1}. {layer.name} · {layer.enabled ? '启用' : '停用'}
              </summary>
              <div className="native-tool-actions">
                <label className="native-checkbox">
                  <input
                    type="checkbox"
                    checked={layer.enabled}
                    onChange={(e) => updateLayer(layer.id, 'enabled', e.target.checked)}
                  />
                  启用图层
                </label>
                <label>
                  名称
                  <input
                    maxLength={40}
                    value={layer.name}
                    onChange={(e) => updateLayer(layer.id, 'name', e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="native-button"
                  disabled={index === 0}
                  onClick={() => moveLayer(layer.id, -1)}
                >
                  上移
                </button>
                <button
                  type="button"
                  className="native-button"
                  disabled={index === target.layers.length - 1}
                  onClick={() => moveLayer(layer.id, 1)}
                >
                  下移
                </button>
                <button
                  type="button"
                  className="native-button"
                  disabled={target.layers.length <= 1}
                  onClick={() =>
                    updateTarget((value) => ({
                      ...value,
                      layers: value.layers.filter((item) => item.id !== layer.id),
                    }))
                  }
                >
                  移除图层
                </button>
              </div>
              <div className="native-tool-form">
                {CONTROLS.map((control) => (
                  <label key={control.key}>
                    {control.label} · {Number(layer[control.key].toFixed(2))}
                    {control.unit}
                    <input
                      type="range"
                      min={control.min}
                      max={control.max}
                      step={control.step}
                      value={layer[control.key]}
                      onChange={(e) => updateLayer(layer.id, control.key, Number(e.target.value))}
                    />
                  </label>
                ))}
              </div>
            </details>
          ))}
        </section>
      )}
      <label>
        全桌面饱和度 · {draft.saturation}%
        <input
          type="range"
          min={0}
          max={200}
          value={draft.saturation}
          onChange={(e) => setDraft((value) => ({ ...value, saturation: Number(e.target.value) }))}
        />
      </label>
      <label className="native-checkbox">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        确认应用所选显示器曲线，以及全桌面饱和度；原始设置会备份到应用数据目录
      </label>
      <div className="native-tool-actions">
        <button
          type="button"
          className="mint-button"
          disabled={!valid.success || !consent || action.isPending}
          onClick={() => apply(true, true)}
        >
          预览 10 秒
        </button>
        <button
          type="button"
          className="native-button"
          disabled={!valid.success || !consent || action.isPending}
          onClick={() => apply(true)}
        >
          应用滤镜
        </button>
        <button
          type="button"
          className="native-button"
          disabled={action.isPending}
          onClick={() =>
            action.mutate({
              operation: 'filter-configure',
              config: status.data?.config ?? initial,
              enabled: false,
              preview: false,
              consent: false,
            })
          }
        >
          停用并恢复原始曲线
        </button>
        <button
          type="button"
          className="native-button"
          disabled={!valid.success || action.isPending}
          onClick={() => apply(false)}
        >
          保存草稿并停用
        </button>
      </div>
      {(status.data?.previewRemaining ?? 0) > 0 && (
        <section className="native-change-review" role="status">
          <strong>{status.data?.previewRemaining} 秒后自动恢复</strong>
          <button
            type="button"
            className="mint-button"
            disabled={action.isPending}
            onClick={() => action.mutate({ operation: 'filter-keep' })}
          >
            确认保留本次滤镜
          </button>
        </section>
      )}
      <section className="native-device-card">
        <h4>内置与用户预设</h4>
        <div className="native-preset-buttons">
          {status.data?.presets.map((preset) => (
            <div key={preset.id}>
              <button
                type="button"
                className="native-button"
                onClick={() =>
                  setDraft({ ...preset.config, autoGame: draft.autoGame, rules: draft.rules })
                }
              >
                {preset.name}
                {preset.builtin ? ' · 内置' : ''}
              </button>
              {!preset.builtin && (
                <button
                  type="button"
                  className="native-button"
                  aria-label={`删除${preset.name}`}
                  disabled={action.isPending}
                  onClick={() =>
                    action.mutate({ operation: 'filter-preset-remove', id: preset.id })
                  }
                >
                  删除
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="native-tool-actions">
          <label>
            新预设名称
            <input maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <button
            type="button"
            className="native-button"
            disabled={!valid.success || !name.trim() || action.isPending}
            onClick={() => action.mutate({ operation: 'filter-preset-save', name, config: draft })}
          >
            保存为用户预设
          </button>
        </div>
      </section>
      <section className="native-device-card">
        <h4>ICC 文件</h4>
        <p className="native-tool-note">
          提取 VCGT 或完整 RGB TRC 曲线，不安装为系统 ICC 配置。ICC
          导出包含当前目标的校准曲线，不包含全桌面饱和度。导入文件通过本地选择器选择。
        </p>
        <button
          type="button"
          className="native-button"
          disabled={action.isPending}
          onClick={() => action.mutate({ operation: 'filter-import' })}
        >
          选择并导入 ICC / ICM
        </button>
        <div className="native-tool-list">
          {status.data?.profiles.map((profile) => (
            <div key={profile.id} className="native-tool-list-row">
              <strong>{profile.name}</strong>
              <button
                type="button"
                className="native-button"
                disabled={action.isPending}
                onClick={() =>
                  action.mutate({ operation: 'filter-profile-remove', id: profile.id })
                }
              >
                删除本地校准文件
              </button>
            </div>
          ))}
        </div>
      </section>
      <section className="native-device-card">
        <h4>前台游戏自动匹配</h4>
        <label className="native-checkbox">
          <input
            type="checkbox"
            checked={draft.autoGame}
            onChange={(e) => setDraft((value) => ({ ...value, autoGame: e.target.checked }))}
          />
          仅匹配前台游戏时启用对应预设；切换到其他程序时恢复
        </label>
        <div className="native-tool-list">
          {draft.rules.map((rule, index) => (
            <div key={index} className="native-overlay-item">
              <input
                aria-label={`规则 ${index + 1} 游戏 EXE 文件名`}
                value={rule.process}
                placeholder="例如 Game.exe"
                onChange={(e) =>
                  setDraft((value) => ({
                    ...value,
                    rules: value.rules.map((item, n) =>
                      n === index ? { ...item, process: e.target.value } : item,
                    ),
                  }))
                }
              />
              <select
                aria-label={`规则 ${index + 1} 预设`}
                value={rule.preset}
                onChange={(e) =>
                  setDraft((value) => ({
                    ...value,
                    rules: value.rules.map((item, n) =>
                      n === index ? { ...item, preset: e.target.value } : item,
                    ),
                  }))
                }
              >
                {status.data?.presets.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="native-button"
                onClick={() =>
                  setDraft((value) => ({
                    ...value,
                    rules: value.rules.filter((_, n) => n !== index),
                  }))
                }
              >
                删除规则
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="native-button"
          disabled={draft.rules.length >= 20}
          onClick={() =>
            setDraft((value) => ({
              ...value,
              rules: [
                ...value.rules,
                { process: 'Game.exe', preset: status.data?.presets[0]?.id ?? 'builtin-0' },
              ],
            }))
          }
        >
          添加游戏规则
        </button>
      </section>
      {status.data?.recoveryId && (
        <section className="native-change-review">
          <h4>原始曲线恢复入口</h4>
          <p>
            强制恢复本次会话保存的原始曲线，会覆盖当前显示曲线及本次涉及的全桌面矩阵。若其他软件已更改颜色，请先确认。
          </p>
          <label className="native-checkbox">
            <input
              type="checkbox"
              checked={recoveryConsent}
              onChange={(e) => setRecoveryConsent(e.target.checked)}
            />
            确认使用本次备份覆盖当前颜色设置
          </label>
          <button
            type="button"
            className="native-button"
            disabled={!recoveryConsent || action.isPending}
            onClick={() => {
              const id = status.data?.recoveryId;
              if (id) action.mutate({ operation: 'filter-recover', id, consent: true });
            }}
          >
            恢复原始曲线备份
          </button>
        </section>
      )}
    </div>
  );
}
export function FilterPanel() {
  const query = useBuiltinQuery({ operation: 'filter-status' }, filterSnapshotSchema);
  return (
    <>
      <Feedback pending={query.isPending} error={query.error} />
      {query.data && <Editor initial={query.data.config} />}
    </>
  );
}
