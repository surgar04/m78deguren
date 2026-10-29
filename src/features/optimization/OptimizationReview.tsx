import { useEffect, useState, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { executeBuiltin, errorMessage } from '@/lib/desktop';
import {
  changePreviewSchema,
  changeReceiptSchema,
  systemChangeSchema,
} from '@/lib/builtin-contracts';
import { useOptimizationPreferences } from './store';
import { riskLabel, valueLabel } from './model';
import type { OptimizationSetting } from './types';

/** 选择、服务器预览、逐项确认与执行分离；未点击最终按钮不会申请 UAC 或写入系统。 */
export function OptimizationReview({
  entries: initialEntries,
  restoreId,
  onFinished,
}: {
  entries: { setting: OptimizationSetting; value: string; label: string }[];
  restoreId?: string;
  onFinished: (busy: boolean) => void;
}) {
  // 冻结本次用户草稿；成功清除全局草稿后，当前回执和已确认范围仍保留到关闭面板。
  const [entries] = useState(() => initialEntries);
  const queryClient = useQueryClient();
  const remove = useOptimizationPreferences((state) => state.remove);
  const appliedSuccessfully = useRef(false);
  const previewToken = useRef<string | null>(null);
  const mounted = useRef(false);
  const [confirmed, setConfirmed] = useState<string[]>([]),
    [consent, setConsent] = useState(false);
  const [expiresAt, setExpiresAt] = useState(0),
    [clock, setClock] = useState(() => Date.now());
  const prepare = useMutation({
    mutationFn: async () => {
      if (previewToken.current)
        await executeBuiltin(
          { operation: 'change-discard', token: previewToken.current },
          z.null(),
        );
      const change = systemChangeSchema.parse(
        restoreId
          ? { kind: 'restore', id: restoreId }
          : {
              kind: 'optimization',
              selections: entries.map((entry) => ({ id: entry.setting.id, value: entry.value })),
            },
      );
      return executeBuiltin({ operation: 'change-prepare', change }, changePreviewSchema);
    },
    onSuccess: (data) => {
      if (!mounted.current) {
        void executeBuiltin({ operation: 'change-discard', token: data.token }, z.null()).catch(
          () => undefined,
        );
        return;
      }
      previewToken.current = data.token;
      const now = Date.now();
      setClock(now);
      setExpiresAt(now + data.expiresInSeconds * 1000);
      setConfirmed([]);
      setConsent(false);
    },
  });
  const apply = useMutation({
    mutationFn: (token: string) =>
      executeBuiltin({ operation: 'change-apply', token, consent: true }, changeReceiptSchema),
    onSuccess: (receipt) => {
      if (receipt.state === 'completed') appliedSuccessfully.current = true;
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['optimization', 'snapshot'] }),
        queryClient.invalidateQueries({ queryKey: ['optimization', 'history'] }),
        queryClient.invalidateQueries({ queryKey: ['builtin'] }),
      ]);
    },
  });
  useEffect(() => {
    onFinished(apply.isPending);
    return () => onFinished(false);
  }, [apply.isPending, onFinished]);
  // 关闭回执后再清理草稿，避免清理导致当前审阅组件提前卸载、丢失执行结果。
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (previewToken.current)
        void executeBuiltin(
          { operation: 'change-discard', token: previewToken.current },
          z.null(),
        ).catch(() => undefined);
      if (appliedSuccessfully.current && !restoreId)
        for (const entry of entries) remove(entry.setting.id);
    };
  }, [entries, remove, restoreId]);
  useEffect(() => {
    if (!prepare.data || apply.data) return;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [prepare.data, apply.data]);
  const remaining = Math.max(0, Math.ceil((expiresAt - clock) / 1000));
  const allConfirmed =
    entries.length > 0 && entries.every((entry) => confirmed.includes(entry.setting.id));
  const busy = prepare.isPending || apply.isPending;
  return (
    <div className="optimization-review">
      <p className="modal-description">
        {restoreId
          ? '撤销这次修改并恢复 应用备份中的原始值。'
          : '将所选项写入系统；“恢复参考预设”使用参考配置，不能代替从备份撤销。'}
        所有操作保留 应用备份。部分配置需要重新登录或重启后体现，不会自动重启。
      </p>
      {entries.length === 0 ? (
        <p>没有待执行的配置。</p>
      ) : (
        <>
          <div className="optimization-review-actions">
            <strong>
              共 {entries.length} 项 · 高风险{' '}
              {entries.filter((entry) => entry.setting.definition.risk === 'high').length} 项
            </strong>
          </div>
          <div className="optimization-confirm-list">
            {entries.map((entry) => (
              <label key={entry.setting.id} className="optimization-confirm-row">
                <input
                  type="checkbox"
                  aria-label={`确认${entry.setting.name}`}
                  disabled={!prepare.data || busy || Boolean(apply.data)}
                  checked={confirmed.includes(entry.setting.id)}
                  onChange={(event) =>
                    setConfirmed((previous) =>
                      event.target.checked
                        ? [...previous, entry.setting.id]
                        : previous.filter((id) => id !== entry.setting.id),
                    )
                  }
                />
                <span>
                  <strong>{entry.setting.name}</strong>
                  <small>{restoreId ? '恢复备份原值' : entry.label}</small>
                </span>
                <span className={`optimization-risk risk-${entry.setting.definition.risk}`}>
                  {riskLabel[entry.setting.definition.risk]}
                </span>
              </label>
            ))}
          </div>
          <p className="inline-note">
            所有项目均须逐项勾选。关闭安全保护、服务或应用权限可能影响系统功能；高风险项目不属于安全/增强预设。
          </p>
          <button
            type="button"
            className="mint-button"
            disabled={busy || Boolean(apply.data)}
            onClick={() => {
              // 令牌在提交时即被消费；失败重试必须重新读取现值并获取新的单次令牌。
              apply.reset();
              prepare.mutate();
            }}
          >
            {prepare.isPending
              ? '正在读取实际值…'
              : prepare.data
                ? '重新生成修改预览'
                : '生成修改预览'}
          </button>
        </>
      )}
      {prepare.data && (
        <section className="optimization-prepared" aria-label="实际修改预览">
          <h3>{prepare.data.preview.title}</h3>
          <p>
            预览有效期：{remaining} 秒 · {prepare.data.preview.changes.length} 个实际值变更 ·{' '}
            {prepare.data.preview.restartRequired ? '需要自行重启或重新登录' : '无需重启'}
          </p>
          <details>
            <summary>查看操作说明</summary>
            <ul>
              {prepare.data.preview.summary.map((text, index) => (
                <li key={`${index}:${text}`}>{text}</li>
              ))}
            </ul>
          </details>
          <details>
            <summary>查看实际值与目标值</summary>
            <div className="optimization-registry-list">
              {prepare.data.preview.changes.map((row) => (
                <article key={`${row.path}|${row.name}`}>
                  <code>
                    {row.path}
                    <br />
                    {row.name || '（默认值）'}
                  </code>
                  <p>当前：{valueLabel(row.before)}</p>
                  <p>目标：{valueLabel(row.after)}</p>
                </article>
              ))}
            </div>
          </details>
          <label className="optimization-final-consent">
            <input
              type="checkbox"
              checked={consent}
              disabled={busy || Boolean(apply.data)}
              onChange={(event) => setConsent(event.target.checked)}
            />
            我已逐项核对风险、实际修改和重启要求，同意执行所列配置。
          </label>
          <button
            type="button"
            className="mint-button"
            disabled={
              !allConfirmed || !consent || remaining === 0 || busy || apply.status !== 'idle'
            }
            onClick={() => {
              if (prepare.data && remaining > 0) apply.mutate(prepare.data.token);
            }}
          >
            {apply.isPending ? '正在执行，请勿关闭…' : '确认并执行系统修改'}
          </button>
          {remaining === 0 && !apply.data && <p role="status">预览已过期，请重新生成后确认。</p>}
        </section>
      )}
      {(prepare.error || apply.error) && (
        <p className="optimization-notice" role="alert">
          {errorMessage(apply.error ?? prepare.error)}
          {apply.error ? ' 请重新生成修改预览，再核对并确认；旧令牌不能重复提交。' : ''}
        </p>
      )}
      {apply.data && (
        <p
          className="optimization-notice"
          role={apply.data.state === 'completed' ? 'status' : 'alert'}
        >
          {apply.data.message}
          {apply.data.restartRequired ? ' 请保存工作后自行重启或重新登录。' : ''}{' '}
          可在修改记录中查看结果与恢复入口。
        </p>
      )}
    </div>
  );
}
