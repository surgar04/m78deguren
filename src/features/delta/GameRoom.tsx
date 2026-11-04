import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  faChartLine,
  faCrosshairs,
  faDice,
  faGear,
  faLink,
  faUserGroup,
  faWindowMinimize,
  faWindowMaximize,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';
import { Icon } from '@/features/home/components/Icon';
import { Background } from '@/features/settings/Background';
import { desktopWindowLabel, isDesktop, controlWindow } from '@/lib/desktop';
import { ACCENTS, usePreferences } from '@/stores/preferences';
import { useSettingsUi } from '@/features/settings/ui-store';
import { useGameRoom, useDeltaQuery, useDeltaAction } from './repository';
import { hardwareSnapshotSchema } from '@/lib/hardware-contracts';
import { DeltaFeedback, DeltaImage } from './components';
import type { GameRoomPreferences } from '@/lib/game-room-contracts';
import './delta.css';

const links = [
  ['/delta-force', '专区工具', faCrosshairs],
  ['/delta-force/stats', '战绩统计', faChartLine],
  ['/delta-force/random-equipment', '随机装备', faDice],
  ['/delta-force/streamers', '主播配置', faUserGroup],
  ['/delta-force/other-platforms', '改枪码平台', faLink],
] as const;
const telemetrySchema = hardwareSnapshotSchema.pick({
  status: true,
  capturedAt: true,
  metrics: true,
  gpus: true,
  samples: true,
  fps: true,
  warnings: true,
});
function reading(value: number | null | undefined, suffix = '', digits = 0) {
  return value == null ? '—' : `${value.toFixed(digits)}${suffix}`;
}
/** 共享历史绘制为 SVG：不额外维护逐秒 React 状态，不在读数缺失时补零或连成虚假曲线。 */
function Curve({
  values,
  color,
  max = 100,
}: {
  values: (number | null | undefined)[];
  color: string;
  max?: number;
}) {
  const paths: string[] = [];
  let current = '';
  values.slice(-60).forEach((value, index) => {
    if (value == null) {
      if (current) paths.push(current);
      current = '';
      return;
    }
    current += `${current ? ' L' : 'M'}${(index / Math.max(1, Math.min(values.length, 60) - 1)) * 800},${100 - (Math.min(max, Math.max(0, value)) / max) * 92}`;
  });
  if (current) paths.push(current);
  return (
    <>
      {paths.map((path, index) => (
        <path
          key={index}
          d={path}
          fill="none"
          stroke={color}
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </>
  );
}
function Telemetry() {
  const room = useGameRoom();
  const query = useDeltaQuery({ operation: 'telemetry' }, telemetrySchema, 1000);
  const [selectedGpu, setSelectedGpu] = useState('');
  const data = query.data;
  const gpu = data?.gpus.find((card) => card.id === selectedGpu) ?? data?.gpus[0];
  const currentFps = data?.fps.processId === room.data?.session.pid ? data?.fps : undefined;
  const samples = data?.samples ?? [];
  // 帧率曲线按实际读数扩展刻度，避免高刷游戏被固定 240 FPS 上限裁平。
  const fpsMaximum = Math.max(
    120,
    ...samples.map((row) =>
      row.fps.processId === room.data?.session.pid ? Math.ceil((row.fps.fps ?? 0) / 60) * 60 : 0,
    ),
  );
  const metrics = data?.metrics;
  const download = metrics?.['download'];
  const upload = metrics?.['upload'];
  const networkMaximum = Math.max(
    1,
    ...samples.flatMap((row) => [row.metrics['download'] ?? 0, row.metrics['upload'] ?? 0]),
  );
  const age =
    room.data?.session.startedAt && room.data.session.pid > 0
      ? Math.max(
          0,
          ((room.data.session.endedAt ?? room.dataUpdatedAt) - room.data.session.startedAt) / 60000,
        )
      : null;
  return (
    <section className="delta-panel delta-telemetry" aria-label="实时游戏性能">
      <div className="delta-section-heading">
        <h2>
          <Icon icon={faChartLine} /> 实时性能
        </h2>
        <span>
          {data?.capturedAt ? new Date(data.capturedAt).toLocaleTimeString() : '等待真实采样'} · 1
          秒刷新
        </span>
        {(data?.gpus.length ?? 0) > 1 && (
          <select
            aria-label="监测显卡"
            value={gpu?.id}
            onChange={(event) => setSelectedGpu(event.target.value)}
          >
            {data?.gpus.map((card) => (
              <option key={card.id} value={card.id}>
                {card.name}
              </option>
            ))}
          </select>
        )}
      </div>
      <DeltaFeedback error={query.error} />
      <div className="delta-metrics">
        {[
          ['FPS', reading(currentFps?.fps)],
          ['1% LOW', reading(currentFps?.low1)],
          ['0.1% LOW', reading(currentFps?.low01)],
          [
            'CPU / 温度',
            `${reading(metrics?.['cpu'], '%')} · ${reading(metrics?.['cpuTemperature'], ' °C')}`,
          ],
          [
            'GPU / 温度',
            `${reading(gpu?.metrics['gpu'], '%')} · ${reading(gpu?.metrics['gpuTemperature'], ' °C')}`,
          ],
          [
            '显存',
            `${reading(gpu?.metrics['vramUsed'], '', 1)} / ${reading(gpu?.metrics['vramTotal'], ' GB', 1)}`,
          ],
          [
            '内存',
            `${reading(metrics?.['memoryUsed'], '', 1)} / ${reading(metrics?.['memoryTotal'], ' GB', 1)}`,
          ],
          ['下载 / 上传', `${reading(download, '', 2)} / ${reading(upload, ' MB/s', 2)}`],
          ['本次游戏', age === null ? '—' : `${Math.floor(age)} 分钟`],
        ].map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <div className="delta-chart">
        <div className="delta-chart-legend">
          <span>● CPU</span>
          <span>● GPU</span>
          <span>● 内存</span>
          <span>● FPS</span>
        </div>
        <svg
          viewBox="0 0 800 110"
          role="img"
          aria-label="最近60个真实样本的性能曲线"
          preserveAspectRatio="none"
        >
          <path d="M0 10H800M0 55H800M0 100H800" stroke="currentColor" opacity=".1" />
          <Curve values={samples.map((row) => row.metrics['cpu'])} color="#10b89a" />
          <Curve
            values={samples.map(
              (row) => row.gpus.find((card) => card.id === gpu?.id)?.metrics['gpu'],
            )}
            color="#4989e8"
          />
          <Curve values={samples.map((row) => row.metrics['memory'])} color="#9684df" />
          <Curve
            values={samples.map((row) =>
              row.fps.processId === room.data?.session.pid ? row.fps.fps : null,
            )}
            color="#e7a553"
            max={fpsMaximum}
          />
        </svg>
        <div className="delta-chart-labels">
          <span>最近 60 个样本 · 占用 0–100% / FPS 0–{fpsMaximum}</span>
          <span>现在</span>
        </div>
      </div>
      <p className="delta-caption">
        {currentFps?.message ?? '帧率仅来自目标游戏的 ETW Present 事件；尚未采到足够帧时显示“—”。'}{' '}
        网络为系统网卡吞吐变化，不能等同游戏服务器延迟或丢包。
      </p>
      <details>
        <summary>网络吞吐波动 · 下载 / 上传</summary>
        <div className="delta-chart">
          <svg
            viewBox="0 0 800 110"
            role="img"
            aria-label="最近60个真实样本的下载上传曲线"
            preserveAspectRatio="none"
          >
            <Curve
              values={samples.map((row) => row.metrics['download'])}
              color="#10b89a"
              max={networkMaximum}
            />
            <Curve
              values={samples.map((row) => row.metrics['upload'])}
              color="#4989e8"
              max={networkMaximum}
            />
          </svg>
          <p className="delta-caption">
            下载为薄荷色，上传为蓝色，纵轴 0–{networkMaximum.toFixed(2)} MB/s。游戏内
            RTT、抖动与丢包未取得可靠数据，不用吞吐读数替代。
          </p>
        </div>
      </details>
      {!!data?.warnings.length && (
        <details>
          <summary>传感器状态与诊断</summary>
          {data.warnings.map((item) => (
            <p key={item}>{item}</p>
          ))}
        </details>
      )}
    </section>
  );
}
export default function GameRoom() {
  const query = useGameRoom();
  const action = useDeltaAction();
  const [settings, setSettings] = useState(false);
  const room = query.data;
  const account = room?.account;
  const prefs = room?.preferences;
  const delta = room?.session.gameId !== 'game';
  const configure = (patch: Partial<GameRoomPreferences>) => {
    if (prefs) action.mutate({ operation: 'configure', preferences: { ...prefs, ...patch } });
  };
  const native = isDesktop() && desktopWindowLabel() === 'game-room';
  const accent = usePreferences((state) => state.accent);
  const theme = useSettingsUi((state) => state.theme);
  const accentColor = ACCENTS.find((item) => item.id === accent)?.color ?? '#7de1cf';
  return (
    <div className="delta-room" data-theme={theme}>
      <Background accent={accentColor} />
      <main className="delta-shell" id="main-content">
        <header className="delta-panel delta-header" data-tauri-drag-region>
          <div className="delta-game-brand">
            <span className="delta-game-logo">
              {delta ? (
                <img src="/assets/delta/logo.png" alt="三角洲行动" />
              ) : (
                <Icon icon={faCrosshairs} />
              )}
            </span>
            <div>
              <span className="delta-eyebrow">ZHENJING / GAME SPACE</span>
              <h1>{room?.session.name || '三角洲行动'}</h1>
              <p>
                <span className={`delta-dot ${room?.session.running ? 'running' : ''}`} />
                {room?.session.running
                  ? '游戏运行中'
                  : room?.session.message || '三角洲专区 · 等待游戏启动'}
              </p>
            </div>
          </div>
          {delta && (
            <div className="delta-role">
              <DeltaImage src={account?.avatar} alt="三角洲角色头像" />
              <div>
                <strong>{account?.nickname || '连接你的三角洲角色'}</strong>
                <p>
                  {account?.nickname
                    ? `等级 ${account.level || '—'} · ${account.phase === 'connected' ? '已验证 WeGame 数据源' : '本机缓存，需刷新验证'}`
                    : 'QQ / 微信官方扫码后显示昵称、头像和等级'}
                </p>
                <button
                  disabled={!isDesktop() || action.isPending}
                  onClick={() => action.mutate({ operation: 'auth-open' })}
                >
                  {account?.phase === 'authorizing' ? '重新显示授权窗口' : '扫码连接'}
                </button>
              </div>
            </div>
          )}
          <div className="delta-window-actions">
            <button aria-label="游戏空间设置" onClick={() => setSettings((value) => !value)}>
              <Icon icon={faGear} />
            </button>
            {native && (
              <>
                <button
                  aria-label="最小化游戏空间"
                  onClick={() => {
                    void controlWindow('minimize');
                  }}
                >
                  <Icon icon={faWindowMinimize} />
                </button>
                <button
                  aria-label="最大化或还原游戏空间"
                  onClick={() => {
                    void controlWindow('maximize');
                  }}
                >
                  <Icon icon={faWindowMaximize} />
                </button>
                <button
                  aria-label="关闭游戏空间"
                  onClick={() => {
                    void controlWindow('close');
                  }}
                >
                  <Icon icon={faXmark} />
                </button>
              </>
            )}
          </div>
        </header>
        <DeltaFeedback
          error={
            query.error ??
            action.error ??
            (account?.phase === 'error' ? new Error(account.message) : undefined)
          }
          notice={[account?.message, room?.session.message, room?.protectionMessage, action.notice]
            .filter(Boolean)
            .join(' · ')}
        />
        {!isDesktop() && (
          <p className="delta-notice">
            请在臻境桌面应用内使用进程识别、传感器及扫码授权；预览中不生成模拟战绩。
          </p>
        )}
        {settings && (
          <section className="delta-panel delta-preferences">
            <h2>游戏空间设置</h2>
            {(
              [
                ['autoOpen', '游戏启动时自动显示独立页面'],
                ['alwaysOnTop', '游戏空间置顶显示'],
                ['blockStickyKeys', '游戏运行时自动屏蔽粘滞键，退出后恢复'],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                <input
                  type="checkbox"
                  disabled={!prefs || action.isPending}
                  checked={prefs?.[key] ?? true}
                  onChange={(event) => configure({ [key]: event.target.checked })}
                />
                {label}
              </label>
            ))}
            <button
              disabled={!prefs || action.isPending}
              onClick={() => {
                if (window.confirm('恢复臻境保存的原粘滞键设置，并关闭自动保护？'))
                  action.mutate({ operation: 'sticky-restore', consent: true });
              }}
            >
              恢复原粘滞键设置
            </button>
            <p className="delta-caption">
              保护通过 Windows
              原生通知告知；不修改游戏文件、不注入游戏。异常退出由独立看门狗恢复，恢复记录保留在本机档案中。
            </p>
          </section>
        )}
        <Telemetry />
        {delta ? (
          <section className="delta-panel delta-tools">
            <nav aria-label="三角洲专区">
              {links.map(([to, label, icon]) => (
                <NavLink key={to} to={to} end={to === '/delta-force'}>
                  <Icon icon={icon} />
                  {label}
                </NavLink>
              ))}
            </nav>
            <div className="delta-tool-content">
              <Outlet />
            </div>
          </section>
        ) : (
          <section className="delta-panel delta-tools">
            <div className="delta-empty">
              当前游戏暂无专属工具专区，实时性能与粘滞键保护仍可使用。
            </div>
          </section>
        )}
        <footer className="delta-footer">
          臻境游戏空间 · 官方战绩 / 社区资料分开标注 · 关闭此页不退出游戏
        </footer>
      </main>
    </div>
  );
}
