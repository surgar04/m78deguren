import { useId, type ReactNode } from 'react';
import { errorMessage } from '@/lib/desktop';
import { useText } from './i18n';

export function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="setting-row">
      <div>
        <strong>{label}</strong>
        {description && <p>{description}</p>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}
export function SettingToggle({
  label,
  description,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  const id = useId();
  return (
    <SettingRow label={label} description={description}>
      <button
        id={id}
        type="button"
        role="switch"
        aria-label={label}
        aria-checked={checked}
        disabled={disabled}
        className={`toggle ${checked ? 'on' : ''}`}
        onClick={() => onChange(!checked)}
      >
        <span />
      </button>
    </SettingRow>
  );
}
export function SettingSelect({
  label,
  value,
  options,
  onChange,
  description,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  description?: string;
}) {
  return (
    <SettingRow label={label} description={description}>
      <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </SettingRow>
  );
}
export function Failure({ error }: { error: unknown }) {
  return error ? (
    <p className="settings-error" role="alert">
      {errorMessage(error)}
    </p>
  ) : null;
}
/** 页面内可访问的复核区；危险操作必须点按独立确认，不能通过表单 Enter 意外执行。 */
export function Review({
  title,
  children,
  busy,
  onCancel,
  onConfirm,
  canConfirm = true,
}: {
  title: string;
  children: ReactNode;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  canConfirm?: boolean;
}) {
  const { t } = useText();
  return (
    <section className="settings-review" role="region" aria-label={title} tabIndex={-1}>
      <h3>{title}</h3>
      {children}
      <div className="settings-actions">
        <button type="button" disabled={busy} onClick={onCancel}>
          {t('取消')}
        </button>
        <button
          type="button"
          className="mint-button"
          disabled={busy || !canConfirm}
          onClick={onConfirm}
        >
          {t('确认')}
        </button>
      </div>
    </section>
  );
}
