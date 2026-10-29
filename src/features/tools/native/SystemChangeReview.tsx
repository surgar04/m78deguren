import { z } from 'zod';
import { changeReceiptSchema } from '@/lib/builtin-contracts';
import { useBuiltinQuery } from './builtin-hooks';
import type { useSystemChange } from './use-system-change';
import { Feedback } from './Feedback';

export function SystemChangeReview({ control }: { control: ReturnType<typeof useSystemChange> }) {
  const plan = control.preview.data;
  const receipt = control.apply.data;
  return (
    <>
      <Feedback pending={control.busy} error={control.preview.error ?? control.apply.error} />
      {plan && !receipt && (
        <section className="native-change-review" aria-label="系统修改确认">
          <h4>{plan.preview.title}</h4>
          <ul>
            {plan.preview.summary.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p>
            {plan.preview.requiresAdmin ? '可能请求 Windows 管理员授权。' : ''}
            {plan.preview.restartRequired ? '修改后需要重启生效。' : ''}
            {plan.preview.reversible
              ? '原始配置备份保存在应用数据目录。'
              : '此操作不提供自动撤销，请先保存工作。'}
          </p>
          <label className="native-checkbox">
            <input
              type="checkbox"
              checked={control.consent}
              disabled={control.busy}
              onChange={(e) => control.setConsent(e.target.checked)}
            />
            我已阅读本项具体变更，确认执行
          </label>
          <button
            type="button"
            className="mint-button"
            disabled={!control.consent || control.busy}
            onClick={() =>
              control.apply.mutate({ operation: 'change-apply', token: plan.token, consent: true })
            }
          >
            执行本次修改
          </button>
          <p className="native-tool-note">
            确认凭据 {plan.expiresInSeconds} 秒内有效且仅能使用一次；配置变化后需要重新预览。
          </p>
        </section>
      )}
      {receipt && (
        <p
          role={receipt.state === 'failed' || receipt.state === 'unknown' ? 'alert' : 'status'}
          className="native-change-result"
        >
          <strong>{receipt.title}</strong> · {receipt.message}
        </p>
      )}
    </>
  );
}

export function SystemChangeHistory({ control }: { control: ReturnType<typeof useSystemChange> }) {
  const history = useBuiltinQuery({ operation: 'change-history' }, z.array(changeReceiptSchema));
  if (!history.data?.length) return <Feedback error={history.error} />;
  return (
    <details className="native-change-history">
      <summary>系统修改记录与恢复</summary>
      <div className="native-tool-list">
        {history.data.map((receipt) => (
          <div key={receipt.id} className="native-tool-list-row">
            <div>
              <strong>{receipt.title}</strong>
              <p>
                {new Date(receipt.createdAt).toLocaleString('zh-CN')} · {receipt.message}
              </p>
            </div>
            {receipt.reversible && (
              <button
                className="native-button"
                type="button"
                disabled={control.busy}
                onClick={() => control.prepare({ kind: 'restore', id: receipt.id })}
              >
                预览恢复
              </button>
            )}
          </div>
        ))}
      </div>
    </details>
  );
}
