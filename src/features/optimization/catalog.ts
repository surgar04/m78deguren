import type { z } from 'zod';
import type { optimizationCatalogSchema } from '@/lib/optimization-contracts';
import type { OptimizationCatalog, OptimizationCategory, OptimizationSetting } from './types';

// 常用入口使用与具体操作一致的图标、说明；其余项目沿用所属分类的视觉语言。
const FEATURED: Readonly<
  Record<string, Pick<OptimizationSetting, 'icon' | 'tone' | 'featuredDescription'>>
> = {
  showFileExtensions: {
    icon: 'file',
    tone: 'orange',
    featuredDescription: '在资源管理器中显示文件扩展名，便于识别文件类型。',
  },
  disableDwmAnimations: {
    icon: 'window',
    tone: 'blue',
    featuredDescription: '调整桌面窗口管理器的动画策略，重启或重新登录后核对效果。',
  },
};
/** 固定产品分类不是模拟数据；数量由 Rust 返回的完整白名单计算。 */
const CATEGORIES: Omit<OptimizationCategory, 'count'>[] = [
  {
    id: 'gaming',
    name: '游戏与图形',
    description: '游戏调度、DirectX 与桌面图形策略。',
    aliases: ['MMCSS', 'HDR', 'VRR', 'DWM', '游戏'],
    icon: 'gamepad',
    tone: 'blue',
  },
  {
    id: 'gpu',
    name: '显卡设置',
    description: '按实际厂商定位 NVIDIA、AMD 与 Intel 配置。',
    aliases: ['GPU', '显卡', '驱动'],
    icon: 'gpu',
    tone: 'violet',
  },
  {
    id: 'performance',
    name: '系统性能',
    description: '系统调度、交互响应及安全相关配置。',
    aliases: ['性能', 'CPU', '键盘', '鼠标'],
    icon: 'bolt',
    tone: 'violet',
  },
  {
    id: 'privacy',
    name: '隐私与权限',
    description: '遥测、广告、同步及应用访问权限。',
    aliases: ['隐私', '相机', '权限', '遥测'],
    icon: 'lock',
    tone: 'blue',
  },
  {
    id: 'ai',
    name: 'AI 功能',
    description: 'Copilot、Recall 与 AI Agent 系统策略。',
    aliases: ['AI', '人工智能', 'Recall', 'Copilot'],
    icon: 'ai',
    tone: 'violet',
  },
  {
    id: 'services',
    name: '系统服务',
    description: '按需配置系统服务的持久启动策略。',
    aliases: ['服务', '打印', '蓝牙', 'Search'],
    icon: 'gear',
    tone: 'violet',
  },
  {
    id: 'disk',
    name: '磁盘与文件系统',
    description: 'NTFS、文件命名与存储保留策略。',
    aliases: ['磁盘', 'NTFS', '存储'],
    icon: 'disk',
    tone: 'orange',
  },
  {
    id: 'apps',
    name: '应用设置',
    description: '后台应用、Edge、商店及文件菜单。',
    aliases: ['应用', 'Edge', '商店'],
    icon: 'apps',
    tone: 'mint',
  },
  {
    id: 'network',
    name: '网络设置',
    description: '网络节流、TCP、DNS 与网络栈策略。',
    aliases: ['网络', 'TCP', 'DNS', 'IPv4', 'AFD'],
    icon: 'wifi',
    tone: 'mint',
  },
  {
    id: 'explorer',
    name: '桌面与交互',
    description: '文件显示、任务栏、提示与桌面交互。',
    aliases: ['资源管理器', '文件', '桌面', '动画', '后缀名'],
    icon: 'display',
    tone: 'mint',
  },
  {
    id: 'audio',
    name: '音频设置',
    description: '声音效果、通信音量与音频服务。',
    aliases: ['声音', '音频', '空间音效'],
    icon: 'audio',
    tone: 'blue',
  },
];
export function createOptimizationCatalog(
  data: z.infer<typeof optimizationCatalogSchema>,
): OptimizationCatalog {
  const categories = CATEGORIES.map((category) => ({
    ...category,
    count: data.items.filter((item) => item.category === category.id).length,
  }));
  const settings = data.items.map((definition) => {
    const category = categories.find((category) => category.id === definition.category);
    if (!category) throw new Error('优化分类不完整');
    return {
      id: definition.id,
      categoryId: definition.category,
      name: definition.name,
      description: definition.description,
      aliases: [definition.id, category.name],
      icon: category.icon,
      tone: category.tone,
      ...FEATURED[definition.id],
      choices: [
        ...definition.variants.map((variant) => ({ value: variant.value, label: variant.label })),
        { value: 'restore', label: '恢复参考预设' },
      ],
      details: definition.notes,
      definition,
    };
  });
  return {
    source: 'native',
    categories,
    settings,
    featuredIds: ['showFileExtensions', 'disableDwmAnimations'],
    reference: data.source.commit,
  };
}
