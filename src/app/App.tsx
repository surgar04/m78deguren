import { lazy, Suspense } from 'react';
import { HashRouter, Link, Navigate, Route, Routes } from 'react-router-dom';
import { FirstRunGate } from '@/features/onboarding/FirstRunGate';
const Setup = lazy(() => import('@/features/onboarding/SetupPage'));
const Overview = lazy(() => import('@/pages/Overview'));
const Settings = lazy(() => import('@/pages/Settings'));
const Library = lazy(() => import('@/pages/Library'));
const OtherGames = lazy(() => import('@/features/library/OtherGamesPage'));
const Hardware = lazy(() => import('@/pages/Hardware'));
const SensorMonitor = lazy(() => import('@/pages/SensorMonitor'));
const Tools = lazy(() => import('@/pages/Tools'));
const Optimization = lazy(() => import('@/pages/Optimization'));
const HudWindow = lazy(() => import('@/features/hud/HudWindow'));
const CrosshairOverlay = lazy(() =>
  import('@/features/tools/native/ScreenTools').then((module) => ({
    default: module.CrosshairOverlay,
  })),
);
const ScreenTestWindow = lazy(() =>
  import('@/features/tools/native/ScreenTools').then((module) => ({
    default: module.ScreenTestWindow,
  })),
);

/** 路由只负责页面边界；首页自己的查询、弹窗和视图状态不向应用根部扩散。 */
export function App() {
  return (
    <HashRouter>
      <button
        type="button"
        onClick={() => {
          document.getElementById('main-content')?.focus();
        }}
        className="skip-link"
      >
        跳到主要内容
      </button>
      <Suspense
        fallback={
          <div className="page-loading" role="status">
            正在打开臻境…
          </div>
        }
      >
        <FirstRunGate>
          <Routes>
            <Route path="/setup" element={<Setup />} />
            <Route path="/hud" element={<HudWindow />} />
            <Route path="/desktop-island" element={<Navigate to="/hud" replace />} />
            <Route path="/performance-overlay" element={<Navigate to="/hud" replace />} />
            <Route path="/tool-overlay" element={<CrosshairOverlay />} />
            <Route path="/screen-test" element={<ScreenTestWindow />} />
            <Route path="/" element={<Overview />} />
            <Route path="/library" element={<Library />} />
            <Route path="/library/other" element={<OtherGames />} />
            <Route path="/hardware" element={<Hardware />} />
            <Route path="/sensor-monitor" element={<SensorMonitor />} />
            <Route path="/tools/:toolId?" element={<Tools />} />
            <Route path="/optimization" element={<Optimization />} />
            <Route path="/settings" element={<Settings />} />
            <Route
              path="*"
              element={
                <main className="not-found-page">
                  <h1>页面不存在</h1>
                  <Link to="/">返回首页</Link>
                </main>
              }
            />
          </Routes>
        </FirstRunGate>
      </Suspense>
    </HashRouter>
  );
}
