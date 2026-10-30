import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  faFolderOpen,
  faPlay,
  faDownload,
  faImage,
  faRotateRight,
} from '@fortawesome/free-solid-svg-icons';
import { Icon } from './Icon';
import { useHome, useHomeAction, useHomeContent, useHomePicture } from '../repository';
import {
  homeDraftSchema,
  homeSnapshotSchema,
  homeContentSchema,
  homePictureSchema,
} from '@/lib/home-contracts';
import { assetSchema } from '@/lib/settings-contracts';
import { useSettingsUi } from '@/features/settings/ui-store';
import { useSettingsSnapshot } from '@/features/settings/repository';
import { errorMessage, isDesktop } from '@/lib/desktop';

type Props = {
  notify: (message: string) => void;
  close: () => void;
  busy: (value: boolean) => void;
};
export function AddShortcut({ notify, close, busy }: Props) {
  const home = useHome(),
    choose = useHomeAction(homeDraftSchema.nullable()),
    add = useHomeAction(homeSnapshotSchema);
  const [name, setName] = useState(''),
    [isGame, setIsGame] = useState(true);
  const pending = choose.isPending || add.isPending;
  return (
    <form
      className="modal-form"
      onSubmit={(event) => {
        event.preventDefault();
        const draft = choose.data;
        if (!draft || !home.data) return;
        busy(true);
        add.mutate(
          { operation: 'add', ticket: draft.ticket, name, isGame, revision: home.data.revision },
          {
            onSuccess: () => {
              notify('已保存快捷启动。');
              close();
            },
            onError: (cause) => notify(errorMessage(cause)),
            onSettled: () => busy(false),
          },
        );
      }}
    >
      <p className="modal-description">
        选择本机 EXE，为游戏或程序创建快捷入口。原程序不会被复制或修改；图标、排序及启动记录保存在 D
        盘。
      </p>
      <button
        type="button"
        className="mint-button"
        disabled={pending || !isDesktop()}
        onClick={() => {
          busy(true);
          choose.mutate(
            { operation: 'choose' },
            {
              onSuccess: (draft) => {
                if (draft) setName(draft.name);
              },
              onError: (cause) => notify(errorMessage(cause)),
              onSettled: () => busy(false),
            },
          );
        }}
      >
        <Icon icon={faFolderOpen} />
        {choose.isPending ? '正在选择…' : '选择 EXE 程序'}
      </button>
      {choose.data && (
        <>
          <div className="home-selected-program">
            {choose.data.icon && <img src={choose.data.icon} alt="程序图标" />}
            <span>{choose.data.path}</span>
          </div>
          <label>
            显示名称
            <input
              value={name}
              maxLength={60}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </label>
          <label className="home-check">
            <input
              type="checkbox"
              checked={isGame}
              onChange={(event) => setIsGame(event.target.checked)}
            />
            作为游戏识别，供自动游戏模式与 Win 键控制使用
          </label>
        </>
      )}
      <button
        type="submit"
        className="mint-button"
        disabled={pending || !choose.data || !home.data || !name.trim() || /[\p{Cc}]/u.test(name)}
      >
        保存快捷启动
      </button>
    </form>
  );
}

/** 开关先进入明确的逐项审阅；查询状态始终由原生回执更新，失败不做乐观假切换。 */
export function GameModeControls({
  notify,
  busy,
  initialManual,
}: Omit<Props, 'close'> & { initialManual?: boolean | undefined }) {
  const home = useHome(),
    action = useHomeAction(homeSnapshotSchema);
  const settings = useSettingsSnapshot();
  const [review, setReview] = useState<
    | { title: string; description: string; operation: 'manual'; enabled: boolean }
    | {
        title: string;
        description: string;
        operation: 'policy';
        key: 'autoGameMode' | 'disableWinInGame';
        enabled: boolean;
      }
    | { title: string; description: string; operation: 'restore' }
    | null
  >(
    initialManual === undefined
      ? null
      : {
          operation: 'manual',
          enabled: initialManual,
          title: initialManual ? '开启常规游戏模式' : '关闭游戏模式',
          description:
            '常规模式只调整合法高占用后台程序的调度优先级；关闭或退出时恢复保存的原值，不终止进程。',
        },
  );
  const [approved, setApproved] = useState(false),
    data = home.data;
  const execute = (next: NonNullable<typeof review>) => {
    const request =
      next.operation === 'manual'
        ? { operation: 'manual' as const, enabled: next.enabled, consent: true as const }
        : next.operation === 'policy'
          ? {
              operation: 'policy' as const,
              key: next.key,
              enabled: next.enabled,
              consent: true as const,
            }
          : { operation: 'restore' as const, consent: true as const };
    busy(true);
    action.mutate(request, {
      onSuccess: () => {
        setReview(null);
        notify('原生服务已确认操作。');
      },
      onError: (cause) => notify(errorMessage(cause)),
      onSettled: () => busy(false),
    });
  };
  const request = (next: NonNullable<typeof review>) => {
    if (settings.data?.config.confirmActions === false) {
      execute(next);
      return;
    }
    setApproved(false);
    setReview(next);
  };
  return (
    <div className="home-mode-controls">
      <p className="modal-description">
        常规模式仅降低高占用的普通后台进程调度优先级，保护前台游戏、系统、反作弊、平台、音频和输入软件。关闭或退出时恢复原值；不会终止进程或修改系统注册表。
      </p>
      <div className="home-control-row">
        <div>
          <strong>游戏模式</strong>
          <small>
            {data?.runtime.effective ? '常规模式生效' : '默认调度'} · 已调整{' '}
            {data?.runtime.suppressedCount ?? '—'} 个后台进程
          </small>
        </div>
        <button
          className={`toggle ${data?.runtime.effective ? 'on' : ''}`}
          type="button"
          role="switch"
          aria-label="游戏模式"
          aria-checked={data?.runtime.effective ?? false}
          disabled={!data || action.isPending}
          onClick={() =>
            request({
              operation: 'manual',
              enabled: !data?.runtime.effective,
              title: data?.runtime.effective ? '关闭游戏模式' : '开启常规游戏模式',
              description:
                '将保存进程原始优先级、I/O、内存及 EcoQoS 状态，并在关闭/退出时恢复。游戏进程和正在交互的程序始终豁免。',
            })
          }
        >
          <span />
        </button>
      </div>
      <div className="home-control-row">
        <div>
          <strong>游戏启动时自动启用</strong>
          <small>根据游戏快捷入口、Steam 安装目录和滤镜名单识别</small>
        </div>
        <button
          className={`toggle ${data?.policy.autoGameMode ? 'on' : ''}`}
          type="button"
          role="switch"
          aria-label="游戏启动时自动启用"
          aria-checked={data?.policy.autoGameMode ?? false}
          disabled={!data || action.isPending}
          onClick={() => {
            if (data)
              request({
                operation: 'policy',
                key: 'autoGameMode',
                enabled: !data.policy.autoGameMode,
                title: '修改自动游戏模式',
                description:
                  '开启后，在已登记的游戏运行时自动使用常规模式，游戏结束后恢复。手动关闭可覆盖当前游戏会话。',
              });
          }}
        >
          <span />
        </button>
      </div>
      <div className="home-control-row">
        <div>
          <strong>游戏时禁用 Win 键</strong>
          <small>
            {data?.runtime.winKeyBlocked ? '当前游戏窗口中正在拦截' : '离开游戏窗口后立即放行'} ·
            左/右 Win 键
          </small>
        </div>
        <button
          className={`toggle ${data?.policy.disableWinInGame ? 'on' : ''}`}
          type="button"
          role="switch"
          aria-label="游戏时禁用 Win 键"
          aria-checked={data?.policy.disableWinInGame ?? false}
          disabled={!data || action.isPending}
          onClick={() => {
            if (data)
              request({
                operation: 'policy',
                key: 'disableWinInGame',
                enabled: !data.policy.disableWinInGame,
                title: '修改游戏 Win 键控制',
                description:
                  '仅对识别到的游戏前台窗口安装临时 Win 键拦截。其他按键及非游戏窗口不受影响；关闭或退出会释放钩子。',
              });
          }}
        >
          <span />
        </button>
      </div>
      <p className="home-source">
        {data?.runtime.ready ? '原生控制服务已连接' : '原生控制服务尚未就绪'}
        {data?.runtime.message ? ` · ${data.runtime.message}` : ''}
      </p>
      <button
        type="button"
        className="text-button"
        disabled={!data || action.isPending}
        onClick={() =>
          request({
            operation: 'restore',
            title: '恢复进程调整',
            description:
              '关闭自动模式与 Win 键拦截，恢复本次及上次异常退出留下的原值。仅处理创建时间一致、仍保留本工具调整值的进程。',
          })
        }
      >
        恢复进程调整
        {data?.runtime.recoverableCount ? `（待恢复 ${data.runtime.recoverableCount} 项）` : ''}
      </button>
      {review && (
        <section className="home-review" aria-label="操作确认">
          <h3>{review.title}</h3>
          <p>{review.description}</p>
          <label className="home-check">
            <input
              type="checkbox"
              checked={approved}
              onChange={(event) => setApproved(event.target.checked)}
            />
            我已了解此项操作及恢复方式
          </label>
          <div className="home-button-row">
            <button
              className="mint-button"
              type="button"
              disabled={!approved || action.isPending}
              onClick={() => {
                execute(review);
              }}
            >
              确认执行
            </button>
            <button
              type="button"
              className="text-button"
              disabled={action.isPending}
              onClick={() => setReview(null)}
            >
              取消
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

export function Announcement({ notify }: Pick<Props, 'notify'>) {
  const query = useHomeContent('announcement'),
    client = useQueryClient(),
    refresh = useHomeAction(homeContentSchema);
  return (
    <div className="home-announcement-detail">
      <p className="home-source">{query.data?.source ?? '正在读取公告'}</p>
      {query.isError && <p role="alert">{errorMessage(query.error)}</p>}
      <pre>{query.data?.text ?? '正在加载…'}</pre>
      <button
        type="button"
        className="text-button"
        disabled={refresh.isPending}
        onClick={() =>
          refresh.mutate(
            { operation: 'content', kind: 'announcement', refresh: true },
            {
              onSuccess: (data) => client.setQueryData(['home', 'content', 'announcement'], data),
              onError: (cause) => notify(errorMessage(cause)),
            },
          )
        }
      >
        <Icon icon={faRotateRight} />
        刷新公告
      </button>
    </div>
  );
}
export function RandomPicture({ notify, busy }: Omit<Props, 'close'>) {
  const query = useHomePicture(true),
    refresh = useHomeAction(homePictureSchema),
    save = useHomeAction(z.string().nullable()),
    wallpaper = useHomeAction(assetSchema),
    client = useQueryClient();
  const data = query.data,
    pending = refresh.isPending || save.isPending || wallpaper.isPending;
  return (
    <div className="home-picture-dialog">
      {data && <img src={data.data} alt={`随机图片，来源：${data.source}`} />}
      <p className="home-source">
        {data ? `${data.source}${data.author ? ` · ${data.author}` : ''}` : '正在获取随机图片…'}
      </p>
      {query.isError && <p role="alert">{errorMessage(query.error)}</p>}
      <div className="home-button-row">
        <button
          type="button"
          className="mint-button"
          disabled={pending || !isDesktop()}
          onClick={() => {
            busy(true);
            refresh.mutate(
              { operation: 'picture', refresh: true },
              {
                onSuccess: (data) => client.setQueryData(['home', 'picture'], data),
                onError: (cause) => notify(errorMessage(cause)),
                onSettled: () => busy(false),
              },
            );
          }}
        >
          <Icon icon={faRotateRight} />
          换一张
        </button>
        <button
          type="button"
          className="text-button"
          disabled={!data || pending}
          onClick={() => {
            if (data) {
              busy(true);
              save.mutate(
                { operation: 'picture-save', id: data.id },
                {
                  onSuccess: (path) => {
                    if (path) notify(`图片已保存到 ${path}`);
                  },
                  onError: (cause) => notify(errorMessage(cause)),
                  onSettled: () => busy(false),
                },
              );
            }
          }}
        >
          <Icon icon={faDownload} />
          另存图片
        </button>
        <button
          type="button"
          className="text-button"
          disabled={!data || pending}
          onClick={() => {
            if (data) {
              busy(true);
              wallpaper.mutate(
                { operation: 'picture-wallpaper', id: data.id },
                {
                  onSuccess: (asset) => {
                    useSettingsUi
                      .getState()
                      .patch({ backgroundMode: 'image', backgroundAsset: asset.id });
                    void client.invalidateQueries({ queryKey: ['settings'] });
                    notify('已将图片设为壁纸，可在外观设置中切回。');
                  },
                  onError: (cause) => notify(errorMessage(cause)),
                  onSettled: () => busy(false),
                },
              );
            }
          }}
        >
          <Icon icon={faImage} />
          设为壁纸
        </button>
      </div>
    </div>
  );
}
export function ShortcutDetails({ id, notify, busy, close }: Props & { id: string }) {
  const home = useHome(),
    action = useHomeAction(homeSnapshotSchema),
    [remove, setRemove] = useState(false),
    [consent, setConsent] = useState(false);
  const row = home.data?.shortcuts.find((row) => row.id === id);
  if (!row) return <p className="modal-description">该快捷启动已被移除，请关闭并刷新。</p>;
  return (
    <div className="home-shortcut-detail">
      <h3>{row.name}</h3>
      <p className="home-path">{row.path}</p>
      <p className="home-source">
        {row.isGame ? '游戏快捷入口' : '程序快捷入口'} ·{' '}
        {row.lastLaunched
          ? `上次启动 ${new Date(row.lastLaunched).toLocaleString()}`
          : '尚无本机启动记录'}
      </p>
      <button
        type="button"
        className="mint-button"
        disabled={action.isPending}
        onClick={() => {
          busy(true);
          action.mutate(
            { operation: 'launch', id, consent: true },
            {
              onSuccess: () => notify('已提交本机启动请求。'),
              onError: (cause) => notify(errorMessage(cause)),
              onSettled: () => busy(false),
            },
          );
        }}
      >
        <Icon icon={faPlay} />
        启动程序
      </button>
      <button
        type="button"
        className="text-button"
        disabled={action.isPending}
        onClick={() => setRemove(true)}
      >
        移除快捷入口
      </button>
      {remove && (
        <div className="home-review">
          <p>只移除臻境中的记录和图标，不会删除原程序及其文件。</p>
          <label className="home-check">
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
            />
            确认移除此快捷入口
          </label>
          <button
            type="button"
            className="mint-button"
            disabled={!consent || action.isPending}
            onClick={() => {
              if (!home.data) return;
              busy(true);
              action.mutate(
                { operation: 'remove', id, revision: home.data.revision, consent: true },
                {
                  onSuccess: () => {
                    notify('已移除快捷入口，原程序未删除。');
                    close();
                  },
                  onError: (cause) => notify(errorMessage(cause)),
                  onSettled: () => busy(false),
                },
              );
            }}
          >
            确认移除
          </button>
        </div>
      )}
    </div>
  );
}
