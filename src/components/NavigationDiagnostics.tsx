import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { recordDiagnostic } from '@/lib/diagnostics';
/** 仅记录固定页面类别，不记录完整 URL、搜索串、游戏 ID 或用户自定义名称。 */
export function NavigationDiagnostics() {
  const { pathname } = useLocation();
  useEffect(() => {
    const segment = pathname.split('/')[1] ?? '';
    const pages = new Set([
      '',
      'library',
      'other-games',
      'hardware',
      'tools',
      'optimization',
      'settings',
      'music',
      'setup',
      'sensor-monitor',
      'hud',
      'crosshair',
      'screen-test',
      'desktop-lyrics',
    ]);
    const page = pages.has(segment) ? segment || 'home' : 'other';
    recordDiagnostic({
      level: 'info',
      event: 'navigation.changed',
      operation: page,
      trace: null,
      durationMs: null,
      message: null,
    });
  }, [pathname]);
  return null;
}
