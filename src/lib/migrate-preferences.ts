/** 改名只迁移已知界面偏好，不清空旧值；正式 Store 仍负责逐字段验证和移除旧演示状态。 */
export function migrateLegacyPreferences(storage: Storage): void {
  const names = [
    'settings.ui',
    'preferences',
    'home.preferences',
    'tools.preferences',
    'optimization.preferences',
  ];
  for (const name of names) {
    const current = `zhenjing.${name}`;
    if (storage.getItem(current) !== null) continue;
    const previous = storage.getItem(`xinjing.${name}`);
    if (previous === null || previous.length > 1_048_576) continue;
    try {
      JSON.parse(previous);
      storage.setItem(current, previous);
    } catch {
      // 原件不删除；损坏的单个记录不会阻断其他偏好或应用启动。
      continue;
    }
  }
}
if (typeof localStorage !== 'undefined') {
  try {
    migrateLegacyPreferences(localStorage);
  } catch {
    /* 存储不可用时由 Store 使用安全默认值。 */
  }
}
