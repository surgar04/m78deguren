import {
  faMicrochip,
  faMemory,
  faTableCellsLarge,
  faHardDrive,
} from '@fortawesome/free-solid-svg-icons';
import { faWindows } from '@fortawesome/free-brands-svg-icons';
import { Icon } from '@/features/home/components/Icon';
import type { HardwareSnapshot } from './types';
import { numberText } from './model';

/** 型号允许自然换行，不以省略号隐藏完整硬件名称；磁盘使用真实比例meter。 */
export function DeviceInformation({ data }: { data: HardwareSnapshot }) {
  const { processor, graphics, memoryInfo, disk } = data;
  return (
    <section className="hw-device glass" aria-labelledby="hw-device-title">
      <h2 id="hw-device-title">设备信息</h2>
      <dl>
        <div className="hw-spec-row">
          <dt>
            <Icon icon={faMicrochip} />
            CPU
          </dt>
          <dd>
            {processor?.model ?? '—'}
            {processor && (
              <small>
                {numberText(processor.cores, '', 0)}核心 {numberText(processor.threads, '', 0)}线程
              </small>
            )}
          </dd>
        </div>
        <div className="hw-spec-row">
          <dt>
            <Icon icon={faMicrochip} />
            GPU
          </dt>
          <dd>
            {graphics?.model ?? '—'}
            {graphics && (
              <small>
                {numberText(graphics.vramTotalGB, ' GB')} {graphics.memoryType}
              </small>
            )}
          </dd>
        </div>
        <div className="hw-spec-row">
          <dt>
            <Icon icon={faMemory} />
            内存
          </dt>
          <dd>
            {memoryInfo
              ? `${numberText(data.memoryTotal)} GB ${memoryInfo.kind} ${numberText(memoryInfo.speedMTs, ' MT/s', 0)}`
              : '—'}
          </dd>
        </div>
        <div className="hw-spec-row">
          <dt>
            <Icon icon={faTableCellsLarge} />
            主板
          </dt>
          <dd>{data.motherboard ?? '—'}</dd>
        </div>
        <div className="hw-spec-row hw-disk-row">
          <dt>
            <Icon icon={faHardDrive} />
            磁盘
          </dt>
          <dd>
            {disk ? (
              <>
                {disk.label} ({disk.kind}{' '}
                {disk.totalGB >= 1000 ? `${disk.totalGB / 1000} TB` : `${disk.totalGB} GB`})
                <div className="hw-disk-space">
                  <meter
                    aria-label={`${disk.label}已用空间`}
                    min={0}
                    max={disk.totalGB}
                    value={disk.usedGB}
                  />
                  <small>
                    {disk.usedGB} GB /{' '}
                    {disk.totalGB >= 1000 ? `${disk.totalGB / 1000} TB` : `${disk.totalGB} GB`}
                  </small>
                </div>
              </>
            ) : (
              '—'
            )}
          </dd>
        </div>
        <div className="hw-spec-row">
          <dt>
            <Icon icon={faWindows} />
            操作系统
          </dt>
          <dd>{data.operatingSystem ?? '—'}</dd>
        </div>
      </dl>
    </section>
  );
}
