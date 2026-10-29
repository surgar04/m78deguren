import { useHardwareSnapshot } from '@/features/hardware/repository';
import { RawSensors } from '@/features/hardware/RawSensors';
import { errorMessage } from '@/lib/desktop';
import '@/features/hardware/hardware.css';
import '@/features/hardware/hardware-live.css';

/** 独立只读窗口，与主窗口共享 Rust 采样，不初始化首页或第二个驱动进程。 */
export default function SensorMonitor() {
  const query = useHardwareSnapshot();
  return (
    <main id="main-content" className="sensor-monitor-window" tabIndex={-1}>
      <header>
        <h1>原始传感器</h1>
        <p>
          LibreHardwareMonitor · 每秒刷新 ·{' '}
          {query.data?.capturedAt
            ? new Date(query.data.capturedAt).toLocaleTimeString('zh-CN')
            : '等待真实采样'}
        </p>
      </header>
      {query.error && <p role="alert">{errorMessage(query.error)}</p>}
      {query.data?.warnings.map((warning, index) => (
        <p className="hw-live-note" key={index}>
          {warning}
        </p>
      ))}
      <RawSensors
        sensors={
          query.error
            ? (query.data?.sensors.map((sensor) => ({ ...sensor, value: null })) ?? [])
            : (query.data?.sensors ?? [])
        }
      />
    </main>
  );
}
