import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  REMINDER_KEY,
  readDismissal,
  reminderVisible,
  type Dismissal,
} from './update-reminder-model';
import { updateStatusSchema } from '@/lib/settings-contracts';
import { useSettingsQuery, useSettingsSnapshot } from './repository';
import { Icon } from '@/features/home/components/Icon';
import { faArrowUpFromBracket, faXmark } from '@fortawesome/free-solid-svg-icons';
import './update-notice.css';

export function UpdateNotice() {
  const preferences = useSettingsSnapshot();
  const status = useSettingsQuery({ operation: 'update-status' }, updateStatusSchema, 3_000);
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(readDismissal);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const data = status.data;
  if (
    preferences.data?.config.updateReminders !== true ||
    !data?.latestVersion ||
    (data.phase !== 'available' && data.phase !== 'ready' && data.phase !== 'unverified') ||
    !reminderVisible(data.latestVersion, data.phase, dismissed, now)
  )
    return null;
  const dismiss = () => {
    const value: Dismissal = {
      version: data.latestVersion ?? '',
      stage:
        data.phase === 'ready' ? 'ready' : data.phase === 'unverified' ? 'unverified' : 'available',
      until: Date.now() + 24 * 3600_000,
    };
    setDismissed(value);
    try {
      localStorage.setItem(REMINDER_KEY, JSON.stringify(value));
    } catch {
      /* 本次仍生效，存储失败不影响更新。 */
    }
  };
  return (
    <aside className="update-reminder glass" role="status" aria-label="版本更新提醒">
      <Icon icon={faArrowUpFromBracket} />
      <div>
        <strong>
          {data.phase === 'ready'
            ? '更新已就绪'
            : data.phase === 'unverified'
              ? '检测到新发布'
              : '发现新版本'}{' '}
          · v{data.latestVersion}
        </strong>
        <p>
          {data.phase === 'unverified'
            ? '该发布缺少可信签名清单，暂不能自动下载或安装。'
            : data.phase === 'ready'
              ? '已完成安全校验，安装前仍需你的确认。'
              : '可以查看更新内容，选择下载或稍后处理。'}
        </p>
        <button
          type="button"
          className="text-button"
          onClick={() => {
            void navigate('/settings?tab=about');
          }}
        >
          查看更新
        </button>
      </div>
      <button
        type="button"
        className="icon-button"
        aria-label="稍后提醒此更新"
        title="24 小时后再提醒"
        onClick={dismiss}
      >
        <Icon icon={faXmark} />
      </button>
    </aside>
  );
}
