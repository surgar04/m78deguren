import { useState } from 'react';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { executeSettings, executeSteam, settingsAssetUrl } from '@/lib/desktop';
import { assetSchema } from '@/lib/settings-contracts';
import { steamSnapshotSchema } from '@/lib/steam-contracts';
import { setupProgressSchema } from '@/lib/onboarding-contracts';
import { useSettingsUi } from '@/features/settings/ui-store';
import { useSettingsSnapshot } from '@/features/settings/repository';
import { DEFAULT_WALLPAPER } from '@/features/settings/wallpaper';
import { useSteam, useSteamImage } from '@/features/library/repository';
import { Failure } from './controls';
import { useSetupAction } from './repository';

export function AppearanceStep() {
  const client = useQueryClient();
  const ui = useSettingsUi(),
    snapshot = useSettingsSnapshot();
  const action = useMutation({
    mutationFn: (kind: 'image' | 'video') =>
      executeSettings({ operation: 'asset-import', kind }, assetSchema.nullable()),
    onSuccess: (asset) => {
      void client.invalidateQueries({ queryKey: ['settings'] });
      if (asset)
        ui.patch({ backgroundMode: asset.kind, backgroundAsset: asset.id, carousel: false });
    },
  });
  const asset = snapshot.data?.assets.find((asset) => asset.id === ui.backgroundAsset);
  return (
    <>
      <p className="setup-lead">选择熟悉的风景。图片或最长 15 秒的视频，视频静音循环播放。</p>
      <div className="setup-appearance-preview">
        {asset?.kind === 'video' ? (
          <video src={settingsAssetUrl(asset.id)} autoPlay muted playsInline loop />
        ) : asset ? (
          <img src={settingsAssetUrl(asset.id)} alt="当前背景" />
        ) : (
          <img
            src={DEFAULT_WALLPAPER}
            alt="默认背景"
            onError={(event) => {
              event.currentTarget.style.visibility = 'hidden';
            }}
          />
        )}
      </div>
      <div className="setup-actions">
        <button type="button" disabled={action.isPending} onClick={() => action.mutate('image')}>
          上传背景图片
        </button>
        <button type="button" disabled={action.isPending} onClick={() => action.mutate('video')}>
          上传视频（≤ 15 秒）
        </button>
        <button
          type="button"
          disabled={action.isPending}
          onClick={() =>
            ui.patch({
              backgroundMode: 'preset',
              preset: 'island',
              backgroundAsset: null,
              carousel: false,
            })
          }
        >
          使用默认背景
        </button>
      </div>
      <Failure error={action.error} />
    </>
  );
}
function AccountOption({
  id,
  name,
  selected,
  onSelect,
}: {
  id: string;
  name: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const image = useSteamImage('avatar', id);
  return (
    <button
      type="button"
      className={`setup-account ${selected ? 'selected' : ''}`}
      aria-pressed={selected}
      onClick={onSelect}
    >
      {image.data ? (
        <img src={image.data} alt="" width={56} height={56} />
      ) : (
        <span className="setup-avatar-placeholder">{name.slice(0, 1)}</span>
      )}
      <span>
        <strong>{name}</strong>
        <small>Steam {id}</small>
      </span>
    </button>
  );
}
export function IdentityStep() {
  const steam = useSteam(),
    [selected, setSelected] = useState<string | null>(null),
    [guest, setGuest] = useState(false),
    client = useQueryClient(),
    finish = useSetupAction(setupProgressSchema);
  const refresh = useMutation({
    mutationFn: () => executeSteam({ operation: 'snapshot', refresh: true }, steamSnapshotSchema),
    onSuccess: (data) => client.setQueryData(['steam', 'snapshot'], data),
  });
  const launch = useMutation({
    mutationFn: () =>
      executeSteam({ operation: 'launch', kind: 'client', appId: null, consent: true }, z.null()),
  });
  const chosen = selected ?? steam.data?.currentAccount ?? null;
  return (
    <>
      <p className="setup-lead">使用 Steam 的名称和头像，作为此设备上的臻境身份。</p>
      <p className="setup-note">
        仅读取本机 Steam 账号资料，不验证账号所有权，不创建云账户，也不索取 Steam 密码。请在 Steam
        官方客户端内完成登录。
      </p>
      <div className="setup-account-list">
        {steam.data?.accounts.map((account) => (
          <AccountOption
            id={account.id}
            name={account.name || account.accountName}
            key={account.id}
            selected={!guest && chosen === account.id}
            onSelect={() => {
              setGuest(false);
              setSelected(account.id);
            }}
          />
        ))}
      </div>
      {steam.data?.installed && (
        <button type="button" disabled={launch.isPending} onClick={() => launch.mutate()}>
          打开 Steam 登录
        </button>
      )}
      <button type="button" disabled={refresh.isPending} onClick={() => refresh.mutate()}>
        我已在 Steam 登录，重新读取
      </button>
      <label className="setup-consent">
        <input
          type="checkbox"
          checked={guest}
          onChange={(event) => setGuest(event.target.checked)}
        />
        暂不使用 Steam 身份，以本机用户继续
      </label>
      <Failure error={steam.error ?? refresh.error ?? launch.error ?? finish.error} />
      <button
        type="button"
        className="setup-primary"
        disabled={finish.isPending || (!guest && !chosen)}
        onClick={() =>
          finish.mutate(
            { operation: 'identity', steamId: guest ? null : chosen },
            {
              onSuccess: () => {
                void client.invalidateQueries({ queryKey: ['home'] });
              },
            },
          )
        }
      >
        保存身份并完成准备
      </button>
    </>
  );
}
