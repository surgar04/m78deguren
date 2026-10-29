import { useState } from 'react';
import type { HardwareDevice } from '@/lib/hardware-contracts';
import { DEVICE_KINDS } from './live-model';

export function DeviceDetails({ devices }: { devices: readonly HardwareDevice[] }) {
  const [kind, setKind] = useState('all'),
    [search, setSearch] = useState('');
  const visible = devices.filter(
    (device) =>
      (kind === 'all' || device.kind === kind) &&
      `${device.name} ${device.fields.map((field) => `${field.label} ${field.value}`).join(' ')}`
        .toLocaleLowerCase()
        .includes(search.trim().toLocaleLowerCase()),
  );
  return (
    <section className="hw-live-devices glass">
      <h2>完整设备信息</h2>
      <div className="hw-live-toolbar">
        <input
          type="search"
          aria-label="搜索设备信息"
          placeholder="搜索型号、驱动或规格…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select
          aria-label="设备分类"
          value={kind}
          onChange={(event) => setKind(event.target.value)}
        >
          <option value="all">全部设备</option>
          {Object.entries(DEVICE_KINDS).map(([key, label]) => (
            <option value={key} key={key}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className="hw-device-details-grid">
        {visible.map((device) => (
          <details key={device.id} className="hw-device-detail" open>
            <summary>
              <span>{DEVICE_KINDS[device.kind]}</span>
              {device.name || '系统未返回型号'}
            </summary>
            <dl>
              {device.fields.map((field, index) => (
                <div key={`${field.label}-${index}`}>
                  <dt>{field.label}</dt>
                  <dd>{field.value}</dd>
                </div>
              ))}
            </dl>
          </details>
        ))}
      </div>
      {visible.length === 0 && (
        <p className="hw-live-note">没有匹配设备，或系统尚未返回硬件型号。</p>
      )}
    </section>
  );
}
