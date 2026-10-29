import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { executeSetup } from '@/lib/desktop';
import { setupDriversSchema, setupJobSchema } from '@/lib/onboarding-contracts';
import { hardwareDeviceSchema } from '@/lib/hardware-contracts';
import { Failure, Consent } from './controls';
import { useSetupAction } from './repository';

export function HardwareStep() {
  const action = useQuery({
    queryKey: ['onboarding', 'hardware'],
    queryFn: () => executeSetup({ operation: 'hardware' }, z.array(hardwareDeviceSchema)),
    retry: false,
    staleTime: 300000,
  });
  return (
    <>
      <p className="setup-lead">检测 CPU、显卡、内存、主板、磁盘和其他设备，并保存本机硬件档案。</p>
      <button
        type="button"
        className="setup-primary"
        disabled={action.isPending}
        onClick={() => {
          void action.refetch();
        }}
      >
        {action.isPending ? '正在读取真实硬件…' : '检测并保存硬件信息'}
      </button>
      <Failure error={action.error} />
      {action.data && (
        <ul className="setup-device-list">
          {action.data.map((device) => (
            <li key={device.id}>
              <span>{device.kind.toUpperCase()}</span>
              <strong>{device.name.trim() || '设备未提供型号'}</strong>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
export function DriverStep() {
  const recovery = useSetupAction(z.null());
  const scan = useQuery({
      queryKey: ['onboarding', 'drivers'],
      queryFn: () => executeSetup({ operation: 'drivers' }, setupDriversSchema),
      retry: false,
      staleTime: 300000,
    }),
    install = useSetupAction(setupJobSchema),
    [accepted, setAccepted] = useState(false);
  return (
    <>
      <p className="setup-lead">按实际显卡和 OEM 硬件匹配检查兼容驱动。</p>
      <button
        type="button"
        disabled={scan.isPending || install.isPending}
        onClick={() => {
          void scan.refetch();
        }}
      >
        {scan.isPending ? '正在连接 Windows Update…' : '检查显卡与驱动更新'}
      </button>
      <button
        type="button"
        disabled={recovery.isPending}
        onClick={() => recovery.mutate({ operation: 'driver-recovery' })}
      >
        打开设备管理器 · 驱动回退入口
      </button>
      <Failure error={scan.error ?? install.error ?? recovery.error} />
      <button
        type="button"
        disabled={recovery.isPending}
        onClick={() => recovery.mutate({ operation: 'driver-backups' })}
      >
        打开旧驱动备份目录
      </button>
      {scan.data && (
        <>
          <ul className="setup-device-list">
            {scan.data.gpus.map((gpu) => (
              <li key={gpu.pnpId}>
                <strong>{gpu.name}</strong>
                <span>
                  {gpu.vendor} · 当前 {gpu.version}
                </span>
              </li>
            ))}
          </ul>
          <p>{scan.data.source}</p>
          {!scan.data.checked ? (
            <p role="alert">{scan.data.message}</p>
          ) : scan.data.updates.length === 0 ? (
            <p>此通道没有提供适用于本机的新显卡驱动。</p>
          ) : (
            <>
              <Consent checked={accepted} onChange={setAccepted}>
                我同意所选驱动的许可并确认更新；安装可能黑屏或要求重启。失败时可从设备管理器的“驱动程序
                → 回退驱动程序”恢复；没有旧驱动时需手动安装厂商版本。
              </Consent>
              {scan.data.updates.map((update) => (
                <article className="setup-detail" key={update.id}>
                  <strong>{update.title}</strong>
                  <span>
                    {update.model} · {update.manufacturer}
                  </span>
                  <button
                    type="button"
                    disabled={!accepted || install.isPending}
                    onClick={() =>
                      install.mutate(
                        { operation: 'driver-apply', id: update.id, consent: true },
                        {
                          onSuccess: () => {
                            setAccepted(false);
                            void scan.refetch();
                          },
                        },
                      )
                    }
                  >
                    下载并更新此驱动
                  </button>
                </article>
              ))}
            </>
          )}
        </>
      )}
    </>
  );
}
