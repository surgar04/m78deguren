/** 公共壳只有视图元数据；业务信息始终读取原生 Query，不保留演示游戏模型。 */
export interface HomeData {
  source: 'local';
  date: string;
}
export type DialogState =
  | { kind: 'add' }
  | { kind: 'search' }
  | { kind: 'appearance' }
  | { kind: 'game-mode'; manual?: boolean }
  | { kind: 'random-image' }
  | { kind: 'announcements' }
  | { kind: 'shortcut'; id: string }
  | { kind: 'info'; title: string; description: string }
  | null;
