import { useMemo, useState } from 'react';
import type { HardwareSensor } from '@/lib/hardware-contracts';
import { numberText } from './model';

/** 展开状态属于界面；读数和 min/max 全部来自同一份 Rust 快照，隐藏组不渲染大量表格行。 */
export function RawSensors({ sensors }: { sensors: readonly HardwareSensor[] }) {
  const [search, setSearch] = useState(''),
    [hardwareType, setHardwareType] = useState('all'),
    [sensorType, setSensorType] = useState('all');
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const hardwareTypes = [...new Set(sensors.map((sensor) => sensor.hardwareType))].sort();
  const sensorTypes = [...new Set(sensors.map((sensor) => sensor.sensorType))].sort();
  const groups = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    const groups = new Map<string, HardwareSensor[]>();
    for (const sensor of sensors) {
      if (
        (hardwareType !== 'all' && sensor.hardwareType !== hardwareType) ||
        (sensorType !== 'all' && sensor.sensorType !== sensorType) ||
        (query && !`${sensor.hardware} ${sensor.name}`.toLocaleLowerCase().includes(query))
      )
        continue;
      const group = groups.get(sensor.hardwareId) ?? [];
      group.push(sensor);
      groups.set(sensor.hardwareId, group);
    }
    return [...groups];
  }, [sensors, search, hardwareType, sensorType]);
  return (
    <section className="hw-raw">
      <div className="hw-live-toolbar">
        <input
          type="search"
          aria-label="搜索硬件或传感器名称"
          placeholder="搜索硬件或传感器名称…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select
          aria-label="硬件类型筛选"
          value={hardwareType}
          onChange={(event) => setHardwareType(event.target.value)}
        >
          <option value="all">全部硬件类型</option>
          {hardwareTypes.map((type) => (
            <option key={type}>{type}</option>
          ))}
        </select>
        <select
          aria-label="传感器类型筛选"
          value={sensorType}
          onChange={(event) => setSensorType(event.target.value)}
        >
          <option value="all">全部传感器类型</option>
          {sensorTypes.map((type) => (
            <option key={type}>{type}</option>
          ))}
        </select>
        <button type="button" onClick={() => setExpanded(new Set(groups.map(([id]) => id)))}>
          全部展开
        </button>
        <button type="button" onClick={() => setExpanded(new Set())}>
          全部收起
        </button>
      </div>
      <p className="hw-live-note">
        {groups.length} 组硬件 · {groups.reduce((count, [, rows]) => count + rows.length, 0)}{' '}
        个传感器 · 缺失读数显示“—”
      </p>
      {groups.map(([id, rows]) => (
        <div className="hw-sensor-group" key={id}>
          <button
            className="hw-group-heading"
            type="button"
            aria-expanded={expanded.has(id)}
            onClick={() =>
              setExpanded((current) => {
                const next = new Set(current);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              })
            }
          >
            <span>
              {expanded.has(id) ? '▾' : '▸'} {rows[0]?.hardware}{' '}
              <small>{rows[0]?.hardwareType}</small>
            </span>
            <span>{rows.length} 项</span>
          </button>
          {expanded.has(id) && (
            <div className="hw-sensor-scroll">
              <table className="hw-sensors">
                <thead>
                  <tr>
                    <th>传感器</th>
                    <th>类型</th>
                    <th>当前读数</th>
                    <th>最低</th>
                    <th>最高</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((sensor) => (
                    <tr key={sensor.id}>
                      <th scope="row">{sensor.name}</th>
                      <td>{sensor.sensorType}</td>
                      <td>{numberText(sensor.value, ` ${sensor.unit}`, 2)}</td>
                      <td>{numberText(sensor.min, ` ${sensor.unit}`, 2)}</td>
                      <td>{numberText(sensor.max, ` ${sensor.unit}`, 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
      {groups.length === 0 && (
        <p className="hw-live-note">
          没有匹配的传感器。若尚未完成首次采样，请稍候；不支持的底层传感器需要在设置中检查 PawnIO
          状态。
        </p>
      )}
    </section>
  );
}
