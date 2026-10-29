import { useState } from 'react';
import { z } from 'zod';
import { faCircleNotch, faWandMagicSparkles } from '@fortawesome/free-solid-svg-icons';
import { Icon } from '@/features/home/components/Icon';
import { Failure } from '@/features/settings/controls';
import {
  quickSnapshotSchema,
  targetKey,
  type QuickConfig,
  type QuickSnapshot,
  type LaunchTarget,
} from '@/lib/launcher-contracts';
import { isDesktop } from '@/lib/desktop';
import { useQuickLaunch, useQuickAction } from './repository';
import { LaunchTargetIcon } from './LaunchTargetIcon';
import './quick-launch.css';
const DIRECTIONS = ['上', '右上', '右', '右下', '下', '左下', '左', '左上'];
function TargetPicker({
  options,
  value,
  onChange,
}: {
  options: QuickSnapshot['options'];
  value: LaunchTarget | null;
  onChange: (target: LaunchTarget | null) => void;
}) {
  const [search, setSearch] = useState('');
  const selected = targetKey(value);
  const matches = options.filter((option) =>
    [option.label, option.group]
      .join(' ')
      .toLocaleLowerCase()
      .includes(search.trim().toLocaleLowerCase()),
  );
  const shown = matches.slice(0, 200);
  const current = options.find((option) => targetKey(option.target) === selected);
  if (current && !shown.includes(current)) shown.unshift(current);
  return (
    <div className="quick-target-picker">
      <input
        aria-label="搜索快捷启动目标"
        placeholder="搜索游戏、程序、工具或页面…"
        value={search}
        maxLength={120}
        onChange={(e) => setSearch(e.target.value)}
      />
      <select
        aria-label="快捷启动目标"
        value={selected}
        onChange={(e) =>
          onChange(
            options.find((option) => targetKey(option.target) === e.target.value)?.target ?? null,
          )
        }
      >
        <option value="">未配置 · 清空此位置</option>
        {!!value && !current && (
          <option value={selected} disabled>
            目标已移除，请重新选择
          </option>
        )}
        {[...new Set(shown.map((option) => option.group))].map((group) => (
          <optgroup key={group} label={group}>
            {shown
              .filter((option) => option.group === group)
              .map((option) => (
                <option key={targetKey(option.target)} value={targetKey(option.target)}>
                  {option.label}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
      <small>
        显示 {Math.min(200, matches.length)} / {matches.length}{' '}
        个匹配项；游戏来自真实安装或首页手动添加。
      </small>
    </div>
  );
}
function Editor({
  snapshot,
  section,
  setSection,
  index,
  setIndex,
}: {
  snapshot: QuickSnapshot;
  section: 'navigation' | 'wheel';
  setSection: (value: 'navigation' | 'wheel') => void;
  index: number;
  setIndex: (value: number) => void;
}) {
  const [draft, setDraft] = useState<QuickConfig>(snapshot.config);
  const save = useQuickAction(quickSnapshotSchema),
    preview = useQuickAction(z.null());
  const slots = section === 'navigation' ? draft.navigation : draft.wheel.slots;
  const update = (target: LaunchTarget | null) =>
    setDraft((current) =>
      section === 'navigation'
        ? {
            ...current,
            navigation: current.navigation.map((value, i) => (i === index ? target : value)),
          }
        : {
            ...current,
            wheel: {
              ...current.wheel,
              slots: current.wheel.slots.map((value, i) => (i === index ? target : value)),
            },
          },
    );
  const wheelPatch = (patch: Partial<QuickConfig['wheel']>) =>
    setDraft((current) => ({ ...current, wheel: { ...current.wheel, ...patch } }));
  const option = (target: LaunchTarget | null) =>
    snapshot.options.find((item) => targetKey(item.target) === targetKey(target));
  return (
    <div className="quick-settings-editor">
      <div className="quick-settings-tabs">
        <button
          type="button"
          className={section === 'navigation' ? 'active' : ''}
          onClick={() => {
            setSection('navigation');
            setIndex(0);
          }}
        >
          八个自定义导航
        </button>
        <button
          type="button"
          className={section === 'wheel' ? 'active' : ''}
          onClick={() => {
            setSection('wheel');
            setIndex(0);
          }}
        >
          桌面八向轮盘
        </button>
      </div>
      {section === 'navigation' ? (
        <>
          <p className="settings-note">
            将常用工具、游戏或页面固定到导航栏。选择位置后，在下方选择目标；清空位置不会删除游戏。
          </p>
          <div className="navigation-slot-editor">
            {draft.navigation.map((target, i) => (
              <button
                key={i}
                type="button"
                className={index === i ? 'selected' : ''}
                onClick={() => setIndex(i)}
              >
                <span>{String(i + 1).padStart(2, '0')}</span>
                <LaunchTargetIcon option={option(target)} />
                <strong>{option(target)?.label ?? (target ? '目标已移除' : '添加常用项目')}</strong>
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <label className="quick-setting-toggle">
            <span>
              <strong>启用桌面轮盘</strong>
              <small>长按 Tab 唤醒，移动鼠标选择，松开 Tab 启动。中心区域或 Esc 取消。</small>
            </span>
            <input
              type="checkbox"
              checked={draft.wheel.enabled}
              onChange={(e) => wheelPatch({ enabled: e.target.checked })}
            />
          </label>
          <div className="wheel-settings-layout">
            <div className="wheel-preview" role="group" aria-label="轮盘方向配置">
              {draft.wheel.slots.map((target, i) => {
                const angle = ((i * 45 - 90) * Math.PI) / 180;
                return (
                  <button
                    key={i}
                    type="button"
                    className={`wheel-preview-slot ${index === i ? 'selected' : ''}`}
                    style={{
                      left: `${50 + 35 * Math.cos(angle)}%`,
                      top: `${50 + 35 * Math.sin(angle)}%`,
                    }}
                    aria-label={`${DIRECTIONS[i]}方向`}
                    onClick={() => setIndex(i)}
                  >
                    <LaunchTargetIcon option={option(target)} />
                    <span>{option(target)?.label ?? '未配置'}</span>
                  </button>
                );
              })}
              <div className="wheel-preview-center">
                <Icon icon={faCircleNotch} />
                <strong>快捷轮盘</strong>
                <small>长按 Tab</small>
              </div>
            </div>
            <div className="wheel-options">
              <label>
                长按阈值 <strong>{draft.wheel.holdMs} ms</strong>
                <input
                  type="range"
                  min="200"
                  max="1500"
                  step="50"
                  value={draft.wheel.holdMs}
                  onChange={(e) => wheelPatch({ holdMs: Number(e.target.value) })}
                />
              </label>
              <label>
                轮盘大小 <strong>{draft.wheel.size} px</strong>
                <input
                  type="range"
                  min="300"
                  max="640"
                  step="10"
                  value={draft.wheel.size}
                  onChange={(e) => wheelPatch({ size: Number(e.target.value) })}
                />
              </label>
              <label>
                不透明度 <strong>{Math.round(draft.wheel.opacity * 100)}%</strong>
                <input
                  type="range"
                  min="35"
                  max="100"
                  value={Math.round(draft.wheel.opacity * 100)}
                  onChange={(e) => wheelPatch({ opacity: Number(e.target.value) / 100 })}
                />
              </label>
              <label>
                出现位置
                <select
                  value={draft.wheel.position}
                  onChange={(e) =>
                    wheelPatch({ position: e.target.value === 'center' ? 'center' : 'cursor' })
                  }
                >
                  <option value="cursor">鼠标所在位置</option>
                  <option value="center">当前屏幕中央</option>
                </select>
              </label>
              <label className="quick-check">
                <input
                  type="checkbox"
                  checked={draft.wheel.desktopOnly}
                  onChange={(e) => wheelPatch({ desktopOnly: e.target.checked })}
                />
                仅在 Windows 桌面响应
              </label>
              <p className="settings-note">
                默认不占用游戏和输入框的 Tab。关闭限制后会延迟短按 Tab 的响应；Ctrl / Alt / Shift /
                Win 组合仍透传。
              </p>
            </div>
          </div>
          <p className="settings-note">
            轮盘由托盘后台提供，启用后关闭主窗口将收至托盘；从托盘退出臻境后停止工作。总热键开关同样控制轮盘。滤镜和连点器仍须先在工具页授权。
          </p>
        </>
      )}
      <div className="quick-slot-picker">
        <h4>{section === 'navigation' ? `导航位置 ${index + 1}` : `${DIRECTIONS[index]}方向`}</h4>
        <TargetPicker
          key={`${section}-${index}`}
          options={snapshot.options}
          value={slots[index] ?? null}
          onChange={update}
        />
      </div>
      <Failure error={save.error ?? preview.error} />
      <div className="quick-settings-actions">
        <button
          type="button"
          className="settings-primary"
          disabled={save.isPending || !isDesktop()}
          onClick={() =>
            save.mutate({ operation: 'save', config: draft, revision: snapshot.revision })
          }
        >
          保存快捷配置
        </button>
        {section === 'wheel' && (
          <button
            type="button"
            disabled={preview.isPending || save.isPending}
            onClick={() => preview.mutate({ operation: 'preview' })}
          >
            <Icon icon={faWandMagicSparkles} />
            预览已保存轮盘
          </button>
        )}
        <span role="status">
          {snapshot.runtime.message ||
            (snapshot.config.wheel.enabled
              ? snapshot.runtime.ready
                ? '轮盘后台已就绪'
                : '轮盘未就绪或总热键已关闭'
              : '轮盘已关闭')}
        </span>
      </div>
    </div>
  );
}
export function QuickLaunchPanel() {
  const query = useQuickLaunch();
  // 服务版本更新只重建表单草稿；当前标签和选中方向保持，避免保存后跳回导航页。
  const [section, setSection] = useState<'navigation' | 'wheel'>('navigation');
  const [index, setIndex] = useState(0);
  return (
    <section className="quick-launch-settings" id="quick-launch-settings">
      <h3>自定义导航与桌面轮盘</h3>
      <Failure error={query.error} />
      {query.isPending && isDesktop() ? (
        <p className="settings-note">正在读取快捷配置…</p>
      ) : query.data ? (
        <Editor
          key={query.data.revision}
          snapshot={query.data}
          section={section}
          setSection={setSection}
          index={index}
          setIndex={setIndex}
        />
      ) : (
        <p className="settings-note">需要在桌面端管理真实快捷目标。</p>
      )}
    </section>
  );
}
