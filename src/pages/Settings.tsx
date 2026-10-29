import { useEffect, type KeyboardEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  faDisplay,
  faSliders,
  faKeyboard,
  faDatabase,
  faCircleInfo,
  faGlobe,
} from '@fortawesome/free-solid-svg-icons';
import { WorkspaceLayout } from '@/features/home/components/WorkspaceLayout';
import { Icon } from '@/features/home/components/Icon';
import { useGameWorkspace } from '@/features/home/useGameWorkspace';
import { AppearancePanel } from '@/features/settings/AppearancePanel';
import { GeneralPanel } from '@/features/settings/GeneralPanel';
import { AdvancedPanel } from '@/features/settings/AdvancedPanel';
import { ShortcutsPanel } from '@/features/settings/ShortcutsPanel';
import { NetworkPanel } from '@/features/settings/NetworkPanel';
import { AboutPanel } from '@/features/settings/AboutPanel';
import { useText } from '@/features/settings/i18n';
import { useSettingsSnapshot } from '@/features/settings/repository';
import { Failure } from '@/features/settings/controls';
import { isDesktop } from '@/lib/desktop';
import '@/features/settings/settings.css';
import '@/features/settings/settings-live.css';

const TABS = [
  { id: 'appearance', label: '外观与体验', icon: faDisplay, Component: AppearancePanel },
  { id: 'general', label: '通用偏好', icon: faSliders, Component: GeneralPanel },
  { id: 'shortcuts', label: '快捷键', icon: faKeyboard, Component: ShortcutsPanel },
  { id: 'storage', label: '高级', icon: faDatabase, Component: AdvancedPanel },
  { id: 'network', label: '网络', icon: faGlobe, Component: NetworkPanel },
  { id: 'about', label: '关于臻境', icon: faCircleInfo, Component: AboutPanel },
] as const;
export type SettingsTab = (typeof TABS)[number]['id'];

/** 六类设置共享原生查询；页面没有模拟版本、占用、日期或网络状态。 */
export default function Settings() {
  const workspace = useGameWorkspace();
  const { t, locale } = useText();
  const snapshot = useSettingsSnapshot();
  const [params, setParams] = useSearchParams();
  // 标签由 URL 唯一控制；全局更新提醒跳转时，即使当前已在设置页也会切换到“关于”。
  const tab = TABS.find((row) => row.id === params.get('tab'))?.id ?? 'appearance';
  const setTab = (next: SettingsTab) => setParams({ tab: next }, { replace: true });
  const current = TABS.find((row) => row.id === tab) ?? TABS[0];
  const Panel = current.Component;
  useEffect(() => {
    document.querySelector('.preferences-panel-content')?.scrollTo({ top: 0, behavior: 'instant' });
  }, [tab]);
  const navigateTabs = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next =
      event.key === 'ArrowDown'
        ? (index + 1) % TABS.length
        : event.key === 'ArrowUp'
          ? (index + TABS.length - 1) % TABS.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? TABS.length - 1
              : null;
    if (next === null) return;
    event.preventDefault();
    const item = TABS[next];
    if (item) {
      setTab(item.id);
      document.getElementById(`settings-tab-${item.id}`)?.focus();
    }
  };
  return (
    <WorkspaceLayout workspace={workspace} active="settings">
      <main id="main-content" className="preferences-main live-settings" tabIndex={-1}>
        <header className="preferences-heading" data-home-enter>
          <div className="preferences-title">
            <h1>{t('设置')}</h1>
          </div>
          <p>{t('让臻境，更合你的习惯。')}</p>
          <p className="preferences-date">
            {new Intl.DateTimeFormat(locale, { dateStyle: 'full' }).format(new Date())}
          </p>
        </header>
        {!isDesktop() && (
          <p role="status" className="settings-review">
            网页预览仅支持界面偏好。启动项、驱动、缓存、媒体和更新功能需在桌面端连接 Rust 后端。
          </p>
        )}
        <Failure error={snapshot.error} />
        {snapshot.data?.warnings.map((warning) => (
          <p className="settings-error" role="alert" key={warning}>
            {warning}
          </p>
        ))}
        <section className="preferences-workbench glass" aria-label={t('设置')} data-home-enter>
          <div
            className="preferences-navigation"
            role="tablist"
            aria-label={t('设置')}
            aria-orientation="vertical"
          >
            {TABS.map((item, index) => (
              <button
                key={item.id}
                id={`settings-tab-${item.id}`}
                type="button"
                role="tab"
                aria-selected={item.id === tab}
                aria-controls="settings-panel"
                tabIndex={item.id === tab ? 0 : -1}
                className={item.id === tab ? 'selected' : ''}
                onClick={() => setTab(item.id)}
                onKeyDown={(event) => navigateTabs(event, index)}
              >
                <Icon icon={item.icon} />
                <span>{t(item.label)}</span>
              </button>
            ))}
          </div>
          <div
            className="preferences-body"
            role="tabpanel"
            id="settings-panel"
            aria-labelledby={`settings-tab-${tab}`}
            tabIndex={0}
          >
            <div className="preferences-panel-content">
              <Panel />
            </div>
            <footer className="preferences-footer">
              <button type="button" onClick={() => setTab('about')}>
                <Icon icon={faCircleInfo} />
                {t('关于臻境')} {snapshot.data?.version}
              </button>
              <p>{t('已保存到本机')}</p>
            </footer>
          </div>
        </section>
      </main>
    </WorkspaceLayout>
  );
}
