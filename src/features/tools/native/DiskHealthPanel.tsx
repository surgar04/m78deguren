import { disksSnapshotSchema } from '@/lib/builtin-contracts';
import { useBuiltinQuery } from './builtin-hooks';
import { SystemChangeReview } from './SystemChangeReview';
import { useSystemChange } from './use-system-change';
import { Feedback } from './Feedback';
import { bytes } from './format';

/** 未返回的 SMART/可靠性指标保持未知；不把通用“OK”翻译成虚构的100%寿命。 */
export function DiskHealthPanel() {
  const query = useBuiltinQuery({ operation: 'query', tool: 'disks' }, disksSnapshotSchema);
  const control = useSystemChange();
  return (
    <div className="native-tool-panel">
      <div className="native-tool-actions">
        <p>磁盘健康与 Windows 可靠性计数器</p>
        <button
          type="button"
          className="native-button"
          disabled={query.isFetching}
          onClick={() => {
            void query.refetch();
          }}
        >
          重新检测
        </button>
      </div>
      <Feedback pending={query.isPending} error={query.error} />
      <SystemChangeReview control={control} />
      {query.data?.disks.map((disk) => (
        <article className="native-device-card" key={disk.id}>
          <div className="native-tool-actions">
            <h4>{disk.name}</h4>
            <span>{disk.health ?? '健康状态不可读'}</span>
          </div>
          <p>
            {bytes(disk.bytes)} · {disk.mediaType} · {disk.interface} · 固件{' '}
            {disk.firmware || '未提供'}
          </p>
          <dl className="native-spec-grid">
            <div>
              <dt>温度</dt>
              <dd>{disk.temperature === null ? '未提供' : `${disk.temperature} °C`}</dd>
            </div>
            <div>
              <dt>通电时间</dt>
              <dd>{disk.powerOnHours === null ? '未提供' : `${disk.powerOnHours} 小时`}</dd>
            </div>
            <div>
              <dt>已用耐久度</dt>
              <dd>{disk.wear === null ? '未提供' : `${disk.wear}%`}</dd>
            </div>
            <div>
              <dt>读 / 写错误</dt>
              <dd>
                {disk.readErrors ?? '—'} / {disk.writeErrors ?? '—'}
              </dd>
            </div>
          </dl>
          {disk.volumes.map((volume) => (
            <div className="native-tool-list-row" key={volume.drive}>
              <div>
                <strong>
                  {volume.drive} {volume.label}
                </strong>
                <p>
                  可用 {bytes(volume.freeBytes)} / {bytes(volume.bytes)}
                </p>
                <progress
                  max={Math.max(1, volume.bytes)}
                  value={Math.max(0, volume.bytes - volume.freeBytes)}
                />
              </div>
              <div className="native-tool-actions">
                <button
                  className="native-button"
                  type="button"
                  disabled={control.busy || disk.mediaType === 'HDD'}
                  onClick={() =>
                    control.prepare({
                      kind: 'disk-optimize',
                      id: disk.id,
                      drive: volume.drive,
                      trim: true,
                    })
                  }
                >
                  TRIM…
                </button>
                {disk.mediaType === 'HDD' && (
                  <button
                    className="native-button"
                    type="button"
                    disabled={control.busy}
                    onClick={() =>
                      control.prepare({
                        kind: 'disk-optimize',
                        id: disk.id,
                        drive: volume.drive,
                        trim: false,
                      })
                    }
                  >
                    碎片整理…
                  </button>
                )}
              </div>
            </div>
          ))}
        </article>
      ))}
      {!query.isPending && !query.data?.disks.length && <p>未检测到可读取的物理磁盘。</p>}
      <p className="native-tool-note">
        部分 USB、RAID 或厂商驱动不提供温度、耐久度等指标。执行卷优化前会确认磁盘与盘符归属。
      </p>
    </div>
  );
}
