import { describe, expect, it } from 'vitest';
import { pluginViewSchema, pluginRequestSchema } from './plugin-contracts';

describe('插件前端边界', () => {
  it('拒绝任意 HTML、样式、URL 与未知 IPC 字段', () => {
    for (const value of [
      { type: 'html', text: 'x' },
      { type: 'text', text: 'x', style: 'display:none' },
      { type: 'text', text: 'x', url: 'https://example.com' },
    ])
      expect(pluginViewSchema.safeParse(value).success).toBe(false);
    expect(
      pluginRequestSchema.safeParse({
        operation: 'stop',
        id: 'test.plugin',
        path: 'D:/program.exe',
      }).success,
    ).toBe(false);
  });
  it('保留文本内容并校验按钮和树深度', () => {
    expect(
      pluginViewSchema.parse({ type: 'text', text: '<script>仅作为文本</script>' }).text,
    ).toContain('<script>');
    expect(pluginViewSchema.safeParse({ type: 'button', text: '按钮' }).success).toBe(false);
    let tree: unknown = { type: 'text', text: 'x' };
    for (let i = 0; i < 10; i++) tree = { type: 'stack', children: [tree] };
    expect(pluginViewSchema.safeParse(tree).success).toBe(false);
    // 先验证深度/节点总量，不能让递归 schema 遇到极深或循环输入时抛出 RangeError。
    for (let i = 0; i < 10000; i++) tree = { type: 'stack', children: [tree] };
    expect(pluginViewSchema.safeParse(tree).success).toBe(false);
    const cyclic: { type: string; children: unknown[] } = { type: 'stack', children: [] };
    cyclic.children.push(cyclic);
    expect(pluginViewSchema.safeParse(cyclic).success).toBe(false);
  });
  it('安装和删除需要显式确认，不能携带额外执行参数', () => {
    expect(
      pluginRequestSchema.safeParse({
        operation: 'uninstall',
        id: 'test.plugin',
        purge: false,
        revision: 0,
        consent: false,
      }).success,
    ).toBe(false);
    expect(
      pluginRequestSchema.safeParse({
        operation: 'install',
        ticket: crypto.randomUUID(),
        grants: [],
        revision: 0,
        consent: true,
      }).success,
    ).toBe(true);
  });
});
