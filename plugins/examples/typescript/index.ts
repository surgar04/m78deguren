import { storage, view, type View } from '../../sdk/typescript/index.ts';

/** 公开的 lifecycle 与 WIT 一致；插件只能使用 SDK 提供的受限能力。 */
export const lifecycle = {
  invoke(command: string, input: string): string {
    // 迁移仅操作宿主提供的私有副本；确认版本之后宿主才原子切换代码与数据。
    if (command === 'migrate') {
      const target: unknown = JSON.parse(input);
      if (
        typeof target !== 'object' ||
        target === null ||
        !('to' in target) ||
        typeof target.to !== 'number' ||
        !Number.isSafeInteger(target.to) ||
        target.to < 1
      )
        throw new Error('无效迁移版本');
      return JSON.stringify({ dataVersion: target.to });
    }
    const value = storage.get('counter');
    const count =
      typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
    if (command === 'increment') storage.put('counter', count + 1);
    const result: View = {
      type: 'stack',
      children: [
        { type: 'heading', text: 'TypeScript 插件' },
        { type: 'metric', text: '私有计数', value: String(count) },
        { type: 'button', text: '增加计数', command: 'increment' },
      ],
    };
    return view(result);
  },
};
