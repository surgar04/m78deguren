import type { SteamAccount } from '@/lib/steam-contracts';
import { useSteamImage } from './repository';
export function SteamAccountCard({
  account,
  current,
  busy,
  onSwitch,
  onRemove,
}: {
  account: SteamAccount;
  current: boolean;
  busy: boolean;
  onSwitch: () => void;
  onRemove: () => void;
}) {
  const image = useSteamImage('avatar', account.id);
  return (
    <article className="steam-account glass">
      {image.data ? (
        <img src={image.data} alt="" width={52} height={52} />
      ) : (
        <span className="steam-avatar-empty" aria-hidden="true">
          {(account.name || account.accountName).slice(0, 1) || '?'}
        </span>
      )}
      <div>
        <h3>{account.name || account.accountName}</h3>
        <p>
          {account.accountName}
          {current ? ' · 当前/最近账号' : ''}
          {account.active ? ' · 已登录' : ''}
        </p>
        <p>Steam ID：{account.id}</p>
        <p>
          {account.rememberPassword ? 'Steam 已记住登录偏好' : '可能需要重新验证'} ·{' '}
          {account.lastLogin
            ? new Date(account.lastLogin * 1000).toLocaleString('zh-CN')
            : '无登录时间记录'}
        </p>
      </div>
      <div className="steam-account-actions">
        <button type="button" disabled={busy} onClick={onSwitch}>
          切换账号
        </button>
        <button type="button" disabled={busy} onClick={onRemove}>
          移除本机记录
        </button>
      </div>
    </article>
  );
}
