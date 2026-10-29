import { useState } from 'react';
import {
  changePreviewSchema,
  changeReceiptSchema,
  type SystemChange,
} from '@/lib/builtin-contracts';
import { useBuiltinAction } from './builtin-hooks';

/** 每次预览都重置确认；一次性凭据只能提交与当前预览对应的具体操作。 */
export function useSystemChange() {
  const preview = useBuiltinAction(changePreviewSchema),
    apply = useBuiltinAction(changeReceiptSchema);
  const [consent, setConsent] = useState(false);
  const prepare = (change: SystemChange) => {
    setConsent(false);
    apply.reset();
    preview.mutate({ operation: 'change-prepare', change });
  };
  return {
    preview,
    apply,
    consent,
    setConsent,
    prepare,
    busy: preview.isPending || apply.isPending,
  };
}
