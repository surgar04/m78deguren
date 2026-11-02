/** 可省略的是应用自身的重复询问，原生参数验证、版本校验及 Windows/Steam 的授权流程仍保留。 */
const OPTIONAL_CONFIRMATIONS = new Set([
  'game-mode',
  'shortcut-remove',
  'cache-clear',
  'hardware-history-clear',
  'steam-install',
  'steam-uninstall',
]);

/** 只有明确关闭开关且属于白名单的日常操作才直接执行；加载中、未知操作均默认需要确认。 */
export function requiresConfirmation(enabled: boolean | undefined, operation: string): boolean {
  return enabled !== false || !OPTIONAL_CONFIRMATIONS.has(operation);
}
