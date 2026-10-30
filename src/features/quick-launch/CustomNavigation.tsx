import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { faSliders } from '@fortawesome/free-solid-svg-icons';
import { Icon } from '@/features/home/components/Icon';
import { useQuickLaunch, useQuickAction } from './repository';
import { CUSTOM_NAVIGATION_SLOTS, targetKey } from '@/lib/launcher-contracts';
import { LaunchTargetIcon } from './LaunchTargetIcon';
import { errorMessage } from '@/lib/desktop';
import './quick-launch.css';
export function CustomNavigation() {
  const query = useQuickLaunch(),
    action = useQuickAction(z.null()),
    navigate = useNavigate();
  const slots =
    query.data?.config.navigation ?? Array.from({ length: CUSTOM_NAVIGATION_SLOTS }, () => null);
  return (
    <div className="custom-navigation" aria-label="自定义快捷导航">
      {slots.map((target, index) => {
        const option = query.data?.options.find(
          (option) => targetKey(option.target) === targetKey(target),
        );
        return (
          <button
            type="button"
            key={index}
            title={option?.label ?? `设置自定义导航 ${index + 1}`}
            aria-label={option?.label ?? `设置自定义导航 ${index + 1}`}
            disabled={action.isPending}
            className={target ? 'configured' : ''}
            onClick={() => {
              if (!target) {
                void navigate('/settings?tab=shortcuts');
                return;
              }
              action.mutate(
                { operation: 'navigation', index },
                {
                  onError: (cause) => {
                    window.dispatchEvent(
                      new CustomEvent('quick-launch-error', { detail: errorMessage(cause) }),
                    );
                  },
                },
              );
            }}
          >
            <LaunchTargetIcon option={option} />
            <span>{option?.label ?? String(index + 1)}</span>
          </button>
        );
      })}
      <button
        className="custom-navigation-edit"
        type="button"
        aria-label="管理自定义导航与轮盘"
        title="管理自定义导航与轮盘"
        onClick={() => navigate('/settings?tab=shortcuts')}
      >
        <Icon icon={faSliders} />
      </button>
    </div>
  );
}
