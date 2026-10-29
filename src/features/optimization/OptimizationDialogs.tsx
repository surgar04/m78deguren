import { useState } from 'react';
import { Modal } from '@/features/home/components/Modal';
import { errorMessage } from '@/lib/desktop';
import { OptimizationSymbol } from './OptimizationCards';
import { useOptimizationPreferences } from './store';
import { currentLabel, draftEntries, riskLabel, valueLabel } from './model';
import { useOptimizationHistory } from './repository';
import { OptimizationReview } from './OptimizationReview';
import type {
  OptimizationCatalog,
  OptimizationCategoryId,
  OptimizationRow,
  OptimizationSetting,
  OptimizationSnapshot,
} from './types';

export type OptimizationDialog =
  | { kind: 'category'; id: OptimizationCategoryId }
  | { kind: 'setting'; id: string }
  | { kind: 'history' }
  | { kind: 'review' }
  | { kind: 'undo'; id: string };

export function OptimizationSettingList({
  settings,
  snapshot,
  onOpen,
}: {
  settings: readonly OptimizationSetting[];
  snapshot?: OptimizationSnapshot;
  onOpen: (id: string) => void;
}) {
  const rows = new Map(snapshot?.rows.map((row) => [row.id, row]));
  return (
    <div className="optimization-setting-list">
      {settings.map((setting) => (
        <button type="button" key={setting.id} onClick={() => onOpen(setting.id)}>
          <OptimizationSymbol icon={setting.icon} tone={setting.tone} />
          <span>
            <strong>{setting.name}</strong>
            <small>{setting.description}</small>
          </span>
          <span className="optimization-row-meta">
            <span className={`optimization-risk risk-${setting.definition.risk}`}>
              {riskLabel[setting.definition.risk]}
            </span>
            <small>{currentLabel(setting, rows.get(setting.id))}</small>
          </span>
        </button>
      ))}
    </div>
  );
}
function SettingEditor({
  setting,
  row,
  onReview,
}: {
  setting: OptimizationSetting;
  row?: OptimizationRow;
  onReview: () => void;
}) {
  const stage = useOptimizationPreferences((state) => state.stage);
  const drafts = useOptimizationPreferences((state) => state.drafts);
  const [target, setTarget] = useState(
    () => drafts.find((draft) => draft.id === setting.id)?.value ?? setting.definition.defaultValue,
  );
  const [notice, setNotice] = useState('');
  const unavailable = !row || row.state === 'error' || row.state === 'unsupported';
  return (
    <div className="optimization-editor">
      <div className="optimization-detail-summary">
        <OptimizationSymbol icon={setting.icon} tone={setting.tone} />
        <p>{setting.description}</p>
        <span className={`optimization-risk risk-${setting.definition.risk}`}>
          {riskLabel[setting.definition.risk]}
        </span>
      </div>
      <p>
        实际状态：<strong>{currentLabel(setting, row)}</strong>
      </p>
      <ul>
        {setting.details.map((detail) => (
          <li key={detail}>{detail}</li>
        ))}
        <li>参考预设恢复可能覆盖自定义值；精确撤销请使用修改记录中的备份恢复。</li>
      </ul>
      {row?.error && <p role="alert">{row.error}</p>}
      {row?.skipped.map((note) => (
        <p key={note} className="inline-note">
          {note}
        </p>
      ))}
      <label>
        目标配置
        <select value={target} onChange={(event) => setTarget(event.target.value)}>
          {setting.choices.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
      </label>
      <div className="optimization-dialog-actions">
        <button
          type="button"
          className="mint-button"
          disabled={unavailable}
          onClick={() => {
            const choice = setting.choices.find((choice) => choice.value === target);
            if (!choice) {
              setNotice('不支持此目标值');
              return;
            }
            stage({ id: setting.id, value: target });
            onReview();
          }}
        >
          审阅并应用此项
        </button>
        <button
          type="button"
          className="optimization-secondary"
          disabled={unavailable}
          onClick={() => {
            if (!setting.choices.some((choice) => choice.value === target)) {
              setNotice('不支持此目标值');
              return;
            }
            stage({ id: setting.id, value: target });
            setNotice('已加入待应用；尚未修改系统。');
          }}
        >
          加入待应用
        </button>
      </div>
      {unavailable && (
        <p className="inline-note">请先完成实际扫描；不适用或读取失败的项目不能应用。</p>
      )}
      {notice && <p role="status">{notice}</p>}
      <details>
        <summary>查看实际注册表读数（{row?.checks.length ?? 0}）</summary>
        <div className="optimization-registry-list">
          {row?.checks.map((check) => (
            <article key={`${check.path}|${check.name}`}>
              <code>
                {check.path}
                <br />
                {check.name || '（默认值）'}
              </code>
              <p>当前：{valueLabel(check.current)}</p>
              <p>默认目标参考：{valueLabel(check.target)}</p>
            </article>
          ))}
        </div>
      </details>
      <p className="inline-note">
        下拉选择后的实际目标值，会在服务器生成的修改预览中再次展示；未确认前不会执行。
      </p>
    </div>
  );
}
/** 分类与编辑仍使用同一磨砂对话框；执行记录和本机状态只引用 Query。 */
export function OptimizationDialogs({
  dialog,
  catalog,
  snapshot,
  onClose,
  onChange,
}: {
  dialog: OptimizationDialog;
  catalog: OptimizationCatalog;
  snapshot?: OptimizationSnapshot;
  onClose: () => void;
  onChange: (dialog: OptimizationDialog) => void;
}) {
  const [busy, setBusy] = useState(false),
    [risk, setRisk] = useState('all');
  const drafts = useOptimizationPreferences((state) => state.drafts),
    remove = useOptimizationPreferences((state) => state.remove),
    clear = useOptimizationPreferences((state) => state.clear);
  const history = useOptimizationHistory(dialog.kind === 'history' || dialog.kind === 'undo');
  const category =
    dialog.kind === 'category'
      ? catalog.categories.find((category) => category.id === dialog.id)
      : undefined;
  const setting =
    dialog.kind === 'setting'
      ? catalog.settings.find((setting) => setting.id === dialog.id)
      : undefined;
  const settingRow = setting ? snapshot?.rows.find((row) => row.id === setting.id) : undefined;
  const record =
    dialog.kind === 'undo' ? history.data?.find((record) => record.id === dialog.id) : undefined;
  const review =
    dialog.kind === 'undo'
      ? (record?.itemIds.flatMap((id) => {
          const setting = catalog.settings.find((setting) => setting.id === id);
          return setting ? [{ setting, value: 'restore', label: '备份原值' }] : [];
        }) ?? [])
      : draftEntries(catalog, drafts);
  const title =
    category?.name ??
    setting?.name ??
    (dialog.kind === 'history'
      ? '修改记录'
      : dialog.kind === 'undo'
        ? '从备份撤销修改'
        : '待应用配置');
  return (
    <Modal
      title={title}
      wide
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="optimization-dialog-content">
        {busy && (
          <p role="status">正在执行确认的系统修改，请等待回执。意外退出后可从修改记录检查恢复。</p>
        )}
        {category ? (
          <>
            <p className="modal-description">
              {category.description} · 共 {category.count} 项，按本机扫描结果展示。
            </p>
            <label className="optimization-risk-filter">
              风险等级
              <select value={risk} onChange={(event) => setRisk(event.target.value)}>
                <option value="all">全部风险</option>
                <option value="low">低风险</option>
                <option value="medium">中风险</option>
                <option value="high">高风险</option>
              </select>
            </label>
            <OptimizationSettingList
              settings={catalog.settings.filter(
                (setting) =>
                  setting.categoryId === category.id &&
                  (risk === 'all' || setting.definition.risk === risk),
              )}
              {...(snapshot ? { snapshot } : {})}
              onOpen={(id) => onChange({ kind: 'setting', id })}
            />
          </>
        ) : setting ? (
          <SettingEditor
            key={setting.id}
            setting={setting}
            {...(settingRow ? { row: settingRow } : {})}
            onReview={() => onChange({ kind: 'review' })}
          />
        ) : dialog.kind === 'history' ? (
          <>
            <p className="modal-description">
              这里只显示实际执行回执。撤销整次优化会恢复该次批量操作前的原始值；已有后续修改时拒绝覆盖。
            </p>
            {history.isPending && <p role="status">正在读取记录…</p>}
            {history.error && <p role="alert">{errorMessage(history.error)}</p>}
            {history.data?.length === 0 && <p>尚未执行系统优化；草稿不属于修改记录。</p>}
            <div className="optimization-history-list">
              {history.data?.map((record) => (
                <article key={record.id}>
                  <div>
                    <strong>{record.title}</strong>
                    <small>
                      {new Date(record.createdAt).toLocaleString('zh-CN')} ·{' '}
                      {
                        {
                          completed: '完成',
                          failed: '失败',
                          cancelled: '取消',
                          running: '执行中或待核实',
                          unknown: '结果未确认',
                        }[record.state]
                      }
                    </small>
                    <p>{record.message}</p>
                  </div>
                  {record.reversible && (
                    <button
                      type="button"
                      className="optimization-secondary"
                      onClick={() => onChange({ kind: 'undo', id: record.id })}
                    >
                      审阅并撤销整次修改
                    </button>
                  )}
                </article>
              ))}
            </div>
          </>
        ) : (
          <>
            {dialog.kind === 'review' && review.length > 0 && (
              <div className="optimization-draft-toolbar">
                <button
                  type="button"
                  className="optimization-secondary"
                  onClick={clear}
                  disabled={busy}
                >
                  清空待应用
                </button>
                <details>
                  <summary>移除个别草稿</summary>
                  {review.map((entry) => (
                    <button
                      type="button"
                      key={entry.setting.id}
                      disabled={busy}
                      onClick={() => remove(entry.setting.id)}
                    >
                      移除 {entry.setting.name}
                    </button>
                  ))}
                </details>
              </div>
            )}
            {dialog.kind === 'undo' && history.isPending ? (
              <p role="status">正在读取备份记录…</p>
            ) : dialog.kind === 'undo' && history.error ? (
              <p role="alert">读取备份记录失败：{errorMessage(history.error)}</p>
            ) : dialog.kind === 'undo' && !record ? (
              <p role="alert">没有找到这次修改的备份记录，请关闭后刷新修改记录。</p>
            ) : (
              <OptimizationReview
                key={
                  dialog.kind === 'undo'
                    ? dialog.id
                    : review.map((entry) => entry.setting.id + ':' + entry.value).join('|')
                }
                entries={review}
                {...(dialog.kind === 'undo' ? { restoreId: dialog.id } : {})}
                onFinished={setBusy}
              />
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
