import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  description: string;
  badge?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}

/**
 * 桌面页面共享的标题区：标题与说明保持同一阅读起点，操作区空间不足时自然换行。
 * 元信息只用于数据更新时间等业务信息；普通页面不重复首页日期。
 * children 为页签等全宽导航预留位置，不把页面状态复制到公共组件。
 */
export function PageHeader({
  title,
  description,
  badge,
  meta,
  actions,
  children,
}: PageHeaderProps) {
  return (
    <header className="page-header" data-home-enter>
      <div className="page-header-copy">
        <div className="page-header-title">
          <h1>{title}</h1>
          {badge && <span className="page-header-badge">{badge}</span>}
        </div>
        <p className="page-header-description">{description}</p>
        {meta && <p className="page-header-meta">{meta}</p>}
      </div>
      {actions && <div className="page-header-actions">{actions}</div>}
      {children && <div className="page-header-navigation">{children}</div>}
    </header>
  );
}
