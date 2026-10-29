import type { ReactNode } from 'react';
import { errorMessage } from '@/lib/desktop';
export function Failure({ error }: { error: unknown }) {
  return error ? (
    <p className="setup-error" role="alert">
      {errorMessage(error)}
    </p>
  ) : null;
}
export function Consent({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className="setup-consent">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}
