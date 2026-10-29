import { describe, expect, it } from 'vitest';
import type { ToolCatalog } from './types';
// 仅用于选择器边界测试，不进入应用运行时。
const catalogFixture: ToolCatalog = {
  source: 'native',
  tools: [
    {
      id: 'crosshair',
      name: '辅助准心',
      category: 'gaming',
      icon: 'crosshair',
      tone: 'mint',
      origin: 'builtin',
      description: '自定义屏幕准心样式与显示设置，提升游戏瞄准体验。',
      aliases: ['crosshair', '准星', '屏幕叠加'],
      details: [],
    },
    {
      id: 'screen-test',
      name: '屏幕测试',
      category: 'gaming',
      icon: 'display',
      tone: 'blue',
      origin: 'builtin',
      description: '提供多种测试图案，检测屏幕显示效果与坏点情况。',
      aliases: ['display', 'monitor', '坏点', '显示器', '屏幕'],
      details: [],
    },
    {
      id: 'recordings',
      name: '录屏管理',
      category: 'gaming',
      icon: 'film',
      tone: 'violet',
      origin: 'builtin',
      description: '浏览和管理已录制的游戏视频，支持预览、重命名与删除。',
      aliases: ['video', 'recording', '视频', '录像', '录屏'],
      details: [],
    },
    {
      id: 'downloads',
      name: '下载加速',
      category: 'network',
      icon: 'download',
      tone: 'mint',
      origin: 'builtin',
      description: '管理下载任务，支持多线程加速下载游戏或文件。',
      aliases: ['download', 'URL', '下载', '链接', '多连接'],
      details: [],
    },
    {
      id: 'speed-test',
      name: '网络测速',
      category: 'network',
      icon: 'wifi',
      tone: 'blue',
      origin: 'builtin',
      description: '测试当前网络连接的延迟、上传与下载速度。',
      aliases: ['speed', 'ping', '网络', '测速', '延迟'],
      details: [],
    },
    {
      id: 'time-sync',
      name: '时间同步',
      category: 'network',
      icon: 'clock',
      tone: 'violet',
      origin: 'builtin',
      description: '查询系统时间与标准时间的偏差，便于进行时间同步。',
      aliases: ['NTP', 'time', '校时', '时钟', '同步'],
      details: [],
    },
    {
      id: 'runtimes',
      name: '运行库修复',
      category: 'maintenance',
      icon: 'runtime',
      tone: 'orange',
      origin: 'builtin',
      description: '检测常用运行库组件是否完整，为游戏安装前做好环境检查。',
      aliases: ['runtime', 'VC++', '.NET', 'DirectX', '组件'],
      details: [],
    },
    {
      id: 'crash-logs',
      name: '蓝屏日志',
      category: 'maintenance',
      icon: 'log',
      tone: 'rose',
      origin: 'builtin',
      description: '查看系统事件与蓝屏转储文件的关键信息，辅助定位问题原因。',
      aliases: ['BSOD', 'BugCheck', 'Minidump', '崩溃', '转储'],
      details: [],
    },
  ],
  external: {
    id: 'external-tools',
    name: '外部工具库',
    category: 'maintenance',
    icon: 'box',
    tone: 'blue',
    origin: 'third-party',
    description: '收录实用的第三方游戏工具，提供官方来源与说明。',
    aliases: ['第三方', 'external', '工具库'],
    details: [],
  },
};
import { selectTools } from './catalog';

const options = { query: '', filter: 'all', favorites: [], recent: [] } as const;
describe('工具目录选择器', () => {
  it('内置计数不包含第三方入口，所有记录ID唯一', () => {
    const all = selectTools(catalogFixture, options);
    expect(catalogFixture.tools).toHaveLength(8);
    expect(all).toHaveLength(9);
    expect(new Set(all.map((entry) => entry.id)).size).toBe(9);
    expect(catalogFixture.external?.origin).toBe('third-party');
  });
  it('全角/大小写别名与多个关键词采用交集', () => {
    expect(
      selectTools(catalogFixture, { ...options, query: ' ＮＴＰ 同步 ' }).map((tool) => tool.id),
    ).toEqual(['time-sync']);
    expect(
      selectTools(catalogFixture, { ...options, query: 'BSOD' }).map((tool) => tool.id),
    ).toEqual(['crash-logs']);
    expect(
      selectTools(catalogFixture, {
        ...options,
        query: '测速 下载',
        filter: 'favorites',
        favorites: ['speed-test'],
      }).map((tool) => tool.id),
    ).toEqual(['speed-test']);
  });
  it('最近顺序独立于分类、忽略失效ID，选择过程不修改目录', () => {
    const before = structuredClone(catalogFixture);
    expect(
      selectTools(catalogFixture, {
        ...options,
        filter: 'recent',
        recent: ['time-sync', 'removed', 'crosshair'],
      }).map((tool) => tool.id),
    ).toEqual(['time-sync', 'crosshair']);
    expect(catalogFixture).toEqual(before);
  });
  it('无演示目录时，偏好中的旧ID不会恢复假记录', () => {
    expect(
      selectTools(
        { source: 'unavailable', tools: [], external: null },
        { ...options, filter: 'favorites', favorites: ['crosshair'] },
      ),
    ).toEqual([]);
  });
});
