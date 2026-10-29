import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { executeHud, isDesktop } from '@/lib/desktop';
import {
  hudConfigSchema,
  hudCatalogSchema,
  hudDisplaysSchema,
  hudProfileSchema,
  type HudConfig,
  type HudProfile,
} from '@/lib/hud-contracts';
import { SettingToggle } from '@/features/settings/controls';
import { useHud, useHudAction } from './repository';
import { HudView, HudIcon } from './HudView';
import icons from './icons.json';
import './hud-settings.css';

export function HudToggle() {
  const query = useHud();
  const action = useHudAction();
  return (
    <>
      <SettingToggle
        label="统一 HUD"
        description="系统方案、媒体和下载轮播；游戏时自动切换性能视图。"
        checked={query.data?.config.enabled ?? false}
        disabled={!query.data || action.isPending}
        onChange={() => action.mutate({ operation: 'toggle' })}
      />
      <Link className="settings-docs-link" to="/tools/overlay-panel">
        调整 HUD 内容、位置和动画 →
      </Link>
      {action.error && <p role="alert">{action.error.message}</p>}
    </>
  );
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="hud-field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function HeaderAdder({ onAdd }: { onAdd: (name: string) => void }) {
  const [name, setName] = useState('Authorization');
  const valid = /^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(name);
  return (
    <div className="hud-header">
      <input
        aria-label="新请求头名称"
        value={name}
        onChange={(event) => setName(event.target.value)}
        maxLength={64}
      />
      <button type="button" className="native-button" disabled={!valid} onClick={() => onAdd(name)}>
        添加请求头
      </button>
    </div>
  );
}
function JsonEditor({
  value,
  onApply,
  label,
}: {
  value: unknown;
  onApply: (value: unknown) => void;
  label: string;
}) {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2)),
    [error, setError] = useState('');
  return (
    <div className="hud-json-editor">
      <label>
        {label}
        <textarea
          spellCheck={false}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      <button
        className="native-button"
        type="button"
        onClick={() => {
          try {
            if (text.length > 262144) throw new Error('配置过大');
            onApply(JSON.parse(text) as unknown);
            setError('');
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'JSON 格式无效');
          }
        }}
      >
        校验并使用 JSON
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
function ProfileEditor({
  profile,
  change,
  catalog,
}: {
  profile: HudProfile;
  change: (profile: HudProfile) => void;
  catalog: z.infer<typeof hudCatalogSchema>['catalog'] | undefined;
}) {
  const [jsonMode, setJsonMode] = useState(false);
  const patch = <K extends keyof HudProfile>(key: K, value: HudProfile[K]) =>
    change({ ...profile, [key]: value });
  const labels = [
    ['name', '方案名称'],
    ['taglineTemplate', '英文眉标'],
    ['titleTemplate', '入场标题'],
    ['primaryTemplate', '左侧主数值'],
    ['secondaryTemplate', '左侧副数值'],
    ['rightTemplate', '右侧数值'],
    ['rightSuffix', '右侧单位'],
  ] as const;
  if (jsonMode)
    return (
      <>
        <button className="native-button" type="button" onClick={() => setJsonMode(false)}>
          返回表单
        </button>
        <JsonEditor
          label="完整方案 JSON（支持上游的全部模板、格式化、表达式和颜色规则字段）"
          value={profile}
          onApply={(value) => {
            change(hudProfileSchema.parse(value));
            setJsonMode(false);
          }}
        />
      </>
    );
  return (
    <>
      <div className="hud-form-grid">
        {labels.map(([key, label]) => (
          <Field label={label} key={key}>
            <input
              disabled={profile.isBuiltIn}
              value={profile[key]}
              onChange={(e) => patch(key, e.target.value)}
            />
          </Field>
        ))}
        {(['leftIcon', 'rightIcon'] as const).map((key, index) => (
          <Field label={index ? '右侧图标' : '左侧图标'} key={key}>
            <select
              disabled={profile.isBuiltIn}
              value={profile[key]}
              onChange={(e) => patch(key, e.target.value)}
            >
              {Object.keys(icons).map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>
          </Field>
        ))}
        <Field label="进度圆环变量／表达式">
          <input
            disabled={profile.isBuiltIn}
            value={profile.progressVariable}
            onChange={(e) => patch('progressVariable', e.target.value)}
          />
        </Field>
        <Field label="进度最小值">
          <input
            disabled={profile.isBuiltIn}
            type="number"
            value={profile.progressMin}
            onChange={(e) => patch('progressMin', e.target.valueAsNumber)}
          />
        </Field>
        <Field label="进度最大值">
          <input
            disabled={profile.isBuiltIn}
            type="number"
            value={profile.progressMax}
            onChange={(e) => patch('progressMax', e.target.valueAsNumber)}
          />
        </Field>
        <Field label="强调色">
          <input
            disabled={profile.isBuiltIn}
            type="color"
            value={profile.accentColor}
            onChange={(e) => patch('accentColor', e.target.value)}
          />
        </Field>
        <Field label="独立 GPU 目标">
          <select
            value={profile.gpuAdapterId}
            onChange={(e) => patch('gpuAdapterId', e.target.value)}
          >
            <option value="">自动选择</option>
            {catalog?.gpus?.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="帧率目标窗口">
          <select
            value={profile.frameWindowId}
            onChange={(e) => patch('frameWindowId', e.target.value)}
          >
            <option value="">选择运行中的窗口</option>
            {catalog?.frameWindows?.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="帧率目标显示器">
          <select
            value={profile.frameDisplayId}
            onChange={(e) => patch('frameDisplayId', e.target.value)}
          >
            <option value="">主显示器</option>
            {catalog?.frameDisplays?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="帧率圆环满量程">
          <input
            type="number"
            min={1}
            max={10000}
            value={profile.frameFullScaleFps}
            onChange={(e) => patch('frameFullScaleFps', e.target.valueAsNumber)}
          />
        </Field>
        <Field label="世界时钟 UTC 偏移">
          <select
            value={profile.timeUtcOffsetMinutes ?? 'local'}
            onChange={(e) =>
              patch(
                'timeUtcOffsetMinutes',
                e.target.value === 'local' ? null : Number(e.target.value),
              )
            }
          >
            <option value="local">本地时区</option>
            {catalog?.timeZones.map((zone) => (
              <option key={zone.minutes} value={zone.minutes}>
                {zone.zh} · UTC {zone.minutes / 60 >= 0 ? '+' : ''}
                {zone.minutes / 60}
              </option>
            ))}
          </select>
        </Field>
        <Field label="每日目标时间">
          <input
            type="time"
            step={1}
            value={profile.timeTarget}
            onChange={(e) => patch('timeTarget', e.target.value)}
          />
        </Field>
        <Field label="时间圆环模式">
          <select
            value={profile.timeTargetEnabled ? 'target' : 'day'}
            onChange={(e) => patch('timeTargetEnabled', e.target.value === 'target')}
          >
            <option value="day">当天进度</option>
            <option value="target">到目标时间的剩余比例</option>
          </select>
        </Field>
        <Field label="网速单位">
          <select
            value={profile.networkDisplayUnit}
            onChange={(e) => patch('networkDisplayUnit', e.target.value)}
          >
            <option value="AutoBytes">自动 B/s</option>
            <option value="Mbps">Mbps</option>
          </select>
        </Field>
        <Field label="网络圆环统计">
          <select
            value={profile.networkPercentMode}
            onChange={(e) => patch('networkPercentMode', e.target.value)}
          >
            {['Total', 'Download', 'Upload', 'Max'].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </Field>
        <Field label="带宽参考值">
          <input
            type="number"
            min={0.01}
            value={profile.networkReferenceValue}
            onChange={(e) => patch('networkReferenceValue', e.target.valueAsNumber)}
          />
        </Field>
        <Field label="带宽参考单位">
          <select
            value={profile.networkReferenceUnit}
            onChange={(e) => patch('networkReferenceUnit', e.target.value)}
          >
            {['MB/s', 'Mbps', 'GB/s', 'Gbps', 'KB/s', 'Kbps'].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </Field>
        <Field label="网络探测目标（手动选择探测方案后才访问）">
          <input value={profile.pingTarget} onChange={(e) => patch('pingTarget', e.target.value)} />
        </Field>
        <Field label="探测协议">
          <select
            value={profile.probeProtocol}
            onChange={(e) => {
              const value = z.enum(['ICMP', 'TCP', 'UDP']).safeParse(e.target.value);
              if (value.success) patch('probeProtocol', value.data);
            }}
          >
            {['ICMP', 'TCP', 'UDP'].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </Field>
        <Field label="探测端口">
          <input
            type="number"
            min={1}
            max={65535}
            value={profile.probePort}
            onChange={(e) => patch('probePort', e.target.valueAsNumber)}
          />
        </Field>
      </div>
      {!profile.isBuiltIn && (
        <>
          <h4>条件颜色（按顺序匹配）</h4>
          {profile.colorRules.map((rule, index) => (
            <div className="hud-rule" key={index}>
              <input
                aria-label="颜色规则变量"
                value={rule.variable}
                onChange={(e) =>
                  patch(
                    'colorRules',
                    profile.colorRules.map((r, i) =>
                      i === index ? { ...r, variable: e.target.value } : r,
                    ),
                  )
                }
              />
              <select
                aria-label="比较条件"
                value={rule.operator}
                onChange={(e) => {
                  const operator =
                    hudProfileSchema.shape.colorRules.element.shape.operator.safeParse(
                      e.target.value,
                    );
                  if (operator.success)
                    patch(
                      'colorRules',
                      profile.colorRules.map((r, i) =>
                        i === index ? { ...r, operator: operator.data } : r,
                      ),
                    );
                }}
              >
                {['>=', '<=', '>', '<', '==', '!=', '='].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
              <input
                type="number"
                aria-label="比较值"
                value={rule.value}
                onChange={(e) =>
                  patch(
                    'colorRules',
                    profile.colorRules.map((r, i) =>
                      i === index ? { ...r, value: e.target.valueAsNumber } : r,
                    ),
                  )
                }
              />
              <input
                type="color"
                aria-label="匹配颜色"
                value={rule.color}
                onChange={(e) =>
                  patch(
                    'colorRules',
                    profile.colorRules.map((r, i) =>
                      i === index ? { ...r, color: e.target.value } : r,
                    ),
                  )
                }
              />
              <button
                type="button"
                onClick={() =>
                  patch(
                    'colorRules',
                    profile.colorRules.filter((_, i) => i !== index),
                  )
                }
              >
                移除
              </button>
            </div>
          ))}
          <button
            type="button"
            className="native-button"
            onClick={() =>
              patch('colorRules', [
                ...profile.colorRules,
                { variable: profile.progressVariable, operator: '>=', value: 90, color: '#FF4D4F' },
              ])
            }
          >
            添加颜色规则
          </button>
          <button type="button" className="native-button" onClick={() => setJsonMode(true)}>
            高级 JSON 编辑
          </button>
        </>
      )}
    </>
  );
}

function Editor({
  initial,
  live,
}: {
  initial: HudConfig;
  live: Parameters<typeof HudView>[0]['live'];
}) {
  const [local, setLocal] = useState<HudConfig | null>(null),
    [tab, setTab] = useState('display'),
    [search, setSearch] = useState('');
  const draft = local ?? initial;
  const action = useHudAction();
  const catalog = useQuery({
    queryKey: ['hud-catalog'],
    queryFn: () => executeHud({ operation: 'catalog' }, hudCatalogSchema),
    enabled: isDesktop(),
    refetchInterval: 30000,
    retry: false,
  });
  const displays = useQuery({
    queryKey: ['hud-displays'],
    queryFn: () => executeHud({ operation: 'displays' }, hudDisplaysSchema),
    enabled: isDesktop(),
    retry: false,
  });
  const update = <K extends keyof HudConfig>(key: K, value: HudConfig[K]) =>
    setLocal((current) => ({ ...(current ?? initial), [key]: value }));
  const save = () =>
    action.mutate({ operation: 'configure', config: draft }, { onSuccess: () => setLocal(null) });
  const valid = hudConfigSchema.safeParse(draft);
  const selected = draft.profiles.find((p) => p.id === draft.activeProfile);
  const profileChange = (profile: HudProfile) =>
    update(
      'profiles',
      draft.profiles.map((p) => (p.id === profile.id ? profile : p)),
    );
  const select = (id: string) =>
    setLocal((current) => {
      const value = current ?? initial;
      return { ...value, activeProfile: id, queue: value.queue.length <= 1 ? [id] : value.queue };
    });
  const toggle = (
    key: Extract<
      keyof HudConfig,
      | 'enabled'
      | 'locked'
      | 'alwaysShow'
      | 'hotzone'
      | 'powerEvents'
      | 'reducedMotion'
      | 'frames'
      | 'autoCycle'
      | 'clickToCycle'
    >,
    label: string,
  ) => (
    <label className="hud-check" key={key}>
      <input type="checkbox" checked={draft[key]} onChange={(e) => update(key, e.target.checked)} />
      {label}
    </label>
  );
  const move = (index: number, direction: number) => {
    const queue = [...draft.queue];
    const from = queue[index],
      to = queue[index + direction];
    if (from && to) {
      queue[index] = to;
      queue[index + direction] = from;
      update('queue', queue);
    }
  };
  const variables = (catalog.data?.catalog?.variables ?? []).filter((v) =>
    `${v.name} ${v.key} ${v.category}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <section className="hud-settings">
      <header className="hud-settings-title">
        <div>
          <span>/// ZHENJING · END FIELD HUD</span>
          <h2>一个 HUD，随场景而动。</h2>
          <p>系统信息、媒体与下载轮播；进入游戏，自动切换到真实性能读数。</p>
        </div>
        <span className={`hud-state-dot ${initial.enabled ? 'on' : ''}`}>
          {initial.enabled ? 'HUD 已开启' : 'HUD 已关闭'}
        </span>
      </header>
      <div className="hud-preview">
        <HudView config={draft} live={live} preview />
        <span>外观预览 · 当前已保存方案的真实数据</span>
      </div>
      <nav className="hud-editor-tabs" aria-label="HUD 设置栏目">
        {[
          ['display', '显示与位置'],
          ['content', '内容与轮播'],
          ['data', '自定义数据'],
          ['variables', '变量库与诊断'],
        ].map(([id, label]) => (
          <button
            type="button"
            key={id}
            className={tab === id ? 'active' : ''}
            onClick={() => setTab(id ?? 'display')}
          >
            {label}
          </button>
        ))}
      </nav>
      {tab === 'display' && (
        <>
          <div className="hud-checks">
            {toggle('enabled', '启用统一 HUD')}
            {toggle('alwaysShow', '一直显示')}
            {toggle('locked', '锁定并穿透鼠标')}
            {toggle('hotzone', '屏幕顶部中央唤出')}
            {toggle('powerEvents', '电源插拔提示')}
            {toggle('frames', '允许 ETW 帧采样')}
            {toggle('reducedMotion', '减少动态效果')}
          </div>
          <div className="hud-form-grid">
            <Field label="场景模式">
              <select
                value={draft.mode}
                onChange={(e) => {
                  const v = hudConfigSchema.shape.mode.safeParse(e.target.value);
                  if (v.success) update('mode', v.data);
                }}
              >
                <option value="auto">自动识别游戏</option>
                <option value="normal">始终普通模式</option>
                <option value="game">手动游戏模式</option>
              </select>
            </Field>
            <Field label="目标显示器">
              <select
                value={draft.monitor}
                onChange={(e) => update('monitor', Number(e.target.value))}
              >
                {displays.data?.map((m) => (
                  <option value={m.id} key={m.id}>
                    {m.name ?? `显示器 ${m.id + 1}`} · {m.width}×{m.height}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="位置">
              <select
                value={draft.position}
                onChange={(e) => {
                  const v = hudConfigSchema.shape.position.safeParse(e.target.value);
                  if (v.success) update('position', v.data);
                }}
              >
                {[
                  ['top-left', '左上'],
                  ['top-center', '上方居中'],
                  ['top-right', '右上'],
                  ['center-left', '左侧居中'],
                  ['center', '正中央'],
                  ['center-right', '右侧居中'],
                  ['bottom-left', '左下'],
                  ['bottom-center', '下方居中'],
                  ['bottom-right', '右下'],
                  ['custom', '自定义坐标'],
                ].map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="显示层级">
              <select
                value={draft.layer}
                onChange={(e) => {
                  const v = hudConfigSchema.shape.layer.safeParse(e.target.value);
                  if (v.success) update('layer', v.data);
                }}
              >
                <option value="topmost">始终置顶</option>
                <option value="desktop">桌面层（不置顶）</option>
              </select>
            </Field>
            <Field label={`缩放 ${Math.round(draft.scale * 100)}%`}>
              <input
                type="range"
                min={0.4}
                max={1.6}
                step={0.05}
                value={draft.scale}
                onChange={(e) => update('scale', e.target.valueAsNumber)}
              />
            </Field>
            <Field label={`不透明度 ${Math.round(draft.opacity * 100)}%`}>
              <input
                type="range"
                min={0.15}
                max={1}
                step={0.05}
                value={draft.opacity}
                onChange={(e) => update('opacity', e.target.valueAsNumber)}
              />
            </Field>
            <Field label="X 偏移／自定义坐标（逻辑像素）">
              <input
                type="number"
                value={draft.x}
                onChange={(e) => update('x', e.target.valueAsNumber)}
              />
            </Field>
            <Field label="Y 偏移／自定义坐标（逻辑像素）">
              <input
                type="number"
                value={draft.y}
                onChange={(e) => update('y', e.target.valueAsNumber)}
              />
            </Field>
            <Field label="切换动画">
              <select
                value={draft.animation}
                onChange={(e) => {
                  const v = hudConfigSchema.shape.animation.safeParse(e.target.value);
                  if (v.success) update('animation', v.data);
                }}
              >
                <option value="full">完整展开与涟漪</option>
                <option value="simple">简洁出现</option>
                <option value="roll">翻滚切换</option>
              </select>
            </Field>
            <Field label="轮播间隔（秒）">
              <input
                type="number"
                min={3}
                max={120}
                value={draft.cycleSeconds}
                onChange={(e) => update('cycleSeconds', e.target.valueAsNumber)}
              />
            </Field>
            <Field label="临时呼出时长（秒）">
              <input
                type="number"
                min={3}
                max={30}
                value={draft.displaySeconds}
                onChange={(e) => update('displaySeconds', e.target.valueAsNumber)}
              />
            </Field>
            <Field label="数据采样间隔（毫秒）">
              <input
                type="number"
                min={500}
                max={60000}
                step={500}
                value={draft.samplingMs}
                onChange={(e) => update('samplingMs', e.target.valueAsNumber)}
              />
            </Field>
            <Field label={`弹性强度 ${draft.bounce}`}>
              <input
                type="range"
                min={0}
                max={0.5}
                step={0.025}
                value={draft.bounce}
                onChange={(e) => update('bounce', e.target.valueAsNumber)}
              />
            </Field>
            <Field label={`涟漪强度 ${draft.ripple}`}>
              <input
                type="range"
                min={0}
                max={2}
                step={0.1}
                value={draft.ripple}
                onChange={(e) => update('ripple', e.target.valueAsNumber)}
              />
            </Field>
            <Field label={`涟漪范围 ${draft.spread}`}>
              <input
                type="range"
                min={0.5}
                max={1.5}
                step={0.1}
                value={draft.spread}
                onChange={(e) => update('spread', e.target.valueAsNumber)}
              />
            </Field>
            <Field label={`文字比例 ${Math.round(draft.fontScale * 100)}%`}>
              <input
                type="range"
                min={0.7}
                max={1.5}
                step={0.1}
                value={draft.fontScale}
                onChange={(e) => update('fontScale', e.target.valueAsNumber)}
              />
            </Field>
          </div>
          <p className="hud-help">
            ETW 可能需要管理员权限；不会自动提权或向游戏注入代码。独占全屏可能遮挡桌面
            HUD，建议使用无边框窗口。系统减少动态效果设置始终优先。
          </p>
          <div className="hud-form-grid">
            <Field label="额外游戏 EXE 名称（每行一个，支持非 Steam 游戏）">
              <textarea
                value={draft.includeProcesses.join('\n')}
                onChange={(e) =>
                  update('includeProcesses', e.target.value.split(/\r?\n/u).filter(Boolean))
                }
              />
            </Field>
            <Field label="排除的图形程序（每行一个）">
              <textarea
                value={draft.excludeProcesses.join('\n')}
                onChange={(e) =>
                  update('excludeProcesses', e.target.value.split(/\r?\n/u).filter(Boolean))
                }
              />
            </Field>
          </div>
          <p className="hud-help">
            识别依据包括游戏库／快捷启动路径、游戏引擎与图形接口、全屏图形窗口。特殊游戏可添加 EXE
            名称或手动切换；普通图形程序误判时可排除。
          </p>
        </>
      )}
      {tab === 'content' && (
        <>
          <h3>显示方案</h3>
          <div className="hud-profile-grid">
            {draft.profiles.map((profile) => (
              <button
                type="button"
                key={profile.id}
                className={draft.activeProfile === profile.id ? 'selected' : ''}
                onClick={() => select(profile.id)}
              >
                <HudIcon name={profile.leftIcon} />
                <strong>
                  {profile.category} · {profile.name}
                </strong>
                <span>{profile.isBuiltIn ? '内置' : '自定义'}</span>
              </button>
            ))}
          </div>
          <h3>普通模式轮播队列</h3>
          <div className="hud-checks">
            {toggle('autoCycle', '自动轮播系统方案')}
            {toggle('clickToCycle', '单击 HUD 切换内容')}
          </div>
          <p className="hud-help">
            媒体与活动下载会自动加入队列，无对应内容时自动移除。单击 HUD
            或使用“轮播”按钮可跳到下一项。
          </p>
          <div className="hud-queue">
            {draft.queue.map((id, index) => (
              <div key={`${id}-${index}`}>
                <b>{String(index + 1).padStart(2, '0')}</b>
                <span>{draft.profiles.find((p) => p.id === id)?.name ?? id}</span>
                <button type="button" disabled={index === 0} onClick={() => move(index, -1)}>
                  上移
                </button>
                <button
                  type="button"
                  disabled={index === draft.queue.length - 1}
                  onClick={() => move(index, 1)}
                >
                  下移
                </button>
                <button
                  type="button"
                  onClick={() =>
                    update(
                      'queue',
                      draft.queue.filter((_, i) => i !== index),
                    )
                  }
                >
                  移除
                </button>
              </div>
            ))}
          </div>
          <select
            aria-label="添加轮播方案"
            value=""
            onChange={(e) => {
              if (e.target.value) update('queue', [...draft.queue, e.target.value]);
            }}
          >
            <option value="">添加轮播方案…</option>
            {draft.profiles
              .filter((p) => !draft.queue.includes(p.id))
              .map((p) => (
                <option value={p.id} key={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
          {selected && (
            <>
              <div className="hud-section-heading">
                <h3>{selected.name} · 方案设置</h3>
                <button
                  type="button"
                  className="native-button"
                  onClick={() => {
                    const id = crypto.randomUUID();
                    setLocal({
                      ...draft,
                      profiles: [
                        ...draft.profiles,
                        {
                          ...selected,
                          id,
                          isBuiltIn: false,
                          builtInKey: '',
                          category: '自定义',
                          name: selected.name + ' · 自定义',
                        },
                      ],
                      activeProfile: id,
                      queue: [id],
                    });
                  }}
                >
                  另存为自定义
                </button>
                {!selected.isBuiltIn && (
                  <button
                    type="button"
                    className="native-button"
                    onClick={() =>
                      setLocal({
                        ...draft,
                        profiles: draft.profiles.filter((p) => p.id !== selected.id),
                        activeProfile: 'system.memory',
                        queue: draft.queue.filter((id) => id !== selected.id),
                      })
                    }
                  >
                    删除自定义方案
                  </button>
                )}
              </div>
              {selected.isBuiltIn && (
                <p className="hud-help">
                  内置模板保留上游定义；可以调整设备、时区和探测目标。需要修改排版或表达式时，请另存为自定义。
                </p>
              )}
              <ProfileEditor
                key={selected.id}
                profile={selected}
                change={profileChange}
                catalog={catalog.data?.catalog}
              />
            </>
          )}
        </>
      )}
      {tab === 'data' && (
        <>
          <h3>DeepSeek</h3>
          <Field label="API Key（仅保存在本机，使用当前 Windows 用户 DPAPI 保护）">
            <input
              type="password"
              autoComplete="off"
              value={draft.deepseekKey}
              onChange={(e) => update('deepseekKey', e.target.value)}
              placeholder="留空表示不连接"
            />
          </Field>
          <p className="hud-help">
            余额和高峰／低谷方案只在被显示时访问对应接口。配置导出不会包含密钥或请求 Header。
          </p>
          <h3>HTTP / JSON 数据源</h3>
          {draft.httpSources.map((source, index) => {
            const change = (value: typeof source) =>
              update(
                'httpSources',
                draft.httpSources.map((s, i) => (i === index ? value : s)),
              );
            return (
              <div className="hud-http-source" key={index}>
                <div className="hud-form-grid">
                  <Field label="数据源名称">
                    <input
                      value={source.name}
                      onChange={(e) => change({ ...source, name: e.target.value })}
                    />
                  </Field>
                  <Field label="GET 地址">
                    <input
                      type="url"
                      value={source.url}
                      onChange={(e) => change({ ...source, url: e.target.value })}
                    />
                  </Field>
                  <Field label="刷新间隔（秒）">
                    <input
                      type="number"
                      min={5}
                      max={86400}
                      value={source.refreshSeconds}
                      onChange={(e) =>
                        change({ ...source, refreshSeconds: e.target.valueAsNumber })
                      }
                    />
                  </Field>
                  <label className="hud-check">
                    <input
                      type="checkbox"
                      checked={source.enabled}
                      onChange={(e) => change({ ...source, enabled: e.target.checked })}
                    />
                    启用数据源
                  </label>
                </div>
                <h4>请求 Header</h4>
                {Object.entries(source.headers).map(([key, value]) => (
                  <div className="hud-header" key={key}>
                    <span>{key}</span>
                    <input
                      type="password"
                      autoComplete="off"
                      aria-label={`${key}凭据`}
                      value={value}
                      onChange={(e) =>
                        change({ ...source, headers: { ...source.headers, [key]: e.target.value } })
                      }
                    />
                    <button
                      type="button"
                      onClick={() =>
                        change({
                          ...source,
                          headers: Object.fromEntries(
                            Object.entries(source.headers).filter(([name]) => name !== key),
                          ),
                        })
                      }
                    >
                      移除
                    </button>
                  </div>
                ))}
                <HeaderAdder
                  onAdd={(name) =>
                    change({
                      ...source,
                      headers: { ...source.headers, [name]: source.headers[name] ?? '' },
                    })
                  }
                />
                <JsonEditor
                  label="字段映射 [{ variable, jsonPath }]"
                  value={source.fields}
                  onApply={(value) =>
                    change({
                      ...source,
                      fields: z
                        .array(
                          z
                            .object({
                              variable: z.string().regex(/^[a-z0-9_-]+$/iu),
                              jsonPath: z.string().min(1),
                            })
                            .strict(),
                        )
                        .min(1)
                        .max(64)
                        .parse(value),
                    })
                  }
                />
                <button
                  type="button"
                  className="native-button"
                  onClick={() =>
                    update(
                      'httpSources',
                      draft.httpSources.filter((_, i) => i !== index),
                    )
                  }
                >
                  移除此数据源
                </button>
              </div>
            );
          })}
          <button
            type="button"
            className="native-button"
            onClick={() =>
              update('httpSources', [
                ...draft.httpSources,
                {
                  name: `source-${crypto.randomUUID().slice(0, 8)}`,
                  enabled: false,
                  url: '',
                  refreshSeconds: 60,
                  headers: {},
                  fields: [{ variable: 'value', jsonPath: 'value' }],
                },
              ])
            }
          >
            添加 HTTP 数据源
          </button>
          <p className="hud-help">
            变量使用 {'{custom.数据源名称.变量名}'}。只发出 GET 请求；不跟随重定向，响应体最多 1
            MiB。地址变更后需重新输入凭据。
          </p>
        </>
      )}
      {tab === 'variables' && (
        <>
          <div className="hud-section-heading">
            <h3>变量库 · {variables.length} 项</h3>
            <input
              aria-label="搜索 HUD 变量"
              placeholder="搜索变量、名称或分类…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button className="native-button" type="button" onClick={() => void catalog.refetch()}>
              刷新设备变量
            </button>
          </div>
          <p className="hud-help">
            示例：{'{memory.used_bytes|gb:1}'}、{'{=round(cpu.usage, 1)}'}
            。未返回的温度、风扇等显示“—”，不会补造数字。
          </p>
          <div className="hud-variable-list">
            {variables.map((v) => (
              <div key={v.key}>
                <strong>{v.name}</strong>
                <code>{v.templateToken}</code>
                <small>{v.description}</small>
              </div>
            ))}
          </div>
          <h3>实时诊断</h3>
          <h3>条件触发</h3>
          <p className="hud-help">
            按变量阈值（Threshold）、变化（Change）或转为真（BecomesTrue）唤出当前方案；冷却时间以秒计。仅启用规则所需变量会在隐藏期间继续采集。
          </p>
          <JsonEditor
            label="触发规则"
            value={draft.triggers}
            onApply={(value) => update('triggers', hudConfigSchema.shape.triggers.parse(value))}
          />
          <button
            type="button"
            className="native-button"
            onClick={() =>
              update('triggers', [
                ...draft.triggers,
                {
                  id: crypto.randomUUID(),
                  enabled: true,
                  name: 'CPU 高使用率',
                  variable: 'cpu.usage',
                  mode: 'Threshold',
                  operator: '>=',
                  value: 90,
                  cooldownSeconds: 30,
                },
              ])
            }
          >
            添加 CPU 阈值规则
          </button>
          <p>
            {live.game
              ? `游戏视图 · ${live.gameInfo?.name ?? '手动'} · ${live.gameInfo?.reason ?? ''}`
              : '普通视图'}{' '}
            · {live.fps?.message ?? '帧采样未开启'}
          </p>
          {live.error && <p role="alert">{live.error}</p>}
          {(live.missing?.length ?? 0) > 0 && <p>当前不可用变量：{live.missing?.join('、')}</p>}
          <p className="hud-help">
            普通模式默认每秒更新；隐藏时停止方案数据采集。游戏模式复用硬件服务和 Rust
            ETW，显示器／指定窗口方案按需使用上游帧归属采集器；切换离开即停止。
          </p>
        </>
      )}
      {!valid.success && (
        <p className="hud-validation" role="alert">
          {valid.error.issues[0]?.message} · {valid.error.issues[0]?.path.join('.')}
        </p>
      )}
      {action.error && <p role="alert">{action.error.message}</p>}
      <footer className="hud-editor-footer">
        <span>{local ? '有尚未保存的修改' : '偏好已保存在本机'}</span>
        <button
          type="button"
          className="native-button"
          onClick={() => action.mutate({ operation: 'export' })}
        >
          导出配置
        </button>
        <button
          type="button"
          className="native-button"
          onClick={() =>
            action.mutate({ operation: 'import' }, { onSuccess: () => setLocal(null) })
          }
        >
          导入配置
        </button>
        <button
          type="button"
          className="native-button"
          onClick={() => setLocal(null)}
          disabled={!local}
        >
          放弃草稿
        </button>
        <button
          type="button"
          className="hud-apply"
          disabled={!valid.success || action.isPending}
          onClick={save}
        >
          {action.isPending ? '正在应用…' : '保存并应用'}
        </button>
      </footer>
    </section>
  );
}
export default function HudPanel() {
  const query = useHud(true);
  if (!isDesktop())
    return <p className="native-empty">请在臻境桌面端配置 HUD；浏览器不会生成模拟传感器数据。</p>;
  if (query.error) return <p role="alert">{query.error.message}</p>;
  if (!query.data) return <p role="status">正在读取 HUD 配置…</p>;
  return <Editor initial={query.data.config} live={query.data.live} />;
}
