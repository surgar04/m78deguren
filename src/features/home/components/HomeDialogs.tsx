import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { faMagnifyingGlass, faPlay, faGamepad, faGear } from '@fortawesome/free-solid-svg-icons';
import { Modal } from './Modal';
import { Icon } from './Icon';
import {
  AddShortcut,
  GameModeControls,
  RandomPicture,
  Announcement,
  ShortcutDetails,
} from './HomeActions';
import { useHome } from '../repository';
import { useToolCatalog } from '@/features/tools/repository';
import { useSteam } from '@/features/library/repository';
import { useHomePreferences } from '../store';
import { HOME_GUIDE } from '../help';
import { DEFAULT_WALLPAPER, useWallpaper } from '@/features/settings/wallpaper';
import { useSettingsUi } from '@/features/settings/ui-store';
import { errorMessage } from '@/lib/desktop';
import type { DialogState, HomeData } from '../types';

function GlobalSearch({ open, close }: { open: (dialog: DialogState) => void; close: () => void }) {
  const [query, setQuery] = useState(''),
    home = useHome(),
    tools = useToolCatalog(),
    steam = useSteam(),
    navigate = useNavigate();
  const text = query.normalize('NFKC').trim().toLocaleLowerCase();
  const matches = (value: string) => value.normalize('NFKC').toLocaleLowerCase().includes(text);
  const shortcuts =
    home.data?.shortcuts.filter((row) => matches(`${row.name} ${row.path}`)).slice(0, 12) ?? [];
  const games =
    steam.data?.games.filter((row) => matches(`${row.name} ${row.appId}`)).slice(0, 8) ?? [];
  const entries =
    tools.data?.tools.filter((row) => matches([row.name, ...row.aliases].join(' '))).slice(0, 8) ??
    [];
  return (
    <div className="search-dialog-content">
      <label className="dialog-search">
        <Icon icon={faMagnifyingGlass} />
        <input
          autoFocus
          type="search"
          value={query}
          maxLength={256}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索程序、Steam 游戏或工具…"
          aria-label="搜索游戏、工具或功能"
        />
      </label>
      <div className="search-results" aria-live="polite">
        <h3>本机快捷启动</h3>
        {shortcuts.map((row) => (
          <button key={row.id} type="button" onClick={() => open({ kind: 'shortcut', id: row.id })}>
            <Icon icon={faPlay} />
            <span>{row.name}</span>
          </button>
        ))}
        {!shortcuts.length && <p className="modal-description">没有匹配的快捷入口</p>}
        <h3>Steam 游戏</h3>
        {games.map((game) => (
          <button
            key={game.appId}
            type="button"
            onClick={() => {
              close();
              void navigate(`/library?search=${game.appId}`);
            }}
          >
            <Icon icon={faGamepad} />
            <span>{game.name}</span>
          </button>
        ))}
        {steam.isError && <p className="modal-description">{errorMessage(steam.error)}</p>}
        {!games.length && !steam.isPending && (
          <p className="modal-description">没有可匹配的本机 Steam 记录</p>
        )}
        <h3>内置工具</h3>
        {entries.map((tool) => (
          <button
            key={tool.id}
            type="button"
            onClick={() => {
              close();
              void navigate(`/tools/${tool.id}`);
            }}
          >
            <span>{tool.name}</span>
          </button>
        ))}
        <button type="button" onClick={() => open({ kind: 'game-mode' })}>
          <Icon icon={faGamepad} />
          游戏模式与 Win 键控制
        </button>
        <button
          type="button"
          onClick={() => {
            close();
            void navigate('/settings');
          }}
        >
          <Icon icon={faGear} />
          设置
        </button>
      </div>
      <p className="search-hint">Tab 切换结果 · Enter 打开 · Esc 关闭</p>
    </div>
  );
}

export function HomeDialogs({
  dialog,
  open,
  notify,
}: {
  dialog: Exclude<DialogState, null>;
  data: HomeData;
  open: (dialog: DialogState) => void;
  notify: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('');
  const home = useHome(),
    ui = useSettingsUi(),
    wallpaper = useWallpaper(),
    dim = useHomePreferences((state) => state.wallpaperDim),
    setDim = useHomePreferences((state) => state.setWallpaperDim);
  const close = () => {
    if (!busy) open(null);
  };
  const finish = () => open(null);
  const feedback = (message: string) => {
    setNotice(message);
    notify(message);
  };
  const title =
    dialog.kind === 'info'
      ? dialog.title
      : dialog.kind === 'shortcut'
        ? (home.data?.shortcuts.find((row) => row.id === dialog.id)?.name ?? '快捷启动')
        : (
            {
              add: '添加快捷启动',
              search: '探索臻境',
              appearance: '外观与工作空间',
              'game-mode': '游戏模式与按键控制',
              'random-image': '随机图片',
              announcements: '公告与版本说明',
            } as const
          )[dialog.kind];
  return (
    <Modal
      title={title}
      onClose={close}
      wide={['search', 'random-image', 'announcements'].includes(dialog.kind)}
    >
      {dialog.kind === 'add' && <AddShortcut notify={feedback} close={finish} busy={setBusy} />}
      {dialog.kind === 'search' && <GlobalSearch open={open} close={close} />}
      {dialog.kind === 'game-mode' && (
        <GameModeControls notify={feedback} busy={setBusy} initialManual={dialog.manual} />
      )}
      {dialog.kind === 'random-image' && <RandomPicture notify={feedback} busy={setBusy} />}
      {dialog.kind === 'announcements' && <Announcement notify={feedback} />}
      {dialog.kind === 'shortcut' && (
        <ShortcutDetails id={dialog.id} notify={feedback} close={finish} busy={setBusy} />
      )}
      {dialog.kind === 'appearance' && (
        <div className="appearance-content">
          <img src={wallpaper.url ?? DEFAULT_WALLPAPER} alt="当前工作空间壁纸" />
          <div className="appearance-setting">
            <div>
              <h3>柔化背景</h3>
              <p>降低壁纸对内容阅读的干扰</p>
            </div>
            <button
              type="button"
              className={`toggle ${dim ? 'on' : ''}`}
              role="switch"
              aria-label="柔化背景"
              aria-checked={dim}
              onClick={() => setDim(!dim)}
            >
              <span />
            </button>
          </div>
          <p className="modal-description">
            当前用户名：{ui.username || home.data?.username || '正在读取'}
          </p>
          <Link className="text-button" to="/settings" onClick={close}>
            更多偏好设置
          </Link>
        </div>
      )}
      {dialog.kind === 'info' && (
        <div className="info-content">
          <p className="modal-description home-guide-text">{dialog.description}</p>
          <button type="button" className="mint-button" onClick={close}>
            知道了
          </button>
          {dialog.title !== HOME_GUIDE.title && (
            <button type="button" className="text-button" onClick={() => open(HOME_GUIDE)}>
              使用文档
            </button>
          )}
        </div>
      )}
      {notice && (
        <p className="inline-note" role="status">
          {notice}
        </p>
      )}
      {busy && (
        <p className="home-source" role="status">
          正在等待原生操作完成，请稍候…
        </p>
      )}
    </Modal>
  );
}
