/** “未绑定”是有效的按键状态；只有资料缺项占位符需要隐藏。 */
export function filledSetting(...values: (string | undefined)[]) {
  const empty = new Set(['', '—', '-', '未填写', '待完善', '未设置', 'N/A', '暂无']);
  return values.some((value) => value !== undefined && !empty.has(value.trim()));
}
