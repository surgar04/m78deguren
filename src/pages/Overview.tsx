import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  faPlus,
  faPlay,
  faEllipsis,
  faGripVertical,
  faArrowUp,
  faArrowDown,
  faMicrochip,
  faDisplay,
  faMemory,
  faImage,
  faArrowUpRightFromSquare,
  faKeyboard,
  faRotateRight,
  faQuoteLeft,
  faBullhorn,
  faBookOpen,
  faComments,
  faMagnifyingGlass,
  faGamepad,
} from '@fortawesome/free-solid-svg-icons';
import { WorkspaceLayout } from '@/features/home/components/WorkspaceLayout';
import { Icon } from '@/features/home/components/Icon';
import { FeatureIcon } from '@/features/home/components/FeatureIcon';
import { useGameWorkspace } from '@/features/home/useGameWorkspace';
import { useHome, useHomeAction, useHomeContent, useHomePicture } from '@/features/home/repository';
import { useSettingsUi } from '@/features/settings/ui-store';
import { useSettingsSnapshot } from '@/features/settings/repository';
import { useText } from '@/features/settings/i18n';
import { useHardwareSnapshot } from '@/features/hardware/repository';
import { field } from '@/features/hardware/live-model';
import { homeSnapshotSchema, homeContentSchema, type HomeShortcut } from '@/lib/home-contracts';
import { executeHome, errorMessage, isDesktop } from '@/lib/desktop';
import { scrollToSection } from '@/features/home/navigation';
import { HOME_GUIDE } from '@/features/home/help';
import '@/features/home/live-home.css';

function ProgramIcon({ id }: { id: string }) {
  const query = useQuery({
    queryKey: ['home', 'icon', id],
    queryFn: () =>
      executeHome(
        { operation: 'icon', id },
        z.string().startsWith('data:image/png;base64,').max(524288).nullable(),
      ),
    enabled: isDesktop(),
    staleTime: Infinity,
    retry: false,
  });
  return query.data ? <img src={query.data} alt="" draggable={false} /> : <Icon icon={faGamepad} />;
}
function timeGreeting(date: Date) {
  const hour = date.getHours();
  return hour < 6
    ? '夜深了'
    : hour < 11
      ? '早上好'
      : hour < 14
        ? '中午好'
        : hour < 18
          ? '下午好'
          : '晚上好';
}
/** 首页服务全部来自 Query。拖放只保存交互中的 ID/版本，不复制程序列表或制造业务记录。 */
export default function Overview() {
  const workspace = useGameWorkspace(),
    home = useHome(),
    ui = useSettingsUi(),
    settings = useSettingsSnapshot(),
    navigate = useNavigate(),
    client = useQueryClient();
  const { locale } = useText(),
    [params] = useSearchParams();
  const hardware = useHardwareSnapshot(ui.cards.includes('hardware'));
  const announcement = useHomeContent('announcement', ui.cards.includes('announcement')),
    quote = useHomeContent('quote', ui.cards.includes('quote')),
    picture = useHomePicture(ui.cards.includes('random-image'));
  const action = useHomeAction(homeSnapshotSchema),
    external = useHomeAction(z.null()),
    refreshQuote = useHomeAction(homeContentSchema);
  const [now, setNow] = useState(() => new Date()),
    [search, setSearch] = useState('');
  const dragging = useRef<{ id: string; revision: string } | null>(null);
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const section = params.get('section');
    if (section === 'hardware-status' || section === 'game-enhancement')
      scrollToSection(section, 'center');
  }, [params]);
  const name = ui.username.trim() || home.data?.username;
  const rows = home.data?.shortcuts ?? [];
  const hasSide = ui.cards.some(
    (card) => card === 'hardware' || card === 'win-key' || card === 'random-image',
  );
  const text = search.normalize('NFKC').trim().toLocaleLowerCase();
  const visible = rows.filter((row) =>
    `${row.name} ${row.path}`.normalize('NFKC').toLocaleLowerCase().includes(text),
  );
  const fail = (cause: unknown) => workspace.notify(errorMessage(cause));
  const move = (id: string, target: string) => {
    const data = home.data;
    if (!data || id === target || action.isPending) return;
    const ids = data.shortcuts.map((row) => row.id),
      from = ids.indexOf(id),
      to = ids.indexOf(target);
    if (from < 0 || to < 0) return;
    ids.splice(from, 1);
    ids.splice(to, 0, id);
    action.mutate(
      { operation: 'reorder', ids, revision: data.revision },
      { onError: fail, onSuccess: () => workspace.notify('快捷启动顺序已保存。') },
    );
  };
  const launch = (row: HomeShortcut) =>
    action.mutate(
      { operation: 'launch', id: row.id, consent: true },
      { onSuccess: () => workspace.notify(`已提交“${row.name}”的本机启动请求。`), onError: fail },
    );
  const device = (kind: string) => {
    const row = hardware.data?.devices.find((row) => row.kind === kind);
    if (row?.name.trim()) return row.name;
    // 部分 SMBIOS 只提供内存规格，没有料号。由真实容量/类型/速率组成摘要，避免显示空白型号。
    if (kind === 'memory' && row) {
      const bytes = Number(field(row, '容量 (bytes)')),
        speed = Number(field(row, '当前速率 (MT/s)'));
      return (
        [
          Number.isFinite(bytes) && bytes > 0
            ? `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(bytes / 1024 ** 3)} GiB`
            : null,
          field(row, '内存类型'),
          Number.isFinite(speed) && speed > 0 ? `${speed} MT/s` : null,
        ]
          .filter(Boolean)
          .join(' · ') || '暂不可用'
      );
    }
    return '暂不可用';
  };
  return (
    <WorkspaceLayout workspace={workspace} active="home">
      <main id="main-content" className="home-dashboard" tabIndex={-1}>
        <div className="home-welcome-row" data-home-enter>
          <header className="home-welcome">
            <p className="home-eyebrow">YOUR GAMING WORKSPACE</p>
            <h1>
              {locale.startsWith('zh')
                ? `${timeGreeting(now)}，${name ?? '本机用户'}。`
                : `Welcome, ${name ?? 'local user'}.`}
            </h1>
            <p>{new Intl.DateTimeFormat(locale, { dateStyle: 'full' }).format(now)}</p>
            {ui.cards.includes('statistics') && settings.data && (
              <small>
                臻境 {settings.data.version} · 本次启动{' '}
                {new Date(settings.data.startedAt).toLocaleTimeString(locale)}
              </small>
            )}
          </header>
          <div className="home-quick-links">
            {(
              [
                { id: 'docs', label: '使用文档', icon: faBookOpen },
                { id: 'feedback', label: '问题反馈', icon: faComments },
              ] as const
            )
              .filter((item) => ui.cards.includes(item.id))
              .map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className="glass"
                  disabled={item.id !== 'docs' && (external.isPending || !isDesktop())}
                  onClick={() => {
                    if (item.id === 'docs') workspace.setDialog(HOME_GUIDE);
                    else
                      external.mutate({ operation: 'open', kind: 'feedback' }, { onError: fail });
                  }}
                >
                  <Icon icon={item.icon} />
                  <span>{item.label}</span>
                </button>
              ))}
          </div>
        </div>
        {!isDesktop() && (
          <p className="home-live-alert" role="status">
            请在臻境桌面端使用真实程序启动、硬件和游戏控制功能。网页预览不会填充演示数据。
          </p>
        )}
        {home.isError && (
          <div className="home-live-alert" role="alert">
            {errorMessage(home.error)}
            <button
              type="button"
              onClick={() => {
                void home.refetch();
              }}
            >
              重新读取
            </button>
          </div>
        )}
        <div className="home-message-grid" data-home-enter>
          {ui.cards.includes('announcement') && (
            <button
              type="button"
              className="home-note glass"
              onClick={() => workspace.setDialog({ kind: 'announcements' })}
            >
              <Icon icon={faBullhorn} />
              <div>
                <strong>{announcement.data?.title ?? '公告与版本说明'}</strong>
                <p>{announcement.data?.source ?? '正在读取本项目公告…'}</p>
              </div>
              <Icon icon={faArrowUpRightFromSquare} />
            </button>
          )}
          {ui.cards.includes('quote') && (
            <section className="home-quote glass">
              <Icon icon={faQuoteLeft} />
              <div>
                <p>
                  {quote.data?.text ??
                    (quote.isError ? '一言暂时不可用，点击右侧重试' : '正在获取随机一言…')}
                </p>
                <small>
                  {quote.data ? `${quote.data.author} · ${quote.data.source}` : '一言 Hitokoto'}
                </small>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="换一句一言"
                disabled={refreshQuote.isPending || !isDesktop()}
                onClick={() =>
                  refreshQuote.mutate(
                    { operation: 'content', kind: 'quote', refresh: true },
                    {
                      onSuccess: (data) => client.setQueryData(['home', 'content', 'quote'], data),
                      onError: fail,
                    },
                  )
                }
              >
                <Icon icon={faRotateRight} />
              </button>
            </section>
          )}
        </div>
        <div className={`home-dashboard-grid ${hasSide ? '' : 'home-no-side'}`}>
          {hasSide && (
            <aside className="home-overview-stack" data-home-enter>
              {ui.cards.includes('hardware') && (
                <section id="hardware-status" className="home-live-card glass">
                  <div className="home-card-heading">
                    <h2>我的设备</h2>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => navigate('/hardware')}
                    >
                      详情 <Icon icon={faArrowUpRightFromSquare} />
                    </button>
                  </div>
                  <p className="home-source">
                    {hardware.isError
                      ? '设备信息读取失败'
                      : hardware.data
                        ? (
                            {
                              ready: '实时数据',
                              degraded: '部分读数不可用',
                              starting: '正在连接',
                              stopped: '采集尚未启动',
                              failed: '采集异常',
                              stale: '数据已过期',
                            } as const
                          )[hardware.data.status]
                        : '正在读取设备…'}
                  </p>
                  {(
                    [
                      { kind: 'cpu', label: 'CPU', icon: faMicrochip },
                      { kind: 'gpu', label: 'GPU', icon: faDisplay },
                      { kind: 'memory', label: '内存', icon: faMemory },
                      { kind: 'motherboard', label: '主板', icon: faMicrochip },
                    ] as const
                  ).map((item) => (
                    <div className="home-hardware-row" key={item.kind}>
                      <Icon icon={item.icon} />
                      <span>{item.label}</span>
                      <strong title={device(item.kind)}>{device(item.kind)}</strong>
                    </div>
                  ))}
                </section>
              )}
              {ui.cards.includes('win-key') && (
                <section id="game-enhancement" className="home-live-card glass">
                  <div className="home-win-card">
                    <FeatureIcon icon={faKeyboard} tone="mint" />
                    <div>
                      <h2>游戏时禁用 Win 键</h2>
                      <p>
                        {home.data?.runtime.winKeyBlocked
                          ? '当前游戏窗口中生效'
                          : home.data?.policy.disableWinInGame
                            ? '识别游戏后自动生效'
                            : '未开启 · 仅在游戏前台拦截'}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="设置 Win 键控制"
                      onClick={() => workspace.setDialog({ kind: 'game-mode' })}
                    >
                      <Icon icon={faEllipsis} />
                    </button>
                  </div>
                </section>
              )}
              {ui.cards.includes('random-image') && (
                <button
                  type="button"
                  className="home-picture-card glass"
                  onClick={() => workspace.setDialog({ kind: 'random-image' })}
                >
                  {picture.data ? (
                    <img src={picture.data.data} alt={`随机图片，摄影：${picture.data.author}`} />
                  ) : (
                    <div className="home-picture-placeholder">
                      <Icon icon={faImage} />
                      <span>
                        {picture.isError ? '图片暂不可用，点击重试' : '正在获取随机图片…'}
                      </span>
                    </div>
                  )}
                  <div>
                    <span>
                      <Icon icon={faImage} />
                      随机图片
                    </span>
                    <Icon icon={faArrowUpRightFromSquare} />
                  </div>
                </button>
              )}
            </aside>
          )}
          {ui.cards.includes('launcher') && (
            <section className="home-launcher glass" data-home-enter aria-label="本机快捷启动">
              <div className="home-launcher-heading">
                <div>
                  <p className="home-eyebrow">QUICK LAUNCH</p>
                  <h2>
                    快捷启动 <span>{home.data ? rows.length : '—'}</span>
                  </h2>
                  <p>游戏与程序，随时出发。</p>
                </div>
                <button
                  type="button"
                  className="mint-button"
                  disabled={!home.data || action.isPending}
                  onClick={() => workspace.setDialog({ kind: 'add' })}
                >
                  <Icon icon={faPlus} />
                  添加程序
                </button>
              </div>
              <label className="home-launcher-search">
                <Icon icon={faMagnifyingGlass} />
                <input
                  type="search"
                  maxLength={256}
                  aria-label="搜索快捷启动"
                  placeholder="搜索已添加的游戏或程序…"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              {!home.data && (
                <p className="home-empty">
                  {home.isError ? '暂时无法读取快捷启动' : '正在读取本机快捷启动…'}
                </p>
              )}
              {home.data && visible.length === 0 && (
                <div className="home-empty">
                  <FeatureIcon icon={faGamepad} tone="mint" />
                  <h3>{rows.length ? '没有匹配的程序' : '从添加第一个程序开始'}</h3>
                  <p>
                    {rows.length
                      ? '换个名称或路径搜索。'
                      : '选择本机 EXE，自动提取图标，拖动即可调整顺序。'}
                  </p>
                </div>
              )}
              <div className="home-launcher-list">
                {visible.map((row) => {
                  const index = rows.findIndex((item) => item.id === row.id);
                  return (
                    <article
                      className="home-program"
                      key={row.id}
                      draggable={!action.isPending}
                      onDragStart={(event) => {
                        dragging.current = { id: row.id, revision: home.data?.revision ?? '' };
                        event.dataTransfer.setData('application/x-zhenjing-shortcut', row.id);
                        event.dataTransfer.effectAllowed = 'move';
                      }}
                      onDragEnd={() => {
                        dragging.current = null;
                      }}
                      onDragOver={(event) => {
                        if (dragging.current) {
                          event.preventDefault();
                          event.dataTransfer.dropEffect = 'move';
                        }
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        const source = dragging.current;
                        if (
                          !source ||
                          source.id !==
                            event.dataTransfer.getData('application/x-zhenjing-shortcut')
                        )
                          return;
                        if (source.revision !== home.data?.revision) {
                          workspace.notify('快捷启动列表已变化，请重新拖动。');
                          return;
                        }
                        move(source.id, row.id);
                        dragging.current = null;
                      }}
                      aria-label={row.name}
                    >
                      <div className="home-program-icon">
                        <ProgramIcon id={row.id} />
                      </div>
                      <button
                        type="button"
                        className="home-program-name"
                        title={row.path}
                        onClick={() => workspace.setDialog({ kind: 'shortcut', id: row.id })}
                      >
                        <strong>{row.name}</strong>
                        <small>
                          {row.lastLaunched
                            ? new Date(row.lastLaunched).toLocaleDateString(locale)
                            : row.isGame
                              ? '游戏快捷入口'
                              : '程序快捷入口'}
                        </small>
                      </button>
                      <button
                        type="button"
                        className="home-program-play"
                        aria-label={`启动${row.name}`}
                        disabled={action.isPending}
                        onClick={() => launch(row)}
                      >
                        <Icon icon={faPlay} />
                      </button>
                      <div className="home-program-tools">
                        <Icon icon={faGripVertical} />
                        <button
                          type="button"
                          className="icon-button"
                          aria-label={`上移${row.name}`}
                          disabled={index === 0 || action.isPending}
                          onClick={() => {
                            const previous = rows[index - 1];
                            if (previous) move(row.id, previous.id);
                          }}
                        >
                          <Icon icon={faArrowUp} />
                        </button>
                        <button
                          type="button"
                          className="icon-button"
                          aria-label={`下移${row.name}`}
                          disabled={index === rows.length - 1 || action.isPending}
                          onClick={() => {
                            const next = rows[index + 1];
                            if (next) move(row.id, next.id);
                          }}
                        >
                          <Icon icon={faArrowDown} />
                        </button>
                        <button
                          type="button"
                          className="icon-button"
                          aria-label={`管理${row.name}`}
                          onClick={() => workspace.setDialog({ kind: 'shortcut', id: row.id })}
                        >
                          <Icon icon={faEllipsis} />
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
              <footer className="home-launcher-footer">
                <span>拖动排序 · 修改立即保存 · 移除不删除原程序</span>
                <button type="button" className="text-button" onClick={() => navigate('/library')}>
                  Steam 游戏库 <Icon icon={faArrowUpRightFromSquare} />
                </button>
              </footer>
            </section>
          )}
        </div>
        {home.data?.runtime.message && (
          <p className="home-live-alert" role="status">
            {home.data.runtime.message}
          </p>
        )}
      </main>
    </WorkspaceLayout>
  );
}
