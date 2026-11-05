import { z } from 'zod';
import { duesRequestSchema } from './dues-contracts.ts';

/** 插件 IPC 与声明式界面共享严格契约；未知字段不能透传为 HTML、CSS 或原生命令。 */
const id = z
  .string()
  .min(1)
  .max(96)
  .regex(/^[a-z][a-z0-9.-]*$/u);
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
export const pluginPermissionId = z.enum([
  'storage',
  'settings',
  'network',
  'notifications',
  'hardware.read',
  'games.read',
  'background',
  'file.read',
  'file.write',
]);
export const pluginPermissionSchema = z
  .object({
    id: pluginPermissionId,
    reason: z.string().min(1).max(512),
    optional: z.boolean(),
    origins: z.array(z.string().url().max(2048)).max(16),
  })
  .strict();
export const pluginContributionSchema = z
  .object({
    id,
    title: z.string().min(1).max(160),
    kind: z.enum(['page', 'tool', 'widget', 'command']),
    command: id,
  })
  .strict();
export const pluginManifestSchema = z
  .object({
    formatVersion: z.literal(1),
    id,
    name: z.string().min(1).max(160),
    description: z.string().min(1).max(2048),
    version: z.string().min(1).max(100),
    publisher: z.string().min(1).max(160),
    language: z.enum(['typescript', 'csharp', 'rust']),
    runtime: z.literal('wasm-component'),
    api: z.string().max(100),
    host: z.string().max(100),
    entry: z.literal('component.wasm'),
    license: z.string().min(1).max(160),
    dataVersion: z.number().int().positive(),
    limits: z
      .object({
        memoryMb: z.number().int().min(16).max(256),
        storageMb: z.number().int().min(1).max(256),
        timeoutMs: z.number().int().min(100).max(30000),
        fuel: z.number().int().min(10000).max(500000000),
      })
      .strict(),
    permissions: z.array(pluginPermissionSchema).max(16),
    contributions: z.array(pluginContributionSchema).max(32),
    tasks: z
      .array(
        z
          .object({ id, command: id, intervalSeconds: z.number().int().min(60).max(86400) })
          .strict(),
      )
      .max(8),
    updateUrl: z.string().url().max(4096).nullable(),
  })
  .strict();
export const pluginRecordSchema = z
  .object({
    manifest: pluginManifestSchema,
    digest,
    publisherKey: digest.nullable(),
    grants: z.array(pluginPermissionId).max(16),
    enabled: z.boolean(),
    quarantined: z.boolean(),
    failures: z.number().int().nonnegative(),
    previous: digest.nullable(),
    running: z.boolean(),
  })
  .strict();
export const pluginSnapshotSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    safeMode: z.boolean(),
    runtimeAvailable: z.boolean(),
    notice: z.string().nullable(),
    items: z.array(pluginRecordSchema).max(128),
    nativeExtensions: z.literal(false),
    builtins: z
      .array(
        z
          .object({
            id,
            name: z.string().max(160),
            description: z.string().max(2048),
            version: z.string().max(100),
          })
          .strict(),
      )
      .max(16)
      .default([]),
  })
  .strict();
export const pluginPreviewSchema = z
  .object({
    ticket: z.uuid(),
    manifest: pluginManifestSchema,
    publisherKey: digest.nullable(),
    digest,
    previous: z.string().nullable(),
    addedPermissions: z.array(pluginPermissionId).max(16),
  })
  .strict();
export type PluginNode = {
  type: 'stack' | 'grid' | 'text' | 'heading' | 'button' | 'file' | 'metric' | 'notice';
  mode?: 'read' | 'write' | undefined;
  text?: string | undefined;
  value?: string | undefined;
  command?: string | undefined;
  children?: PluginNode[] | undefined;
};
const node: z.ZodType<PluginNode> = z.lazy(() =>
  z
    .object({
      type: z.enum(['stack', 'grid', 'text', 'heading', 'button', 'file', 'metric', 'notice']),
      mode: z.enum(['read', 'write']).optional(),
      text: z.string().min(1).max(8192).optional(),
      value: z.string().min(1).max(8192).optional(),
      command: id.optional(),
      children: z.array(node).max(200).optional(),
    })
    .strict(),
);
// 先检查未知输入，再交给递归 schema，避免恶意极深树在校验深度之前耗尽调用栈。
const boundedView = z.unknown().superRefine((input, context) => {
  const pending: [unknown, number][] = [[input, 0]];
  let count = 0;
  while (pending.length) {
    const item = pending.pop();
    if (!item) break;
    const [value, depth] = item;
    if (++count > 200 || depth > 8) {
      context.addIssue({ code: 'custom', message: '插件界面超过深度或节点数上限' });
      return;
    }
    if (
      typeof value === 'object' &&
      value !== null &&
      'children' in value &&
      Array.isArray(value.children)
    ) {
      if (value.children.length > 200) {
        context.addIssue({ code: 'custom', message: '子节点过多' });
        return;
      }
      for (const child of value.children as unknown[]) pending.push([child, depth + 1]);
    }
  }
});
export const pluginViewSchema = boundedView.pipe(
  node.superRefine((root, context) => {
    let count = 0;
    function visit(value: PluginNode, depth: number) {
      count++;
      if (depth > 8 || count > 200) {
        context.addIssue({ code: 'custom', message: '插件界面超过深度或节点数上限' });
        return;
      }
      if (value.children && !['stack', 'grid'].includes(value.type))
        context.addIssue({ code: 'custom', message: '当前节点不能包含子节点' });
      if (['button', 'file'].includes(value.type) && !value.command)
        context.addIssue({ code: 'custom', message: '按钮缺少操作' });
      if (!['button', 'file'].includes(value.type) && value.command)
        context.addIssue({ code: 'custom', message: '当前节点不能包含操作' });
      if ((value.type === 'file') !== Boolean(value.mode))
        context.addIssue({ code: 'custom', message: '文件选择器必须且只能设置文件模式' });
      value.children?.forEach((child) => visit(child, depth + 1));
    }
    visit(root, 0);
  }),
);
export const pluginRequestSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('snapshot') }).strict(),
  z.object({ operation: z.literal('builtin-dues'), request: duesRequestSchema }).strict(),
  z.object({ operation: z.literal('choose'), allowUnsigned: z.boolean() }).strict(),
  z.object({ operation: z.literal('cancel-preview'), ticket: z.uuid() }).strict(),
  z
    .object({
      operation: z.literal('install'),
      ticket: z.uuid(),
      grants: z.array(pluginPermissionId).max(16),
      revision: z.number().int().nonnegative(),
      consent: z.literal(true),
    })
    .strict(),
  z
    .object({
      operation: z.literal('configure'),
      id,
      digest,
      enabled: z.boolean(),
      grants: z.array(pluginPermissionId).max(16),
      revision: z.number().int().nonnegative(),
      consent: z.boolean(),
    })
    .strict(),
  z.object({ operation: z.literal('stop'), id }).strict(),
  z.object({ operation: z.literal('pick-file'), id, mode: z.enum(['read', 'write']) }).strict(),
  z
    .object({ operation: z.literal('safe-mode'), enabled: z.boolean(), consent: z.literal(true) })
    .strict(),
  z
    .object({
      operation: z.literal('uninstall'),
      id,
      purge: z.boolean(),
      revision: z.number().int().nonnegative(),
      consent: z.literal(true),
    })
    .strict(),
  z
    .object({
      operation: z.literal('rollback'),
      id,
      revision: z.number().int().nonnegative(),
      consent: z.literal(true),
    })
    .strict(),
  z.object({ operation: z.literal('update'), id }).strict(),
  z.object({ operation: z.literal('invoke'), id, command: id, input: z.unknown() }).strict(),
]);
export type PluginRequest = z.infer<typeof pluginRequestSchema>;
export type PluginRecord = z.infer<typeof pluginRecordSchema>;
export type PluginPreview = z.infer<typeof pluginPreviewSchema>;
export type PluginPermissionId = z.infer<typeof pluginPermissionId>;
export const PLUGIN_PERMISSION_NAMES: Record<PluginPermissionId, string> = {
  storage: '插件私有存储',
  settings: '基础界面信息',
  network: '指定网站网络请求',
  notifications: '应用内通知',
  'hardware.read': '硬件利用率摘要',
  'games.read': 'Steam 游戏名称与安装状态',
  background: '定时后台任务',
  'file.read': '由你逐次选择文件供插件读取',
  'file.write': '由你逐次选择新文件供插件写入',
};
export const pluginFileTicketSchema = z
  .object({ ticket: z.uuid(), name: z.string().min(1).max(512), mode: z.enum(['read', 'write']) })
  .strict();
