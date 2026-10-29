import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  setupStorageSchema,
  partitionPlanSchema,
  migrationPlanSchema,
  setupJobSchema,
} from '@/lib/onboarding-contracts';
import { Failure, Consent } from './controls';
import { useStorage, useSetupAction, useSetupStatus } from './repository';
export function StorageStep() {
  const query = useStorage(),
    client = useQueryClient(),
    status = useSetupStatus();
  const [want, setWant] = useState(false),
    [newSize, setNewSize] = useState(64),
    [backup, setBackup] = useState(false),
    [confirmation, setConfirmation] = useState('');
  const elevate = useSetupAction(setupStorageSchema),
    plan = useSetupAction(partitionPlanSchema),
    apply = useSetupAction(setupJobSchema),
    recovery = useSetupAction(z.null());
  const value = query.data,
    size = value?.canSplit ? Math.min(Math.max(newSize, value.minNewGiB), value.maxNewGiB) : 0;
  const busy =
    elevate.isPending ||
    plan.isPending ||
    apply.isPending ||
    ['running', 'unknown'].includes(status.data?.job.phase ?? '');
  return (
    <>
      <p className="setup-lead">先看看磁盘空间，让游戏和应用有自己的位置。</p>
      {query.isPending && <p>正在检测卷和可用空间…</p>}
      <Failure
        error={query.error ?? elevate.error ?? plan.error ?? apply.error ?? recovery.error}
      />
      {value && (
        <>
          <div className="setup-volume-list">
            {value.volumes.map((volume) => (
              <div key={volume.letter}>
                <strong>
                  {volume.letter}: {volume.name}
                </strong>
                <span>
                  可用 {(volume.freeBytes / 1073741824).toFixed(1)} /{' '}
                  {(volume.totalBytes / 1073741824).toFixed(1)} GiB
                </span>
              </div>
            ))}
          </div>
          {value.onlySystemVolume ? (
            <>
              <p>当前只有一个可见固定数据卷。是否创建独立 D 盘？</p>
              <div className="setup-actions">
                <button
                  type="button"
                  aria-pressed={!want}
                  onClick={() => setWant(false)}
                  disabled={busy}
                >
                  暂不分盘
                </button>
                <button
                  type="button"
                  aria-pressed={want}
                  onClick={() => setWant(true)}
                  disabled={busy}
                >
                  创建独立 D 盘
                </button>
              </div>
              {want && (
                <>
                  <button
                    type="button"
                    disabled={busy || status.data?.restrictedMode}
                    onClick={() =>
                      elevate.mutate(
                        { operation: 'storage-elevate', consent: true },
                        {
                          onSuccess: (data) => client.setQueryData(['onboarding', 'storage'], data),
                        },
                      )
                    }
                  >
                    管理员只读预检 · 检查可收缩容量
                  </button>
                  <p className="setup-note">
                    只支持健康、未加密的基本 GPT 系统卷。不会自动关闭
                    BitLocker，也不会移动恢复分区或改动已存在的 D 盘。
                  </p>
                  {value.canSplit ? (
                    <>
                      <div className="setup-partition-preview">
                        <div style={{ flex: Math.max(1, value.systemSizeGiB - size) }}>
                          {value.systemDrive}: {value.systemSizeGiB - size} GiB
                        </div>
                        <div style={{ flex: Math.max(1, size) }}>D: {size} GiB</div>
                      </div>
                      <label>
                        新 D 盘容量：{size} GiB
                        <input
                          type="range"
                          aria-label="新 D 盘容量"
                          min={value.minNewGiB}
                          max={value.maxNewGiB}
                          value={size}
                          disabled={busy}
                          onChange={(event) => {
                            setNewSize(Number(event.target.value));
                            plan.reset();
                            setConfirmation('');
                          }}
                        />
                      </label>
                      <button
                        type="button"
                        disabled={busy || status.data?.restrictedMode}
                        onClick={() => plan.mutate({ operation: 'partition-prepare', gib: size })}
                      >
                        生成具体分区方案
                      </button>
                    </>
                  ) : (
                    <p className="setup-note">{value.reason}</p>
                  )}
                  {plan.data && (
                    <div className="setup-install-confirm">
                      <p>
                        系统卷：{plan.data.systemBeforeGiB} → {plan.data.systemAfterGiB} GiB；新 D
                        盘：{plan.data.newGiB} GiB。计划 15 分钟有效。
                      </p>
                      <p className="setup-note">
                        布局记录：{plan.data.backupPath}
                        。这不是文件备份。收缩后未创建新分区时会尝试扩回；一旦创建新卷，失败不会自动删除它。完成后合并分区需先转移文件，再手动使用磁盘管理。
                      </p>
                      <Consent checked={backup} onChange={setBackup}>
                        重要文件已经备份到其他设备；我理解断电和分区故障风险，分区布局记录不能恢复文件。
                      </Consent>
                      <label>
                        输入“创建 D 盘”以确认
                        <input
                          type="text"
                          value={confirmation}
                          maxLength={20}
                          onChange={(event) => setConfirmation(event.target.value)}
                          autoComplete="off"
                        />
                      </label>
                      <button
                        type="button"
                        className="setup-primary"
                        disabled={
                          busy ||
                          !backup ||
                          confirmation !== '创建 D 盘' ||
                          status.data?.restrictedMode
                        }
                        onClick={() =>
                          apply.mutate(
                            {
                              operation: 'partition-apply',
                              token: plan.data.token,
                              confirmation: '创建 D 盘',
                              backupConfirmed: true,
                              consent: true,
                            },
                            {
                              onSuccess: () => {
                                void client.invalidateQueries({
                                  queryKey: ['onboarding', 'storage'],
                                });
                                plan.reset();
                              },
                            },
                          )
                        }
                      >
                        确认并自动创建 D 盘
                      </button>
                    </div>
                  )}
                </>
              )}
            </>
          ) : (
            <p>已存在独立数据卷，可以直接继续。</p>
          )}
          <button type="button" onClick={() => recovery.mutate({ operation: 'disk-recovery' })}>
            打开 Windows 磁盘管理 · 恢复入口
          </button>
        </>
      )}
    </>
  );
}
export function MigrationStep() {
  const query = useStorage(),
    status = useSetupStatus(),
    [drive, setDrive] = useState(''),
    [consent, setConsent] = useState(false),
    [cleanup, setCleanup] = useState(true),
    [confirmation, setConfirmation] = useState('');
  const prepare = useSetupAction(migrationPlanSchema),
    apply = useSetupAction(z.null()),
    recovery = useSetupAction(z.null());
  const value = query.data,
    target =
      drive || value?.volumes.find((volume) => volume.letter !== value.systemDrive)?.letter || '';
  const busy =
    prepare.isPending ||
    apply.isPending ||
    ['running', 'unknown'].includes(status.data?.job.phase ?? '');
  return (
    <>
      <p className="setup-lead">将应用和本机档案放到独立数据盘。</p>
      <Failure error={query.error ?? prepare.error ?? apply.error ?? recovery.error} />
      {value && (
        <>
          <div className="setup-detail">
            <span>当前应用位置</span>
            <strong>{value.installationPath}</strong>
          </div>
          {value.installedOnSystem ? (
            <>
              <p>
                应用目前位于系统盘。迁移将通过 MSI
                卸载／重装完成，并更新快捷方式和数据位置；原数据保留到新位置启动验证成功。
              </p>
              <label>
                迁移目标磁盘
                <select
                  value={target}
                  disabled={busy}
                  onChange={(event) => {
                    setDrive(event.target.value);
                    prepare.reset();
                  }}
                >
                  <option value="" disabled>
                    选择非系统盘
                  </option>
                  {value.volumes
                    .filter((volume) => volume.letter !== value.systemDrive)
                    .map((volume) => (
                      <option key={volume.letter} value={volume.letter}>
                        {volume.letter}: · 可用 {(volume.freeBytes / 1073741824).toFixed(1)} GiB
                      </option>
                    ))}
                </select>
              </label>
              {!target && (
                <p className="setup-note">
                  尚无独立数据盘，可返回上一步创建，也可保留当前安装位置。
                </p>
              )}
              <button
                type="button"
                disabled={!target || busy || status.data?.restrictedMode}
                onClick={() => prepare.mutate({ operation: 'migration-prepare', drive: target })}
              >
                {prepare.isPending ? '正在验证并准备完整 MSI…' : '准备迁移方案'}
              </button>
              {prepare.data && (
                <div className="setup-install-confirm">
                  <div className="setup-detail">
                    <span>
                      应用：{prepare.data.oldApplication} → {prepare.data.newApplication}
                    </span>
                    <span>
                      数据：{prepare.data.oldData} → {prepare.data.newData}
                    </span>
                    <span>恢复包与日志：{prepare.data.recoveryDirectory}</span>
                  </div>
                  <p className="setup-note">
                    需下载与当前版本完全一致的签名发布包。复制和逐文件校验完成后才卸载；重装或新位置启动失败会尝试恢复原安装。若自动恢复失败，可用恢复目录内完整
                    MSI 和说明手动恢复，原数据不会提前删除。
                  </p>
                  <Consent checked={consent} onChange={setConsent}>
                    我已核对迁移路径并保存工作，确认退出臻境，由 Windows Installer 完成此次迁移。
                  </Consent>
                  <Consent checked={cleanup} onChange={setCleanup}>
                    新位置启动验证通过后，清理旧目录中已复制且哈希未变化的应用数据；新增或变化的文件继续保留。
                  </Consent>
                  <label>
                    输入“迁移臻境”以确认
                    <input
                      type="text"
                      maxLength={20}
                      value={confirmation}
                      onChange={(event) => setConfirmation(event.target.value)}
                      autoComplete="off"
                    />
                  </label>
                  <button
                    type="button"
                    className="setup-primary"
                    disabled={
                      !consent || confirmation !== '迁移臻境' || busy || status.data?.restrictedMode
                    }
                    onClick={() =>
                      apply.mutate({
                        operation: 'migration-apply',
                        token: prepare.data.token,
                        confirmation: '迁移臻境',
                        cleanupSource: cleanup,
                        consent: true,
                      })
                    }
                  >
                    确认迁移并重新启动
                  </button>
                </div>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => recovery.mutate({ operation: 'migration-recovery' })}
              >
                打开迁移恢复目录
              </button>
            </>
          ) : (
            <p>应用已在非系统盘，无需迁移。</p>
          )}
        </>
      )}
    </>
  );
}
