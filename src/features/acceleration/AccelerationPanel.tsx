import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  faArrowUpRightFromSquare,
  faCheck,
  faFolderOpen,
  faGamepad,
  faRotateRight,
  faShieldHalved,
  faWifi,
} from '@fortawesome/free-solid-svg-icons';
import { Icon } from '@/features/home/components/Icon';
import { useOtherAction, useOtherGames } from '@/features/quick-launch/repository';
import { z } from 'zod';
import { errorMessage, isDesktop } from '@/lib/desktop';
import { ACCELERATION_PHASES, isPreparationActive } from '@/lib/acceleration-contracts';
import { useAcceleration, useAccelerationAction } from './repository';
import './acceleration.css';

/** 官方客户端协作式准备：人工确认不可由“减少二次确认”偏好跳过。 */
export function AccelerationPanel() {
  const query = useAcceleration(),
    action = useAccelerationAction(),
    games = useOtherGames();
  const launch = useOtherAction(z.null());
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [consentFor, setConsentFor] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const data = query.data,
    session = data?.session,
    client = data?.config.client;
  const active = isPreparationActive(session),
    busy = action.isPending || launch.isPending;
  const eligible = (games.data?.games ?? []).filter(
    (game) => game.available && game.region === 'cn',
  );
  // URL 只带登记 ID，页面刷新也不主动启动软件或游戏。
  const gameId = params.get('game') ?? '';
  const selected = eligible.find((game) => game.id === gameId);
  const fail = (cause: unknown) => setNotice(errorMessage(cause));
  const run: typeof action.mutate = (request) => {
    setNotice('');
    action.mutate(request, { onError: fail });
  };
  return (
    <section className="acceleration-panel native-tool-panel" aria-label="QuickFox 游戏加速准备">
      <div className="acceleration-intro">
        <div className="acceleration-symbol">
          <Icon icon={faWifi} />
        </div>
        <div>
          <span className="acceleration-eyebrow">QUICKFOX · 官方客户端协作</span>
          <h2>准备好线路，再进入游戏</h2>
          <p>适合马来西亚等海外地区游玩国服。国内用户可直接启动，默认不启用加速准备。</p>
        </div>
        <button
          type="button"
          className="native-button"
          disabled={busy || !isDesktop()}
          onClick={() => run({ operation: 'website', kind: 'help' })}
        >
          使用帮助 <Icon icon={faArrowUpRightFromSquare} />
        </button>
      </div>

      {!isDesktop() && <p role="status">请在 Windows 桌面版中检测客户端和游戏。</p>}
      {query.error && (
        <p role="alert" className="acceleration-error">
          {errorMessage(query.error)}
        </p>
      )}
      {games.error && (
        <p role="alert" className="acceleration-error">
          游戏索引读取失败：{errorMessage(games.error)}
        </p>
      )}
      {query.isPending && isDesktop() && <p role="status">正在读取本机客户端状态…</p>}
      {notice && (
        <p role="status" className="acceleration-notice">
          {notice}
        </p>
      )}
      <div className="acceleration-columns">
        <section className="acceleration-card">
          <div className="acceleration-card-title">
            <span className="acceleration-step">01</span>
            <h3>官方客户端</h3>
            <span className={`acceleration-badge ${data?.clientRunning ? 'ready' : ''}`}>
              {data?.clientRunning ? '客户端已运行' : client ? '客户端未运行' : '尚未登记'}
            </span>
          </div>
          <p>首次使用请检测安装位置；没有安装时，前往官网下载 Windows 客户端。</p>
          {client && (
            <div className="acceleration-client">
              <strong>QuickFox {client.version}</strong>
              <span>
                <Icon icon={faShieldHalved} />
                已登记官方签名 · 启动前重新核验
              </span>
              <code title={client.path}>{client.path}</code>
            </div>
          )}
          <div className="acceleration-actions">
            <button
              type="button"
              className="native-button"
              disabled={busy || active || !isDesktop()}
              onClick={() => run({ operation: 'discover' })}
            >
              <Icon icon={faRotateRight} /> 检测安装
            </button>
            <button
              type="button"
              className="native-button"
              disabled={busy || active || !isDesktop()}
              onClick={() => run({ operation: 'choose' })}
            >
              <Icon icon={faFolderOpen} /> 手动定位
            </button>
            <button
              type="button"
              className="native-button"
              disabled={busy || !isDesktop()}
              onClick={() => run({ operation: 'website', kind: 'download' })}
            >
              官网下载 <Icon icon={faArrowUpRightFromSquare} />
            </button>
          </div>
          {data && data.clients.length > 0 && (
            <div className="acceleration-candidates" aria-label="检测到的客户端">
              {data.clients.map((candidate, index) => (
                <button
                  key={candidate.path}
                  type="button"
                  disabled={
                    busy ||
                    active ||
                    (client?.path === candidate.path && client.sha256 === candidate.sha256)
                  }
                  onClick={() =>
                    run({
                      operation: 'select',
                      index,
                      hash: candidate.sha256,
                      revision: data.revision,
                    })
                  }
                >
                  <strong>
                    {client?.path === candidate.path && client.sha256 === candidate.sha256
                      ? '已选择'
                      : '选择此安装'}{' '}
                    · {candidate.version}
                  </strong>
                  <span>{candidate.path}</span>
                </button>
              ))}
            </div>
          )}
          {data && data.clients.length === 0 && !client && (
            <p className="acceleration-hint">
              检测不到时可定位 QuickFox.exe；不会扫描个人文档、账号或密码。
            </p>
          )}
          {data?.warnings.map((warning, index) => (
            <p key={`${index}-${warning}`} role="status">
              {warning}
            </p>
          ))}
          <button
            type="button"
            className="mint-button"
            disabled={busy || !client}
            onClick={() => run({ operation: 'open' })}
          >
            打开 QuickFox
          </button>
        </section>

        <section className="acceleration-card">
          <div className="acceleration-card-title">
            <span className="acceleration-step">02</span>
            <h3>选择国服游戏</h3>
          </div>
          <label className="acceleration-game-label">
            本机已识别的国服实例
            <select
              value={selected?.id ?? ''}
              disabled={busy || active}
              onChange={(event) => {
                setConsentFor(null);
                setNotice('');
                setParams(event.target.value ? { game: event.target.value } : {}, {
                  replace: true,
                });
              }}
            >
              <option value="">请选择游戏</option>
              {eligible.map((game) => (
                <option key={game.id} value={game.id}>
                  {game.name}
                </option>
              ))}
            </select>
          </label>
          {selected ? (
            <p className="acceleration-game-path" title={selected.path}>
              <Icon icon={faGamepad} /> {selected.path}
            </p>
          ) : (
            <p>在“其他游戏”搜索安装位置并确认区服后，这里会显示真实游戏实例。</p>
          )}
          <button
            type="button"
            className="native-button"
            disabled={busy || active}
            onClick={() => {
              void navigate('/library/other');
            }}
          >
            前往其他游戏
          </button>
          <ol className="acceleration-checklist">
            <li>打开 QuickFox，使用各自账号登录。</li>
            <li>选择游戏模式，在官方客户端开启加速。</li>
            <li>回到这里确认，再启动游戏。游戏内观察延迟、抖动和丢包。</li>
          </ol>
          <p className="acceleration-hint">
            免费影音模式不提供游戏加速；会员、地区及具体游戏支持以官方客户端为准。先试用，再决定购买。
          </p>
          <div className="acceleration-actions">
            <button
              type="button"
              className="mint-button"
              disabled={busy || active || !client || !selected || !!games.data?.running}
              onClick={() => {
                if (selected) {
                  setConsentFor(null);
                  run({ operation: 'prepare', gameId: selected.id });
                }
              }}
            >
              开始本次准备
            </button>
            <button
              type="button"
              className="native-button"
              disabled={busy || active || !selected || !!games.data?.running}
              onClick={() => {
                if (selected)
                  launch.mutate(
                    { operation: 'launch', id: selected.id },
                    {
                      onError: fail,
                      onSuccess: () => setNotice('直接启动请求已提交，未进行加速准备。'),
                    },
                  );
              }}
            >
              直接启动游戏
            </button>
          </div>
        </section>
      </div>

      {session && (
        <section className={`acceleration-session phase-${session.phase}`} aria-live="polite">
          <div className="acceleration-card-title">
            <span className="acceleration-step">03</span>
            <h3>{session.gameName}</h3>
            <span className="acceleration-badge">{ACCELERATION_PHASES[session.phase]}</span>
          </div>
          <p>{session.message}</p>
          {session.confirmedAt !== null && (
            <p className="acceleration-hint">
              人工确认于 {new Date(session.confirmedAt * 1000).toLocaleTimeString()} ·
              仅适用于本次启动
            </p>
          )}
          {session.phase === 'waiting' && (
            <>
              <label className="acceleration-consent">
                <input
                  type="checkbox"
                  disabled={busy || !data?.clientRunning}
                  checked={consentFor === session.id}
                  onChange={(event) => setConsentFor(event.target.checked ? session.id : null)}
                />
                <span>我已在 QuickFox 内启用游戏模式并开始加速，确认现在启动此游戏。</span>
              </label>
              <div className="acceleration-actions">
                <button
                  type="button"
                  className="mint-button"
                  disabled={busy || consentFor !== session.id || !data?.clientRunning}
                  onClick={() => {
                    setConsentFor(null);
                    run({ operation: 'confirm', id: session.id, consent: true });
                  }}
                >
                  <Icon icon={faCheck} /> 确认本次启动
                </button>
                <button
                  type="button"
                  className="native-button"
                  disabled={busy}
                  onClick={() => {
                    setConsentFor(null);
                    run({ operation: 'cancel', id: session.id });
                  }}
                >
                  取消准备
                </button>
              </div>
            </>
          )}
          {(session.phase === 'launch-requested' || session.phase === 'playing') && (
            <button
              type="button"
              className="native-button"
              disabled={busy}
              onClick={() => run({ operation: 'stop-tracking', id: session.id })}
            >
              停止本次跟踪（不关闭游戏或加速器）
            </button>
          )}
          {(session.phase === 'finished' ||
            session.phase === 'failed' ||
            session.phase === 'cancelled') && (
            <button
              type="button"
              className="native-button"
              disabled={busy || !client}
              onClick={() => run({ operation: 'open' })}
            >
              回到 QuickFox 检查／断开
            </button>
          )}
        </section>
      )}

      <footer className="acceleration-footer">
        <label>
          <input
            type="checkbox"
            checked={data?.config.remindOnExit ?? true}
            disabled={busy || !data}
            onChange={(event) => {
              if (data)
                run({
                  operation: 'remind',
                  enabled: event.target.checked,
                  revision: data.revision,
                });
            }}
          />{' '}
          游戏结束或客户端退出时，在臻境内提醒检查加速
        </label>
        <p>
          臻境不保存厂商账号，不自动购买、不共享登录信息、不重置系统网络。进程状态和人工确认不代表加速成功；实际效果须在马来西亚网络及游戏内验证。
        </p>
      </footer>
    </section>
  );
}
