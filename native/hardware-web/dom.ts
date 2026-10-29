/** 对静态模板也验证 DOM 类型，避免在导出文件缺少节点时静默生成空图。 */
export function element<T extends HTMLElement>(id: string, constructor: new () => T): T {
  const node = document.getElementById(id);
  if (!(node instanceof constructor)) throw new Error(`报告模板节点无效：${id}`);
  return node;
}
