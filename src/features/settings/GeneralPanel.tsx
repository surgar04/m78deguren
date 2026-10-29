import { useState } from 'react';
import { z } from 'zod';
import { assetSchema, runtimeSettingsSchema } from '@/lib/settings-contracts';
import {
  useSettingsAction,
  useSettingsSnapshot,
  useSettingsQuery,
  useNativePatch,
} from './repository';
import { SettingRow, SettingSelect, SettingToggle, Failure, Review } from './controls';
import { useSettingsUi, CARD_IDS } from './ui-store';
import { useText, type TextKey } from './i18n';

const NAV_LABELS = {
  home: '首页',
  library: '游戏库',
  hardware: '硬件',
  tools: '工具',
  optimization: '优化',
  settings: '设置',
} as const satisfies Record<string, TextKey>;
const CARDS = {
  statistics: '运行信息',
  announcement: '公告',
  quote: '每日寄语',
  launcher: '游戏启动器',
  hardware: '硬件',
  'win-key': 'Win 键',
  'game-mode': '游戏模式',
  search: '搜索',
  feedback: '反馈',
  community: '社区',
  docs: '文档',
  remote: '设备配对',
  'random-image': '随机图片',
  mood: '心境',
} as const satisfies Record<string, TextKey>;
const historySchema = z
  .array(
    z
      .object({ id: z.uuid(), createdAt: z.number(), before: z.unknown(), after: z.unknown() })
      .passthrough(),
  )
  .max(30);
export function GeneralPanel() {
  const ui = useSettingsUi();
  const { t } = useText();
  const snapshot = useSettingsSnapshot();
  const native = useNativePatch();
  const config = snapshot.data?.config;
  const runtime = useSettingsQuery({ operation: 'runtime' }, runtimeSettingsSchema, 5_000);
  const action = useSettingsAction(z.unknown());
  const logo = useSettingsAction(assetSchema.nullable());
  const history = useSettingsQuery({ operation: 'autostart-history' }, historySchema);
  const [start, setStart] = useState<boolean | null>(null);
  const [restore, setRestore] = useState<string | null>(null);
  const move = (index: number, offset: number) => {
    const order = [...ui.navOrder];
    const target = index + offset;
    if (target < 0 || target >= order.length) return;
    const a = order[index];
    const b = order[target];
    if (!a || !b) return;
    order[index] = b;
    order[target] = a;
    ui.patch({ navOrder: order });
  };
  return (
    <>
      <h2>{t('通用偏好')}</h2>
      <Failure
        error={snapshot.error ?? runtime.error ?? native.error ?? action.error ?? logo.error}
      />
      <SettingToggle
        label={t('开机自启')}
        checked={runtime.data?.autostart.enabled ?? false}
        disabled={!runtime.data || action.isPending}
        onChange={setStart}
      />
      {runtime.data?.autostart.error && <p role="alert">{runtime.data.autostart.error}</p>}
      {runtime.data?.autostart.enabled && !runtime.data.autostart.matches && (
        <SettingRow
          label="修复启动项"
          description="启动项指向旧程序或不同数据目录。确认后更新路径，原值会保留备份。"
        >
          <button type="button" disabled={action.isPending} onClick={() => setStart(true)}>
            更新启动路径
          </button>
        </SettingRow>
      )}
      {start !== null && (
        <Review
          title={t('开机自启')}
          busy={action.isPending}
          onCancel={() => setStart(null)}
          onConfirm={() =>
            action.mutate(
              { operation: 'autostart-set', enabled: start, consent: true },
              { onSuccess: () => setStart(null) },
            )
          }
        >
          <p>
            将{start ? '创建' : '移除'} Windows 当前用户的臻境启动项。修改前会备份到 D
            盘，可在下方恢复。
          </p>
        </Review>
      )}
      {config && (
        <>
          <SettingToggle
            label={t('开机最小化')}
            checked={config.minimizedStart}
            disabled={native.isPending}
            onChange={(value) => native.patch({ kind: 'minimized-start', value })}
          />
          <SettingToggle
            label="二次确认"
            description="默认开启。关闭后，游戏模式、自动启用、游戏 Win 键控制与进程恢复直接执行；安装、账号移除及高风险系统操作仍需单独确认。"
            checked={config.confirmActions}
            disabled={native.isPending}
            onChange={(value) => native.patch({ kind: 'confirm-actions', value })}
          />
          <SettingToggle
            label="自动检查更新"
            description="启动后检查新版本，并每 4 小时复查；检查不会自动安装更新。"
            checked={config.checkUpdates}
            disabled={native.isPending}
            onChange={(value) => native.patch({ kind: 'check-updates', value })}
          />
          <SettingToggle
            label="更新提醒"
            description="发现新版本或下载完成后，在软件内提醒；可稍后处理。"
            checked={config.updateReminders}
            disabled={native.isPending}
            onChange={(value) => native.patch({ kind: 'update-reminders', value })}
          />
          <SettingToggle
            label={t('自动更新偏好')}
            description="自动下载检测到的可信新版本；安装更新前始终需要单独确认。"
            checked={config.autoUpdate}
            disabled={native.isPending}
            onChange={(value) => native.patch({ kind: 'auto-update', value })}
          />
          <SettingSelect
            label={t('关闭行为')}
            value={config.closeBehavior}
            options={[
              { value: 'exit', label: t('退出程序') },
              { value: 'tray', label: t('收至托盘') },
            ]}
            onChange={(value) => {
              if (value === 'exit' || value === 'tray')
                native.patch({ kind: 'close-behavior', value });
            }}
          />
        </>
      )}
      <SettingSelect
        label={t('界面语言')}
        value={ui.language}
        options={[
          { value: 'system', label: t('跟随系统') },
          { value: 'zh-CN', label: '简体中文' },
          { value: 'zh-TW', label: '繁體中文' },
          { value: 'en', label: 'English' },
          { value: 'ja', label: '日本語' },
          { value: 'de', label: 'Deutsch' },
          { value: 'fr', label: 'Français' },
        ]}
        onChange={(language) => ui.patch({ language })}
      />
      <SettingRow label={t('首页用户名')}>
        <input
          aria-label={t('首页用户名')}
          maxLength={40}
          value={ui.username}
          placeholder="旅行者"
          onChange={(event) => ui.patch({ username: event.target.value })}
        />
      </SettingRow>
      <SettingToggle
        label={t('启动 Logo')}
        checked={ui.splashEnabled}
        onChange={(splashEnabled) => ui.patch({ splashEnabled })}
      />
      <SettingRow label={t('启动 Logo')}>
        <button
          type="button"
          disabled={logo.isPending}
          onClick={() =>
            logo.mutate(
              { operation: 'asset-import', kind: 'logo' },
              {
                onSuccess: (asset) => {
                  if (asset) ui.patch({ splashLogo: asset.id });
                },
              },
            )
          }
        >
          {t('更换 Logo')}
        </button>
        <button type="button" onClick={() => ui.patch({ splashLogo: null })}>
          {t('默认')}
        </button>
      </SettingRow>
      <SettingSelect
        label={t('导航布局')}
        value={ui.navPosition}
        options={[
          { value: 'side', label: t('侧边') },
          { value: 'top', label: t('顶部') },
        ]}
        onChange={(navPosition) => ui.patch({ navPosition })}
      />
      <SettingToggle
        label={t('导航文字')}
        checked={ui.navLabels}
        onChange={(navLabels) => ui.patch({ navLabels })}
      />
      <h3>{t('可见项与排序')}</h3>
      <div className="settings-nav-editor">
        {ui.navOrder.map((id, index) => (
          <div key={id}>
            <label>
              <input
                type="checkbox"
                checked={ui.navVisible.includes(id)}
                disabled={id === 'home' || id === 'settings'}
                onChange={(event) =>
                  ui.patch({
                    navVisible: event.target.checked
                      ? [...ui.navVisible, id]
                      : ui.navVisible.filter((value) => value !== id),
                  })
                }
              />
              {t(NAV_LABELS[id])}
            </label>
            <button
              type="button"
              disabled={index === 0}
              aria-label={`${t(NAV_LABELS[id])} ↑`}
              onClick={() => move(index, -1)}
            >
              ↑
            </button>
            <button
              type="button"
              disabled={index === ui.navOrder.length - 1}
              aria-label={`${t(NAV_LABELS[id])} ↓`}
              onClick={() => move(index, 1)}
            >
              ↓
            </button>
          </div>
        ))}
      </div>
      <h3>{t('首页卡片')}</h3>
      <div className="settings-checkbox-grid">
        {CARD_IDS.filter((id) => id !== 'remote' && id !== 'mood' && id !== 'community').map(
          (id) => (
            <label key={id}>
              <input
                type="checkbox"
                checked={ui.cards.includes(id)}
                onChange={(event) =>
                  ui.patch({
                    cards: event.target.checked
                      ? [...ui.cards, id]
                      : ui.cards.filter((value) => value !== id),
                  })
                }
              />
              {t(CARDS[id])}
            </label>
          ),
        )}
      </div>
      <details>
        <summary>
          {t('备份与恢复')} · {t('开机自启')}
        </summary>
        <Failure error={history.error} />
        {history.data?.map((row) => (
          <SettingRow key={row.id} label={new Date(row.createdAt).toLocaleString()}>
            <button type="button" disabled={action.isPending} onClick={() => setRestore(row.id)}>
              {t('恢复')}
            </button>
          </SettingRow>
        ))}
      </details>
      {restore && (
        <Review
          title={t('恢复')}
          busy={action.isPending}
          onCancel={() => setRestore(null)}
          onConfirm={() =>
            action.mutate(
              { operation: 'autostart-restore', id: restore, consent: true },
              { onSuccess: () => setRestore(null) },
            )
          }
        >
          <p>恢复指定备份中的原始启动项。若启动项已被其他软件修改，将停止并报告冲突。</p>
        </Review>
      )}
    </>
  );
}
