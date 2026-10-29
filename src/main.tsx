import './lib/migrate-preferences';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { config } from '@fortawesome/fontawesome-svg-core';
import '@fortawesome/fontawesome-svg-core/styles.css';
import { App } from './app/App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { queryClient } from './lib/query-client';
import './styles.css';

config.autoAddCss = false;
// 在懒加载 HUD 页面之前清除根画布底色，避免启动时出现主界面背景色的矩形闪烁。
if (['#/hud', '#/desktop-island', '#/performance-overlay'].includes(window.location.hash))
  document.documentElement.classList.add('hud-document');
const root = document.getElementById('root');
if (!root) throw new Error('缺少应用根节点');

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
