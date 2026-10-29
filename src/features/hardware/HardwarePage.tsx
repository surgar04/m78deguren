import { useState } from 'react';
import { z } from 'zod';
import { Link } from 'react-router-dom';
import {
  faChartPie,
  faFileLines,
  faWaveSquare,
  faArrowUpFromBracket,
  faChartColumn,
  faCopy,
  faTrashCan,
  faMobileScreenButton,
  faRotateRight,
} from '@fortawesome/free-solid-svg-icons';
import { WorkspaceLayout } from '@/features/home/components/WorkspaceLayout';
import { Modal } from '@/features/home/components/Modal';
import { Icon } from '@/features/home/components/Icon';
import { useGameWorkspace } from '@/features/home/useGameWorkspace';
import { MetricCards } from './MetricCards';
import { DeviceInformation } from './DeviceInformation';
import { PerformanceChart } from './PerformanceChart';
import { RawSensors } from './RawSensors';
import { DeviceDetails } from './DeviceDetails';
import { useHardwareAction, useHardwareSnapshot } from './repository';
import { toHardwareSummary } from './live-model';
import { numberText } from './model';
import { RemoteMonitor } from './RemoteMonitor';
import { hardwareReceiptSchema } from '@/lib/hardware-contracts';
import { executeHardware, errorMessage, isDesktop } from '@/lib/desktop';
import './hardware.css';
import './hardware-live.css';

const TABS = [
  { key: 'overview', label: '总览', icon: faChartPie },
  { key: 'devices', label: '设备信息', icon: faFileLines },
  { key: 'monitor', label: '实时监测', icon: faWaveSquare },
] as const;
const STATUS = {
  ready: '实时采集中',
  degraded: '部分指标不可用',
  starting: '正在连接硬件',
  failed: '采样服务异常',
  stale: '采样已过期',
  stopped: '采样未启动',
} as const;

/** 硬件页只查询真实服务；网页没有演示设备、模拟时间或随机曲线。 */
export default function Hardware() {
  const workspace = useGameWorkspace(),
    query = useHardwareSnapshot();
  const [tab, setTab] = useState<'overview' | 'devices' | 'monitor'>('overview'),
    [seconds, setSeconds] = useState(60),
    [gpuId, setGpuId] = useState('');
  const [dialog, setDialog] = useState<'export' | 'clear' | 'privileged' | 'fps' | 'remote' | null>(
      null,
    ),
    [consent, setConsent] = useState(false),
    [notice, setNotice] = useState('');
  const [copyFallback, setCopyFallback] = useState(''),
    [pid, setPid] = useState(''),
    [from, setFrom] = useState(''),
    [to, setTo] = useState('');
  const action = useHardwareAction(z.null()),
    exporter = useHardwareAction(hardwareReceiptSchema),
    opener = useHardwareAction(z.null());
  const live = query.data,
    summary = toHardwareSummary(query.error ? undefined : live, gpuId);
  const open = (kind: typeof dialog) => {
    setConsent(false);
    setNotice('');
    setDialog(kind);
  };
  const fail = (cause: unknown) => setNotice(errorMessage(cause));
  const copy = async () => {
    try {
      const text = await executeHardware({ operation: 'copy' }, z.string().max(2_097_152));
      try {
        await navigator.clipboard.writeText(text);
        setNotice('已复制全部硬件信息及当前传感器读数。');
      } catch {
        setCopyFallback(text);
        setNotice('剪贴板不可用，请在下方文本框手动复制。');
      }
    } catch (cause) {
      fail(cause);
    }
  };
  return (
    <WorkspaceLayout workspace={workspace} active="hardware">
      <main className="hw-main hw-live" id="main-content" tabIndex={-1}>
        <header className="hw-heading" data-home-enter>
          <div className="hw-heading-title">
            <h1>系统与硬件</h1>
            <span className="hw-source-badge">
              {isDesktop()
                ? query.error
                  ? '数据连接异常'
                  : STATUS[live?.status ?? 'starting']
                : '需要桌面端'}
            </span>
          </div>
          <p>了解你的设备，掌握运行状态。</p>
          <p className="hw-date">
            {new Intl.DateTimeFormat('zh-CN', { dateStyle: 'full' }).format(new Date())}
          </p>
          <div className="hw-actions">
            <button
              type="button"
              className="hw-export"
              disabled={!live}
              onClick={() => open('export')}
            >
              <Icon icon={faArrowUpFromBracket} />
              导出 HTML 报告
            </button>
            <button
              type="button"
              className="glass"
              disabled={!isDesktop()}
              onClick={() => opener.mutate({ operation: 'sensors-open' }, { onError: fail })}
            >
              <Icon icon={faChartColumn} />
              传感器详情
            </button>
          </div>
          <div className="hw-tabs glass" role="tablist" aria-label="硬件页面视图">
            {TABS.map((item, index) => (
              <button
                type="button"
                key={item.key}
                id={`hw-tab-${item.key}`}
                role="tab"
                aria-selected={tab === item.key}
                aria-controls="hw-tabpanel"
                tabIndex={tab === item.key ? 0 : -1}
                className={tab === item.key ? 'active' : ''}
                onClick={() => setTab(item.key)}
                onKeyDown={(event) => {
                  const next =
                    event.key === 'ArrowRight'
                      ? (index + 1) % TABS.length
                      : event.key === 'ArrowLeft'
                        ? (index + TABS.length - 1) % TABS.length
                        : event.key === 'Home'
                          ? 0
                          : event.key === 'End'
                            ? TABS.length - 1
                            : null;
                  if (next === null) return;
                  event.preventDefault();
                  const target = TABS[next];
                  if (target) {
                    setTab(target.key);
                    document.getElementById(`hw-tab-${target.key}`)?.focus();
                  }
                }}
              >
                <Icon icon={item.icon} />
                {item.label}
              </button>
            ))}
          </div>
        </header>
        {!isDesktop() && (
          <p className="hw-live-note" role="status">
            硬件型号、传感器、记录及 ETW 需要 Windows 桌面后端。网页不显示模拟读数。
          </p>
        )}
        {(notice || query.error || action.error || exporter.error || opener.error) && (
          <p className="hw-live-feedback" role="status">
            {notice || errorMessage(query.error ?? action.error ?? exporter.error ?? opener.error)}
          </p>
        )}
        {copyFallback && (
          <textarea
            className="hw-copy-fallback"
            aria-label="完整硬件信息"
            readOnly
            rows={8}
            value={copyFallback}
          />
        )}
        <div className="hw-live-toolbar">
          <button
            type="button"
            disabled={!live}
            onClick={() => {
              void copy();
            }}
          >
            <Icon icon={faCopy} />
            复制全部信息
          </button>
          <button
            type="button"
            disabled={!isDesktop() || action.isPending}
            onClick={() =>
              action.mutate(
                { operation: 'restart', privileged: false, consent: false },
                { onError: fail },
              )
            }
          >
            <Icon icon={faRotateRight} />
            重新检测
          </button>
          <button type="button" disabled={!live} onClick={() => open('privileged')}>
            底层传感器
          </button>
          <button type="button" disabled={!live} onClick={() => open('clear')}>
            <Icon icon={faTrashCan} />
            清除记录
          </button>
          <button type="button" disabled={!live} onClick={() => open('remote')}>
            <Icon icon={faMobileScreenButton} />
            手机远程监控
          </button>
          {live && live.gpus.length > 0 && (
            <label>
              显卡
              <select
                aria-label="选择显卡"
                value={live.gpus.some((gpu) => gpu.id === gpuId) ? gpuId : (live.gpus[0]?.id ?? '')}
                onChange={(event) => setGpuId(event.target.value)}
              >
                {live.gpus.map((gpu) => (
                  <option key={gpu.id} value={gpu.id}>
                    {gpu.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {live && (live.warnings.length > 0 || live.recording.error) && (
          <details className="hw-live-warnings">
            <summary>
              采集说明与诊断（{live.warnings.length + (live.recording.error ? 1 : 0)}）
            </summary>
            {live.warnings.map((warning, index) => (
              <p key={index}>{warning}</p>
            ))}
            {live.recording.error && <p>记录服务：{live.recording.error}</p>}
            <Link to="/settings?tab=storage">检查 PawnIO / 高级设置</Link>
          </details>
        )}
        <div id="hw-tabpanel" role="tabpanel" aria-labelledby={`hw-tab-${tab}`} tabIndex={0}>
          <MetricCards data={summary} />
          {tab === 'overview' ? (
            <div className="hw-lower">
              <PerformanceChart data={summary} seconds={seconds} onSecondsChange={setSeconds} />
              <DeviceInformation data={summary} />
            </div>
          ) : tab === 'devices' ? (
            <DeviceDetails devices={live?.devices ?? []} />
          ) : (
            <>
              <PerformanceChart data={summary} seconds={seconds} onSecondsChange={setSeconds} />
              <section className="hw-sensor-panel glass">
                <h2>原始传感器</h2>
                <RawSensors
                  sensors={
                    query.error
                      ? (live?.sensors.map((sensor) => ({ ...sensor, value: null })) ?? [])
                      : (live?.sensors ?? [])
                  }
                />
              </section>
            </>
          )}
        </div>
        <section className="hw-fps-panel glass">
          <div>
            <h2>游戏帧率 · ETW Present</h2>
            <p>{live?.fps.message ?? '未开启 ETW；不会使用前端计时器生成帧率。'}</p>
          </div>
          <dl>
            <div>
              <dt>FPS</dt>
              <dd>{numberText(live?.fps.fps, '', 1)}</dd>
            </div>
            <div>
              <dt>1% Low</dt>
              <dd>{numberText(live?.fps.low1, '', 1)}</dd>
            </div>
            <div>
              <dt>0.1% Low</dt>
              <dd>{numberText(live?.fps.low01, '', 1)}</dd>
            </div>
          </dl>
          <button
            type="button"
            disabled={!live || action.isPending}
            onClick={() =>
              live?.fps.enabled
                ? action.mutate({ operation: 'fps-stop' }, { onError: fail })
                : open('fps')
            }
          >
            {live?.fps.enabled ? '停止 ETW' : '启用 ETW'}
          </button>
        </section>
        <footer className="hw-footer">
          采样间隔约 1 秒 ·{' '}
          {live?.capturedAt
            ? `最近更新 ${new Date(live.capturedAt).toLocaleTimeString('zh-CN')}`
            : '等待真实采样'}{' '}
          · 已记录 {live?.recording.count ?? 0} 条
        </footer>
        {dialog && (
          <Modal
            title={
              {
                export: '导出硬件时序报告',
                clear: '清除硬件记录',
                privileged: '底层传感器读取',
                fps: 'ETW 游戏帧率',
                remote: '手机远程监控',
              }[dialog]
            }
            wide={dialog === 'remote'}
            onClose={() => setDialog(null)}
          >
            {dialog === 'remote' ? (
              <RemoteMonitor />
            ) : dialog === 'export' ? (
              <div className="hw-report-dialog">
                <p>
                  导出独立
                  HTML，包含完整设备信息、实测时序图表、多显卡切换及时间范围筛选。离线可用；范围留空表示全部已保留记录。
                </p>
                <label>
                  开始时间
                  <input
                    type="datetime-local"
                    value={from}
                    onChange={(event) => setFrom(event.target.value)}
                  />
                </label>
                <label>
                  结束时间
                  <input
                    type="datetime-local"
                    value={to}
                    onChange={(event) => setTo(event.target.value)}
                  />
                </label>
                <p>
                  日志保留最近 31 天或至多约 256 MiB；报告上限 60,000 个实测点，超限按原始点降采样。
                </p>
                <button
                  type="button"
                  className="mint-button"
                  disabled={
                    exporter.isPending ||
                    Boolean(
                      (from && !Number.isFinite(new Date(from).getTime())) ||
                      (to && !Number.isFinite(new Date(to).getTime())),
                    )
                  }
                  onClick={() =>
                    exporter.mutate(
                      {
                        operation: 'export',
                        from: from ? new Date(from).getTime() : null,
                        to: to ? new Date(to).getTime() : null,
                      },
                      {
                        onSuccess: (result) => {
                          setNotice(
                            `已导出：${result.path}（${result.totalSamples} 条记录 / ${result.points} 个实测点）`,
                          );
                        },
                        onError: fail,
                      },
                    )
                  }
                >
                  {exporter.isPending ? '正在生成…' : '生成 HTML 报告'}
                </button>
                {exporter.data && (
                  <p className="hw-export-receipt" role="status">
                    保存位置：{exporter.data.path}
                    <br />
                    {exporter.data.points} 个实测点 · {exporter.data.bytes.toLocaleString()} bytes
                  </p>
                )}
                {exporter.error && <p role="alert">{errorMessage(exporter.error)}</p>}
              </div>
            ) : (
              <div className="hw-report-dialog">
                <p>
                  {dialog === 'clear'
                    ? '清除全部硬件时序记录及本次传感器最小/最大值。已导出的 HTML 报告会保留；清除后新采样继续记录，此操作无法直接撤销。'
                    : dialog === 'privileged'
                      ? '只读取已安装 PawnIO 提供的 CPU / 主板底层传感器。需要现有管理员权限；此处不会安装驱动、请求 UAC 或修改系统配置。可随时“重新检测”恢复基础采集。'
                      : '直接在 Rust 进程内监听 ETW Present 事件；留空目标 PID 时跟随前台进程。1% / 0.1% Low 在样本不足时显示“—”。如权限不足会返回真实错误，不会自动提权。'}
                </p>
                {dialog === 'fps' && (
                  <label>
                    目标进程 PID（可选）
                    <input
                      type="number"
                      min={1}
                      max={4294967295}
                      value={pid}
                      onChange={(event) => setPid(event.target.value)}
                    />
                  </label>
                )}
                <label className="hw-consent">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(event) => setConsent(event.target.checked)}
                  />
                  我已了解并确认执行上述操作
                </label>
                <button
                  type="button"
                  className="mint-button"
                  disabled={
                    !consent ||
                    action.isPending ||
                    (dialog === 'fps' &&
                      pid !== '' &&
                      (!Number.isInteger(Number(pid)) ||
                        Number(pid) < 1 ||
                        Number(pid) > 4294967295))
                  }
                  onClick={() => {
                    const request =
                      dialog === 'clear'
                        ? { operation: 'clear' as const, consent: true as const }
                        : dialog === 'privileged'
                          ? { operation: 'restart' as const, privileged: true, consent: true }
                          : {
                              operation: 'fps-start' as const,
                              pid: pid ? Number(pid) : null,
                              consent: true as const,
                            };
                    action.mutate(request, {
                      onSuccess: () => {
                        setDialog(null);
                        setNotice(
                          dialog === 'privileged'
                            ? '已请求重新采集；实际可用性请查看采集诊断。'
                            : '操作完成。',
                        );
                      },
                      onError: fail,
                    });
                  }}
                >
                  {action.isPending ? '处理中…' : '确认执行'}
                </button>
                {action.error && <p role="alert">{errorMessage(action.error)}</p>}
              </div>
            )}
          </Modal>
        )}
      </main>
    </WorkspaceLayout>
  );
}
