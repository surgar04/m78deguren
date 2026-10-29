import { useSettingsUi } from '@/features/settings/ui-store';
import { useHome } from '../repository';
import { useHomeAction } from '../repository';
import { homeSnapshotSchema } from '@/lib/home-contracts';
import { useSettingsSnapshot } from '@/features/settings/repository';
import { useText } from '@/features/settings/i18n';
import {
  faHouse,
  faGamepad,
  faDisplay,
  faBriefcase,
  faRocket,
  faGear,
  faMagnifyingGlass,
  faShirt,
  faMinus,
  faXmark,
  faUser,
} from '@fortawesome/free-solid-svg-icons';
import { faSquare } from '@fortawesome/free-regular-svg-icons';
import { useNavigate } from 'react-router-dom';
import { controlWindow, errorMessage } from '@/lib/desktop';
import { Icon } from './Icon';
import type { DialogState } from '../types';
import { useSetupStatus } from '@/features/onboarding/repository';
import { useSteamImage } from '@/features/library/repository';
import { CustomNavigation } from '@/features/quick-launch/CustomNavigation';

interface ChromeProps {
  open: (dialog: DialogState) => void;
  notify: (message: string) => void;
}

export function Dock({
  active = 'home',
}: {
  active?: 'home' | 'library' | 'hardware' | 'tools' | 'optimization' | 'settings';
}) {
  const navigate = useNavigate();
  const ui = useSettingsUi();
  const { t } = useText();
  const entries = {
    home: { label: '首页', icon: faHouse, path: '/' },
    library: { label: '游戏库', icon: faGamepad, path: '/library' },
    hardware: { label: '硬件', icon: faDisplay, path: '/hardware' },
    tools: { label: '工具', icon: faBriefcase, path: '/tools' },
    optimization: { label: '优化', icon: faRocket, path: '/optimization' },
    settings: { label: '设置', icon: faGear, path: '/settings' },
  } as const;
  return (
    <aside className="dock glass" aria-label="主导航">
      <button type="button" className="brand" aria-label="臻境" onClick={() => navigate('/')}>
        <img src="/assets/home/brand.svg" alt="臻境 ZHENJING" width="56" height="78" />
      </button>
      <nav aria-label="主导航">
        {ui.navOrder
          .filter((id) => ui.navVisible.includes(id))
          .map((id) => {
            const entry = entries[id];
            return (
              <button
                type="button"
                key={id}
                title={t(entry.label)}
                aria-label={t(entry.label)}
                className={`dock-item ${active === id ? 'selected' : ''}`}
                aria-current={active === id ? 'page' : undefined}
                onClick={() => navigate(entry.path)}
              >
                <Icon icon={entry.icon} />
                {ui.navLabels && <span>{t(entry.label)}</span>}
              </button>
            );
          })}
      </nav>
      <CustomNavigation />
    </aside>
  );
}
export function TopBar({ open, notify }: ChromeProps) {
  const navigate = useNavigate();
  const home = useHome();
  const settings = useSettingsSnapshot();
  const mode = useHomeAction(homeSnapshotSchema);
  const identity = useSetupStatus().data?.progress.identity;
  const portrait = useSteamImage('avatar', identity?.steamId ?? '');
  const username = useSettingsUi((state) => state.username) || home.data?.username;
  const modeVisible = useSettingsUi((state) => state.cards.includes('game-mode'));
  const searchVisible = useSettingsUi((state) => state.cards.includes('search'));
  const nativeAction = async (action: 'minimize' | 'maximize' | 'close') => {
    try {
      await controlWindow(action);
    } catch (error) {
      notify(errorMessage(error));
    }
  };
  return (
    <header className="top-bar" data-tauri-drag-region>
      {searchVisible && (
        <button
          className="global-search glass"
          type="button"
          onClick={() => open({ kind: 'search' })}
          aria-label="全局搜索，Ctrl K"
        >
          <Icon icon={faMagnifyingGlass} />
          <span>搜索游戏、工具或功能...</span>
          <span className="shortcut">
            <kbd>Ctrl</kbd>
            <kbd>K</kbd>
          </span>
        </button>
      )}
      <div className="top-actions">
        {modeVisible && (
          <div className="home-mode-bar glass">
            <button
              type="button"
              role="switch"
              aria-label="游戏模式"
              aria-checked={home.data?.runtime.effective ?? false}
              disabled={!home.data || mode.isPending}
              onClick={() => {
                const enabled = !home.data?.runtime.effective;
                if (settings.data?.config.confirmActions !== false)
                  open({ kind: 'game-mode', manual: enabled });
                else
                  mode.mutate(
                    { operation: 'manual', enabled, consent: true },
                    {
                      onSuccess: () => notify('原生服务已确认游戏模式操作。'),
                      onError: (cause) => notify(errorMessage(cause)),
                    },
                  );
              }}
            >
              <Icon icon={faGamepad} />
              <span>游戏模式</span>
              <i className={home.data?.runtime.effective ? 'active' : ''} />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="游戏模式设置"
              onClick={() => open({ kind: 'game-mode' })}
            >
              <Icon icon={faGear} />
            </button>
          </div>
        )}
        <button
          className="avatar-button"
          type="button"
          aria-label="账户与偏好"
          onClick={() =>
            open({
              kind: 'info',
              title: `${username || '本机用户'}，你好`,
              description: identity
                ? `当前使用 Steam 本机资料：${identity.name}。这不是云端登录，收藏和界面偏好保存在此设备。`
                : '这是臻境的本地工作空间。可在首次启动向导中选择 Steam 本机身份；收藏和界面偏好保存在此设备。',
            })
          }
        >
          {portrait.data ? (
            <img
              src={portrait.data}
              alt={`${identity?.name ?? 'Steam 用户'}的头像`}
              width="54"
              height="54"
            />
          ) : (
            <Icon icon={faUser} />
          )}
        </button>
        <button
          className="appearance-button glass"
          type="button"
          aria-label="外观设置"
          onClick={() => navigate('/settings')}
        >
          <Icon icon={faShirt} />
        </button>
        <div className="window-controls glass" aria-label="窗口控制">
          <button
            type="button"
            aria-label="最小化窗口"
            onClick={() => {
              void nativeAction('minimize');
            }}
          >
            <Icon icon={faMinus} />
          </button>
          <button
            type="button"
            aria-label="最大化或还原窗口"
            onClick={() => {
              void nativeAction('maximize');
            }}
          >
            <Icon icon={faSquare} />
          </button>
          <button
            type="button"
            className="window-close"
            aria-label="关闭窗口"
            onClick={() => {
              void nativeAction('close');
            }}
          >
            <Icon icon={faXmark} />
          </button>
        </div>
      </div>
    </header>
  );
}
