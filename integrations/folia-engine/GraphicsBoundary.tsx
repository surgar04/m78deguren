import { Component, type ReactNode } from 'react';

/** 第三方 GPU 渲染失败只隔离画面层，退出、选样式与音频控制仍保留。 */
export class GraphicsBoundary extends Component<
  { children: ReactNode; onFallback: () => void; resetKey: string },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidUpdate(
    previous: Readonly<{ children: ReactNode; onFallback: () => void; resetKey: string }>,
  ) {
    if (previous.resetKey !== this.props.resetKey && this.state.failed)
      this.setState({ failed: false });
  }
  render() {
    return this.state.failed ? (
      <div className="zj-graphics-error" role="alert">
        <p>当前图形设备无法完成这一样式。可以降低画质后重试，或使用静止样式继续听歌。</p>
        <button type="button" onClick={this.props.onFallback}>
          使用静止样式
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}
