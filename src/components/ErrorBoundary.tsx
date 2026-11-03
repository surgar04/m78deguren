import { Component, type ReactNode } from 'react';
import { recordException } from '@/lib/diagnostics';

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: Error) {
    recordException(error);
  }

  override render() {
    if (this.state.failed) {
      return (
        <main className="mx-auto max-w-lg p-12">
          <h1 className="text-2xl font-semibold">界面暂时无法显示</h1>
          <button
            className="button mt-6"
            onClick={() => {
              window.location.reload();
            }}
          >
            重新加载
          </button>
        </main>
      );
    }
    return this.props.children;
  }
}
