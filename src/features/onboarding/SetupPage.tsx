import { useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCheck, faMinus, faXmark } from '@fortawesome/free-solid-svg-icons';
import { Background } from '@/features/settings/Background';
import { executeSettings, controlWindow } from '@/lib/desktop';
import { z } from 'zod';
import { setupSteps, setupProgressSchema, setupJobSchema } from '@/lib/onboarding-contracts';
import { useSetupStatus, useSetupAction, useRuntimeStatus } from './repository';
import { Failure } from './controls';
import { HardwareStep, DriverStep } from './SystemSteps';
import { StorageStep, MigrationStep } from './StorageSteps';
import { RuntimeStep, SteamStep } from './SoftwareSteps';
import { AppearanceStep, IdentityStep } from './PersonalSteps';
import './setup.css';
gsap.registerPlugin(useGSAP);

const labels = [
  '磁盘空间',
  '应用位置',
  '硬件档案',
  '显卡驱动',
  '游戏运行库',
  'Steam 游戏库',
  '背景外观',
  '本机身份',
];
/** 向导不挂载 WorkspaceLayout：首页查询、默认头像及卡片不会在准备期间出现。 */
export default function SetupPage() {
  const query = useSetupStatus(),
    advance = useSetupAction(setupProgressSchema),
    acknowledge = useSetupAction(setupJobSchema),
    navigate = useNavigate(),
    scope = useRef<HTMLDivElement>(null);
  const progress = query.data?.progress,
    stage = progress?.stage ?? 'storage',
    index = setupSteps.findIndex((value) => value === stage);
  const runtime = useRuntimeStatus(stage === 'runtimes');
  useEffect(() => {
    if (query.isSuccess)
      void executeSettings({ operation: 'boot-ready' }, z.null()).catch(() => {});
  }, [query.isSuccess]);
  useGSAP(
    () => {
      if (!scope.current?.querySelector('.setup-step-content')) return;
      const media = gsap.matchMedia();
      media.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.from('.setup-step-content', {
          opacity: 0,
          y: 10,
          duration: 0.28,
          ease: 'power2.out',
          clearProps: 'all',
        });
      });
      return () => media.revert();
    },
    { scope, dependencies: [stage] },
  );
  const next = () => advance.mutate({ operation: 'advance', step: setupSteps[index] ?? 'storage' });
  const content = () => {
    switch (stage) {
      case 'storage':
        return <StorageStep />;
      case 'migration':
        return <MigrationStep />;
      case 'hardware':
        return <HardwareStep />;
      case 'drivers':
        return <DriverStep />;
      case 'runtimes':
        return <RuntimeStep />;
      case 'steam':
        return <SteamStep />;
      case 'appearance':
        return <AppearanceStep />;
      case 'identity':
        return <IdentityStep />;
      default:
        return null;
    }
  };
  return (
    <div className="setup-shell" ref={scope}>
      <Background accent="#7de1cf" />
      <header className="setup-titlebar" data-tauri-drag-region>
        <span>臻境 · 初次见面</span>
        <div>
          <button
            aria-label="最小化"
            type="button"
            onClick={() => {
              void controlWindow('minimize');
            }}
          >
            <FontAwesomeIcon icon={faMinus} />
          </button>
          <button
            aria-label="关闭并稍后继续"
            type="button"
            onClick={() => {
              void controlWindow('close');
            }}
          >
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>
      </header>
      <main className="setup-card glass" id="main-content">
        <aside className="setup-navigation">
          <img src="/assets/home/brand.svg" alt="臻境" width={52} height={72} />
          <h1>
            准备好，
            <br />
            再出发。
          </h1>
          <p>让游戏与日常，都更顺手。</p>
          <ol>
            {labels.map((label, i) => (
              <li
                className={
                  i === index
                    ? 'active'
                    : progress?.completed.includes(setupSteps[i] ?? 'storage')
                      ? 'complete'
                      : ''
                }
                key={label}
              >
                <span>
                  {progress?.completed.includes(setupSteps[i] ?? 'storage') ? (
                    <FontAwesomeIcon icon={faCheck} />
                  ) : (
                    String(i + 1).padStart(2, '0')
                  )}
                </span>
                {label}
              </li>
            ))}
          </ol>
          <small>进度自动保存在本机，可随时退出后继续。</small>
        </aside>
        <section className="setup-main">
          {progress?.complete ? (
            <div className="setup-finished">
              <span>准备就绪</span>
              <h2>欢迎来到臻境。</h2>
              <p>配置已保存在本机。系统操作不会在后台重复执行。</p>
              <button
                type="button"
                className="setup-primary"
                onClick={() => {
                  void executeSettings({ operation: 'boot-ready' }, z.null());
                  void navigate('/', { replace: true });
                }}
              >
                进入工作空间
              </button>
            </div>
          ) : (
            <>
              <div className="setup-heading">
                {query.data?.restrictedMode && (
                  <p className="setup-note">开发验收模式：系统安装与磁盘修改已锁定。</p>
                )}
                <span>首次启动 / {String(index + 1).padStart(2, '0')}</span>
                <h2>{labels[index]}</h2>
              </div>
              <div className="setup-step-content" key={stage}>
                {content()}
              </div>
              <Failure error={query.error ?? advance.error} />
              {stage === 'identity' && (
                <button
                  type="button"
                  disabled={advance.isPending}
                  onClick={() => advance.mutate({ operation: 'back' })}
                >
                  ← 返回背景设置
                </button>
              )}
              <Failure error={acknowledge.error} />
              {query.data?.job.phase === 'unknown' && (
                <button
                  type="button"
                  disabled={acknowledge.isPending}
                  onClick={() =>
                    acknowledge.mutate({ operation: 'job-acknowledge', consent: true })
                  }
                >
                  我已在 Windows 中核实上次操作结果，允许继续
                </button>
              )}
              {query.data?.job.message && (
                <p className="setup-job" role="status">
                  {query.data.job.message}
                  {query.data.job.restartRequired ? ' 请保存工作后自行重启 Windows。' : ''}
                </p>
              )}
              {stage !== 'identity' && (
                <footer className="setup-footer">
                  <button
                    type="button"
                    disabled={
                      index === 0 ||
                      advance.isPending ||
                      ['running', 'unknown'].includes(query.data?.job.phase ?? '')
                    }
                    onClick={() => advance.mutate({ operation: 'back' })}
                  >
                    ← 上一步
                  </button>
                  <span>系统修改均需明确确认；可保留现状继续。</span>
                  <button
                    type="button"
                    className="setup-primary"
                    disabled={
                      advance.isPending ||
                      ['running', 'unknown'].includes(query.data?.job.phase ?? '') ||
                      ['downloading', 'verifying', 'installing', 'unknown'].includes(
                        runtime.data?.phase ?? '',
                      )
                    }
                    onClick={next}
                  >
                    保留当前状态，下一步 →
                  </button>
                </footer>
              )}
            </>
          )}
        </section>
      </main>
    </div>
  );
}
