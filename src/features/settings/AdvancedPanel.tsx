import { bytes } from './format';
import { HudToggle } from '@/features/hud/HudPanel';
import { useState } from 'react';
import { z } from 'zod';
import { Link } from 'react-router-dom';
import {
  cacheReceiptSchema,
  footprintSchema,
  maintenancePreviewSchema,
  pawnPreparedSchema,
  pawnStatusSchema,
  resetBackupSchema,
} from '@/lib/settings-contracts';
import { filterSnapshotSchema } from '@/lib/builtin-contracts';
import { useBuiltinQuery } from '@/features/tools/native/builtin-hooks';
import {
  useSettingsAction,
  useSettingsQuery,
  useSettingsSnapshot,
  useNativePatch,
} from './repository';
import { Failure, Review, SettingRow, SettingToggle } from './controls';
import { useText } from './i18n';

type Preview = z.infer<typeof maintenancePreviewSchema>;
type Pawn = z.infer<typeof pawnPreparedSchema>;
function FilterRules() {
  const { t } = useText();
  const query = useBuiltinQuery({ operation: 'filter-status' }, filterSnapshotSchema);
  const action = useSettingsAction(z.null());
  const [process, setProcess] = useState('');
  const [preset, setPreset] = useState('');
  const config = query.data?.config;
  return (
    <section>
      <h3>{t('滤镜游戏名单')}</h3>
      <Failure error={query.error ?? action.error} />
      {config && (
        <>
          <SettingToggle
            label="仅前台游戏自动应用"
            checked={config.autoGame}
            disabled={query.data?.enabled || action.isPending}
            onChange={(autoGame) =>
              action.mutate(
                { operation: 'filter-rules', rules: config.rules, autoGame },
                {
                  onSuccess: () => {
                    void query.refetch();
                  },
                },
              )
            }
          />
          {config.rules.map((rule, index) => (
            <SettingRow
              key={rule.process}
              label={rule.process}
              description={
                query.data?.presets.find((row) => row.id === rule.preset)?.name ?? rule.preset
              }
            >
              <button
                type="button"
                disabled={query.data?.enabled || action.isPending}
                onClick={() =>
                  action.mutate(
                    {
                      operation: 'filter-rules',
                      rules: config.rules.filter((_, own) => own !== index),
                      autoGame: config.autoGame,
                    },
                    {
                      onSuccess: () => {
                        void query.refetch();
                      },
                    },
                  )
                }
              >
                {t('删除')}
              </button>
            </SettingRow>
          ))}
          <form
            className="settings-server-form"
            onSubmit={(event) => {
              event.preventDefault();
              action.mutate(
                {
                  operation: 'filter-rules',
                  rules: [...config.rules, { process, preset }],
                  autoGame: config.autoGame,
                },
                {
                  onSuccess: () => {
                    setProcess('');
                    void query.refetch();
                  },
                },
              );
            }}
          >
            <label>
              进程文件名
              <input
                required
                pattern={'[^\\/:*?<>|"]+\\.exe'}
                maxLength={80}
                value={process}
                onChange={(event) => setProcess(event.target.value)}
                placeholder="game.exe"
              />
            </label>
            <label>
              滤镜预设
              <select required value={preset} onChange={(event) => setPreset(event.target.value)}>
                <option value="">—</option>
                {query.data?.presets.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              disabled={query.data?.enabled || action.isPending || config.rules.length >= 20}
            >
              {t('保存')}
            </button>
          </form>
          {query.data?.enabled && <p>请先停止滤镜，再编辑规则。</p>}
          <Link to="/tools/display-filter">{t('滤镜')}</Link>
        </>
      )}
    </section>
  );
}
/** 重置和恢复先取得带时限的原生预览；JS 不负责删除路径或替换可执行文件。 */
export function AdvancedPanel() {
  const { t } = useText();
  const snapshot = useSettingsSnapshot();
  const patch = useNativePatch();
  const footprint = useSettingsQuery({ operation: 'footprint' }, footprintSchema);
  const pawn = useSettingsQuery({ operation: 'pawn-status' }, pawnStatusSchema);
  const backups = useSettingsQuery(
    { operation: 'reset-backups' },
    z.array(resetBackupSchema).max(30),
  );
  const prepare = useSettingsAction(maintenancePreviewSchema);
  const execute = useSettingsAction(z.unknown());
  const clear = useSettingsAction(cacheReceiptSchema);
  const pawnPrepare = useSettingsAction(pawnPreparedSchema);
  const [review, setReview] = useState<Preview | null>(null);
  const [pawnReview, setPawnReview] = useState<Pawn | null>(null);
  const [resetText, setResetText] = useState('');
  const [consent, setConsent] = useState(false);
  const [cacheReview, setCacheReview] = useState(false);
  const error =
    snapshot.error ??
    patch.error ??
    footprint.error ??
    pawn.error ??
    backups.error ??
    prepare.error ??
    execute.error ??
    clear.error ??
    pawnPrepare.error;
  return (
    <>
      <h2>{t('高级')}</h2>
      <Failure error={error} />
      <h3>{t('应用数据')}</h3>
      {footprint.data && (
        <>
          <code className="settings-path">{footprint.data.dataRoot}</code>
          <p>
            {bytes(footprint.data.dataBytes)} · Cache {bytes(footprint.data.cacheBytes)} ·{' '}
            {footprint.data.files} files{' '}
            {footprint.data.skipped > 0 ? `· ${footprint.data.skipped} skipped` : ''}
          </p>
        </>
      )}
      <div className="settings-actions">
        <button
          type="button"
          disabled={footprint.isFetching}
          onClick={() => {
            void footprint.refetch();
          }}
        >
          {t('刷新')}
        </button>
        <button type="button" disabled={clear.isPending} onClick={() => setCacheReview(true)}>
          {t('清理缓存')}
        </button>
        <button
          type="button"
          disabled={prepare.isPending}
          onClick={() =>
            prepare.mutate(
              { operation: 'reset-prepare' },
              {
                onSuccess: (value) => {
                  setReview(value);
                  setResetText('');
                },
              },
            )
          }
        >
          {t('清除数据并重启')}
        </button>
      </div>
      {clear.data && (
        <p role="status">
          已清理 {bytes(clear.data.removedBytes)} / {clear.data.removedFiles} files；占用或不可清理{' '}
          {clear.data.skipped} 项。
        </p>
      )}
      {cacheReview && (
        <Review
          title={t('清理缓存')}
          busy={clear.isPending}
          onCancel={() => setCacheReview(false)}
          onConfirm={() =>
            clear.mutate(
              { operation: 'cache-clear', consent: true },
              { onSuccess: () => setCacheReview(false) },
            )
          }
        >
          <p>
            仅清理臻境的下载临时缓存、桥接脚本与 WebView
            缓存；保留下载成品、设置、工具备份与操作记录。占用中的文件会跳过。
          </p>
        </Review>
      )}
      <details>
        <summary>{t('备份与恢复')}</summary>
        {backups.data?.map((row) => (
          <SettingRow
            key={row.id}
            label={new Date(row.createdAt).toLocaleString()}
            description={`${row.state} · ${row.message}`}
          >
            <button
              type="button"
              disabled={prepare.isPending || row.state !== 'completed'}
              onClick={() =>
                prepare.mutate(
                  { operation: 'reset-restore-prepare', id: row.id },
                  {
                    onSuccess: (value) => {
                      setReview(value);
                      setResetText('');
                    },
                  },
                )
              }
            >
              {t('恢复')}
            </button>
          </SettingRow>
        ))}
        {backups.data?.length === 0 && <p>暂无应用数据备份</p>}
      </details>
      {review && (
        <Review
          title={review.restore ? t('恢复') : t('清除数据并重启')}
          busy={execute.isPending}
          canConfirm={review.restore || resetText === 'RESET'}
          onCancel={() => setReview(null)}
          onConfirm={() => {
            if (review.restore)
              execute.mutate({
                operation: 'reset-restore-apply',
                token: review.token,
                consent: true,
              });
            else if (resetText === 'RESET')
              execute.mutate({
                operation: 'reset-apply',
                token: review.token,
                confirmation: 'RESET',
                consent: true,
              });
          }}
        >
          <p>
            数据目录：<code>{review.dataRoot}</code>
          </p>
          <p>
            备份目录：<code>{review.backupRoot}</code> · {bytes(review.bytes)}
          </p>
          <p>
            先备份，再关闭所有臻境窗口、处理数据并重启；启动失败会尝试回滚。不会撤销此前对 Windows
            的优化、驱动或启动项修改。请先停止正在运行的滤镜、音频引擎、连点器及下载。
          </p>
          {!review.restore && (
            <label>
              输入 RESET 确认
              <input
                value={resetText}
                onChange={(event) => setResetText(event.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
          )}
        </Review>
      )}
      <h3>PawnIO</h3>
      <SettingRow
        label="PawnIO"
        description={
          pawn.data
            ? `${pawn.data.installed ? (pawn.data.version ?? '已安装') : '未安装'} · ${pawn.data.service}${pawn.data.error ? ` · ${pawn.data.error}` : ''}`
            : '…'
        }
      >
        <button
          type="button"
          disabled={pawnPrepare.isPending}
          onClick={() =>
            pawnPrepare.mutate(
              { operation: 'pawn-prepare' },
              {
                onSuccess: (value) => {
                  setPawnReview(value);
                  setConsent(false);
                },
              },
            )
          }
        >
          准备签名安装器
        </button>
        <button
          type="button"
          onClick={() => {
            void pawn.refetch();
          }}
        >
          {t('刷新')}
        </button>
      </SettingRow>
      {pawnReview && (
        <Review
          title={`PawnIO · ${pawnReview.installed ? t('卸载') : t('安装')}`}
          busy={execute.isPending}
          canConfirm={consent}
          onCancel={() => setPawnReview(null)}
          onConfirm={() => {
            if (consent)
              execute.mutate(
                {
                  operation: 'pawn-apply',
                  token: pawnReview.token,
                  install: !pawnReview.installed,
                  consent: true,
                },
                { onSuccess: () => setPawnReview(null) },
              );
          }}
        >
          <p>
            {pawnReview.version} · Publisher: {pawnReview.publisher}
          </p>
          <code className="settings-path">SHA256 {pawnReview.sha256}</code>
          <p>
            需要管理员确认。驱动和注册信息会写入 Windows 系统；安装器、原驱动备份与收据保存在 D
            盘。恢复入口为本页的反向安装 /
            卸载；原有不同版本不能自动精确降级，需使用备份及原厂签名安装器。
          </p>
          <label>
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
            />
            我确认本次{pawnReview.installed ? '卸载' : '安装'} PawnIO 驱动
          </label>
        </Review>
      )}
      <FilterRules />
      {snapshot.data && (
        <>
          <SettingToggle
            label={t('媒体键控制')}
            description="控制 Windows 当前媒体会话，关闭后释放实体媒体键。"
            checked={snapshot.data.config.mediaKeys}
            disabled={patch.isPending}
            onChange={(value) => patch.patch({ kind: 'media-keys', value })}
          />
          <HudToggle />
        </>
      )}
    </>
  );
}
