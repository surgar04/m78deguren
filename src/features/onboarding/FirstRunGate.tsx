import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { isDesktop, errorMessage, desktopWindowLabel } from '@/lib/desktop';
import { useSetupStatus } from './repository';

/** 原生入口直达向导；本层还阻止深链接绕过首次启动页面。 */
export function FirstRunGate({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const auxiliary =
    desktopWindowLabel() !== 'main' &&
    [
      '/hud',
      '/desktop-island',
      '/performance-overlay',
      '/tool-overlay',
      '/sensor-monitor',
      '/screen-test',
    ].includes(pathname);
  const query = useSetupStatus(!auxiliary);
  if (auxiliary || !isDesktop()) return children;
  if (query.isPending)
    return (
      <main className="page-loading" role="status">
        正在检查首次启动状态…
      </main>
    );
  if (query.error)
    return (
      <main className="page-loading" role="alert">
        <p>{errorMessage(query.error)}</p>
        <button
          type="button"
          onClick={() => {
            void query.refetch();
          }}
        >
          重试
        </button>
      </main>
    );
  if (query.data && !query.data.progress.complete && pathname != '/setup')
    return <Navigate to="/setup" replace />;
  return children;
}
