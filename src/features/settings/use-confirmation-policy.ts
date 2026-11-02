import { requiresConfirmation } from '@/lib/confirmation-policy';
import { useSettingsSnapshot } from './repository';

/** 共用同一份原生偏好查询，不把确认策略另存为本地状态，避免跨页面开关不同步。 */
export function useConfirmationPolicy() {
  const enabled = useSettingsSnapshot().data?.config.confirmActions;
  return (operation: string) => requiresConfirmation(enabled, operation);
}
