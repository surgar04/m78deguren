import './check-environment.ts';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { z } from 'zod';
import { format, resolveConfig } from 'prettier';

/** 只读取固定参考仓库的 AST 和 .reg 数据；不 import/执行其 TS，也不调用 reg import。 */
const root = resolve(import.meta.dirname, '../.cache/references/NexBox');
const destination = resolve(
  import.meta.dirname,
  '../src-tauri/src/services/tools/windows/optimizer-catalog.json',
);
const text = await readFile(resolve(root, 'src/config/system-optimizer.ts'), 'utf8');
const ast = ts.createSourceFile('system-optimizer.ts', text, ts.ScriptTarget.Latest, true);
const metadata = z.array(
  z.object({
    id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9]+$/u),
    regName: z.string(),
    category: z.string(),
    titleKey: z.string(),
    risk: z.enum(['low', 'medium', 'high']),
    options: z
      .array(z.object({ value: z.string(), labelKey: z.string(), regName: z.string() }))
      .optional(),
    defaultSelectValue: z.string().optional(),
  }),
);
function literal(node: ts.Node): unknown {
  if (ts.isStringLiteral(node)) return node.text;
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(literal);
  if (ts.isObjectLiteralExpression(node))
    return Object.fromEntries(
      node.properties.flatMap((property) =>
        ts.isPropertyAssignment(property) &&
        [
          'id',
          'regName',
          'category',
          'titleKey',
          'risk',
          'options',
          'value',
          'labelKey',
          'defaultSelectValue',
        ].includes(property.name.getText(ast))
          ? [[property.name.getText(ast), literal(property.initializer)]]
          : [],
      ),
    );
  throw new Error('参考配置包含不支持的动态表达式');
}
let input: unknown;
function visit(node: ts.Node) {
  if (
    ts.isVariableDeclaration(node) &&
    node.name.getText(ast) === 'optimizerItems' &&
    node.initializer
  )
    input = literal(node.initializer);
  ts.forEachChild(node, visit);
}
visit(ast);
const definitions = metadata.parse(input);
const locale: unknown = JSON.parse(await readFile(resolve(root, 'src/locales/zh.json'), 'utf8'));
function translate(key: string): string {
  let value: unknown = locale;
  for (const field of key.split('.')) value = z.record(z.string(), z.unknown()).parse(value)[field];
  return z.string().min(1).parse(value);
}
type Operation = {
  path: string;
  name: string;
  kind: 'DWord' | 'String';
  value: string | null;
  mode?: 'string-map';
  referenceValue?: string | null;
};
/** 参考资源只含 DWORD/字符串/删除值。遇到未知语法即中止导入，不能静默漏项。 */
async function registry(file: string): Promise<{ operations: Operation[]; pruneKeys: string[] }> {
  const bytes = await readFile(resolve(root, file));
  const source = (
    bytes[0] === 255 && bytes[1] === 254
      ? bytes.subarray(2).toString('utf16le')
      : bytes.toString('utf8')
  ).replace(/^\uFEFF/u, '');
  let path = '';
  const operations: Operation[] = [],
    pruneKeys: string[] = [];
  for (const original of source.split(/\r?\n/u)) {
    const line = original.trim();
    if (
      !line ||
      line.startsWith(';') ||
      line === 'Windows Registry Editor Version 5.00' ||
      line === '!MADE BY OGTech!'
    )
      continue;
    const section =
      /^\[(-?)(HKEY_(?:LOCAL_MACHINE|CURRENT_USER|CLASSES_ROOT|USERS)\\[^\]]+)\]$/u.exec(line);
    if (section) {
      path = z.string().parse(section[2]);
      if (section[1]) pruneKeys.push(path);
      continue;
    }
    const assignment = /^(@|"(?:\\.|[^"\\])*")=(.*)$/u.exec(line);
    if (!assignment || !path) throw new Error(`不支持的注册表语法：${file}: ${line}`);
    const rawName = z.string().parse(assignment[1]),
      rawValue = z.string().parse(assignment[2]);
    const name = rawName === '@' ? '' : z.string().parse(JSON.parse(rawName));
    if (rawValue === '-') operations.push({ path, name, kind: 'String', value: null });
    else if (/^dword:[\da-f]{8}$/iu.test(rawValue))
      operations.push({
        path,
        name,
        kind: 'DWord',
        value: Number.parseInt(rawValue.slice(6), 16).toString(),
      });
    else if (rawValue.startsWith('"'))
      operations.push({
        path,
        name,
        kind: 'String',
        value: z.string().parse(JSON.parse(rawValue)),
      });
    else throw new Error(`未覆盖的注册表类型：${file}: ${line}`);
  }
  return { operations, pruneKeys };
}
const high = new Set([
  'disableUAC',
  'disableCFG',
  'disableSEHOP',
  'disableSmartScreen',
  'disableFirewallSvc',
  'disableSpectreMeltdown',
  'disableDCOM',
  'disableSMBv2',
  'disableSystemRestore',
  'disableSecurityNotifications',
  'disableUCPD',
]);
const medium = new Set([
  'shortenTaskTimeout',
  'shortenServiceTimeout',
  'nvmeTuning',
  'disableOneDriveSync',
  'disableWindowsSearchSvc',
  'disableXboxServices',
  'disableBcastDVR',
  'disableXboxGameMonitoring',
]);
const descriptions: Record<string, string> = {
  gaming: '调整对应游戏与图形策略；实际效果取决于 Windows、驱动和游戏支持。',
  gpu: '调整对应厂商的驱动配置；可能影响功耗、画面或显示功能。',
  performance: '调整系统调度或交互配置；需要结合具体负载验证效果。',
  privacy: '调整数据收集或访问权限；可能影响依赖相关权限的应用功能。',
  ai: '调整对应 AI 功能策略；系统版本与组件支持决定其实际效果。',
  services: '修改相关服务或系统功能的持久配置；不强制停止当前运行的服务。',
  disk: '调整文件系统策略；请先了解对存储兼容性和既有工作流的影响。',
  apps: '调整应用相关的系统策略；受应用版本及管理策略影响。',
  network: '调整对应网络策略；注册表匹配不等于当前网络栈已经采用该值。',
  explorer: '调整资源管理器或桌面交互；部分配置需要重新登录后体现。',
  audio: '调整对应声音策略；效果取决于音频端点及驱动实现。',
};
const rows = [];
for (const item of definitions) {
  const variants = [];
  for (const option of item.options ?? [
    { value: 'apply', labelKey: item.titleKey, regName: item.regName },
  ]) {
    const parsed = await registry(`aq_registry/${option.regName}.reg`);
    assert.equal(parsed.pruneKeys.length, 0, '应用资源不应删除整棵注册表键');
    assert.ok(parsed.operations.length, `${item.id} 没有可应用配置`);
    variants.push({
      value: option.value,
      label: item.options ? translate(option.labelKey) : '应用配置',
      operations: parsed.operations,
    });
  }
  const restore = await registry(`aq_registry_restore/${item.regName}.restore.reg`);
  // 删除键的恢复模板收敛为“仅删除本项拥有的值，空键再清理”，保留用户添加的无关配置。
  for (const path of restore.pruneKeys)
    for (const variant of variants)
      for (const operation of variant.operations) {
        if (
          (operation.path === path || operation.path.startsWith(path + '\\')) &&
          !restore.operations.some(
            (row) => row.path === operation.path && row.name === operation.name,
          )
        )
          restore.operations.push({ ...operation, value: null });
      }
  // 上游关闭语音识别顺带删除输入个性化策略，会与“禁用输入个性化”互相抵消。
  // 保留语音本身的 HasAccepted=0，不移除既有的输入个性化保护策略。
  if (item.id === 'disableOnlineSpeechRecognition')
    for (const variant of variants)
      variant.operations = variant.operations.filter(
        (operation) => operation.name !== 'AllowInputPersonalization',
      );
  if (item.id === 'disableOnlineSpeechRecognition')
    restore.operations = restore.operations.filter(
      (operation) => operation.name !== 'AllowInputPersonalization',
    );
  // DirectX 多个选项共用一个分号属性串；按属性合并，不能互相覆盖或清除用户其他偏好。
  for (const variant of variants)
    for (const operation of variant.operations)
      if (operation.name === 'DirectXUserGlobalSettings') operation.mode = 'string-map';
  for (const operation of restore.operations)
    if (operation.name === 'DirectXUserGlobalSettings') operation.mode = 'string-map';
  const vendor =
    item.category !== 'gpu'
      ? null
      : item.id === 'shaderCache' || item.id === 'amdPowerOptimization'
        ? 'amd'
        : item.id === 'intelGraphicsOptimization'
          ? 'intel'
          : 'nvidia';
  const risk = high.has(item.id)
    ? 'high'
    : medium.has(item.id) && item.risk === 'low'
      ? 'medium'
      : item.risk;
  rows.push({
    id: item.id,
    category: item.category,
    name: translate(item.titleKey),
    description: descriptions[item.category],
    risk,
    sourceRisk: item.risk,
    vendor,
    cpuVendor: item.id === 'intelTSX' ? 'intel' : null,
    defaultValue: item.defaultSelectValue ?? 'apply',
    variants,
    restore,
    safeEligible:
      risk === 'low' && !['gpu', 'services', 'network', 'disk', 'audio'].includes(item.category),
    securitySensitive: high.has(item.id),
    restartRequired: true,
    notes: [
      ...(item.id === 'disableOnlineSpeechRecognition'
        ? ['不删除输入个性化策略，避免与该项隐私配置相互抵消。']
        : []),
      ...(variants.some((variant) =>
        variant.operations.some((operation) => operation.mode === 'string-map'),
      )
        ? ['DirectX 共享属性串按字段更新，保留其他图形偏好。']
        : []),
      ...(vendor ? ['只对本机实际存在的对应厂商显卡定位配置，不创建 0000/0001 虚假设备。'] : []),
      ...(high.has(item.id) ? ['此项可能降低安全防护或关闭关键功能，不纳入安全或增强预设。'] : []),
      '匹配表示注册表配置一致，不代表系统或驱动已采用，也不保证性能提升。',
    ],
  });
}
// 上游多个恢复文件对同一值同时要求“写默认值”与“删除覆盖”，无法同时满足。
// 统一恢复为移除共享覆盖，保留原参考值用于审计；批量与单项恢复因此保持一致。
const sharedRestores = new Map<string, Operation[]>();
for (const row of rows)
  for (const operation of row.restore.operations) {
    const key = (operation.path + '|' + operation.name).toLowerCase();
    sharedRestores.set(key, [...(sharedRestores.get(key) ?? []), operation]);
  }
for (const row of rows)
  for (const operation of row.restore.operations) {
    const shared = sharedRestores.get((operation.path + '|' + operation.name).toLowerCase()) ?? [];
    if (operation.value !== null && shared.some((other) => other.value === null)) {
      operation.referenceValue = operation.value;
      operation.value = null;
      row.notes.push(
        `共享恢复键 ${operation.name} 的参考值存在冲突，统一移除覆盖以继承系统默认；原参考值 ${operation.referenceValue}。`,
      );
    }
  }
const counts: Record<string, number> = {};
for (const row of rows) counts[row.category] = (counts[row.category] ?? 0) + 1;
assert.deepEqual(counts, {
  gaming: 20,
  gpu: 14,
  performance: 33,
  privacy: 56,
  ai: 9,
  services: 22,
  disk: 6,
  apps: 6,
  network: 19,
  explorer: 11,
  audio: 5,
});
assert.equal(new Set(rows.map((row) => row.id)).size, 201);
const output = await format(
  JSON.stringify({
    version: 1,
    source: {
      repository: 'https://github.com/MuLiuSaMa/NexBox',
      commit: execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      items: 201,
    },
    items: rows,
  }),
  { ...(await resolveConfig(destination)), parser: 'json' },
);
if (process.argv.includes('--check'))
  assert.equal(await readFile(destination, 'utf8'), output, '配置目录已变化，请审核后重新生成');
else await writeFile(destination, output, 'utf8');
console.log(
  `完整导入 ${rows.length} 项配置，${Object.keys(counts).length} 类；仅提取配置事实，未执行任何系统操作。`,
);
