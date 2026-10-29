import { useState } from 'react';
import { z } from 'zod';
import { useHardwareAction, useHardwareRemote } from './repository';
import { hardwareRemoteSchema } from '@/lib/hardware-contracts';
import { errorMessage } from '@/lib/desktop';

export function RemoteMonitor() {
  const query = useHardwareRemote(true),
    starter = useHardwareAction(hardwareRemoteSchema),
    stopper = useHardwareAction(z.null());
  const [address, setAddress] = useState(''),
    [consent, setConsent] = useState(false),
    [notice, setNotice] = useState('');
  const info = query.data;
  return (
    <div className="hw-remote">
      <p>
        电脑与手机连接同一局域网。默认关闭；每次开启生成独立访问链接，停止后立即撤销，最长有效 8
        小时。
      </p>
      {info?.enabled && info.url ? (
        <>
          <p className="hw-live-note">
            服务已开启 · {info.expiresAt ? new Date(info.expiresAt).toLocaleString('zh-CN') : ''}{' '}
            到期
          </p>
          {info.qrSvg && (
            <img
              className="hw-remote-qr"
              width={220}
              height={220}
              alt="手机远程监控访问二维码"
              src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(info.qrSvg)}`}
            />
          )}
          <label>
            手机访问链接
            <input readOnly value={info.url} onFocus={(event) => event.target.select()} />
          </label>
          <button
            type="button"
            onClick={() => {
              if (!info.url) return;
              void navigator.clipboard.writeText(info.url).then(
                () => setNotice('访问链接已复制。'),
                () => setNotice('请手动复制上方完整链接。'),
              );
            }}
          >
            复制链接
          </button>
          <button
            type="button"
            disabled={stopper.isPending}
            onClick={() => stopper.mutate({ operation: 'remote-stop' })}
          >
            停止远程监控并撤销链接
          </button>
        </>
      ) : (
        <>
          <label>
            本机局域网网卡
            <select
              aria-label="远程监控网卡"
              value={info?.addresses.includes(address) ? address : (info?.addresses[0] ?? '')}
              onChange={(event) => setAddress(event.target.value)}
            >
              {info?.addresses.map((address) => (
                <option key={address}>{address}</option>
              ))}
            </select>
          </label>
          {!info?.addresses.length && (
            <p>尚未检测到私有 IPv4 地址，请连接局域网并等待硬件信息返回。</p>
          )}
          <label className="hw-consent">
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
            />
            允许在所选局域网网卡开放带访问凭证的只读监控
          </label>
          <button
            type="button"
            className="mint-button"
            disabled={!consent || !info?.addresses.length || starter.isPending}
            onClick={() =>
              starter.mutate({
                operation: 'remote-start',
                address: info?.addresses.includes(address) ? address : (info?.addresses[0] ?? ''),
                consent: true,
              })
            }
          >
            {starter.isPending ? '正在开启…' : '开启手机监控'}
          </button>
        </>
      )}
      <p className="hw-live-note">
        访问链接包含凭证，请仅分享给可信设备。若手机无法连接，请检查 Wi-Fi 隔离和 Windows
        防火墙；应用不会自动修改防火墙规则。
      </p>
      {(notice || query.error || starter.error || stopper.error) && (
        <p role="status">{notice || errorMessage(query.error ?? starter.error ?? stopper.error)}</p>
      )}
    </div>
  );
}
