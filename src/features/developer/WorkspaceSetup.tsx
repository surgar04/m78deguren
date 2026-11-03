import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { executeWorkspace, errorMessage } from '@/lib/desktop';
import type { WorkspaceRequest } from '@/lib/workspace-contracts';

const key = ['developer-workspace'] as const;
function useWorkspace() {
  return useQuery({
    queryKey: key,
    queryFn: () => executeWorkspace({ operation: 'status' }),
    retry: false,
    refetchInterval: (query) => (query.state.data?.phase === 'preparing' ? 1000 : false),
  });
}
function useWorkspaceAction() {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false),
    [failure, setFailure] = useState('');
  const run = async (request: WorkspaceRequest) => {
    setBusy(true);
    setFailure('');
    try {
      client.setQueryData(key, await executeWorkspace(request));
    } catch (cause) {
      setFailure(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  return { run, busy, failure };
}
/** 认证成功后独立显示准备向导；准备完成或明确稍后设置才挂载业务页面。 */
export function WorkspaceGate({ children }: { children: ReactNode }) {
  const query = useWorkspace();
  if (query.isPending)
    return (
      <main className="page-loading" role="status">
        正在检查开发工作区…
      </main>
    );
  if (query.error)
    return (
      <main className="page-loading" role="alert">
        <p>{errorMessage(query.error)}</p>
        <button
          type="button"
          onClick={() => {
            void query.refetch();
          }}
        >
          重试
        </button>
      </main>
    );
  return query.data?.promptRequired ? <WorkspaceSetup /> : children;
}
export function WorkspaceSetup() {
  const ref = useRef<HTMLDialogElement>(null);
  const query = useWorkspace(),
    action = useWorkspaceAction();
  const status = query.data,
    running = status?.phase === 'preparing';
  useEffect(() => {
    const element = ref.current;
    const previous = document.activeElement;
    if (!element?.open) element?.showModal();
    return () => {
      element?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="developer-auth workspace-setup"
      aria-modal="true"
      aria-labelledby="workspace-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!running && !action.busy) void action.run({ operation: 'defer' });
      }}
    >
      <span className="developer-eyebrow">DEVELOPER WORKSPACE</span>
      <h1 id="workspace-title">准备你的开发工作区</h1>
      <p>
        源码、便携工具、依赖和缓存集中在你选择的目录。仅获取本项目 <strong>codex/develop</strong>{' '}
        分支，不覆盖未提交改动。
      </p>
      <ol className="workspace-steps">
        <li>获取源码</li>
        <li>准备工具链</li>
        <li>安装依赖</li>
        <li>检查环境</li>
      </ol>
      {status?.root && <p className="workspace-path">{status.root}</p>}
      <p role="status" aria-live="polite">
        {status?.message}
      </p>
      {running && <progress aria-label="开发环境准备进行中" />}
      <small>
        准备可能需要较长时间和至少 15 GiB 空间。Node、pnpm、Rust、.NET、Git 均使用便携环境；缺少微软
        C++ / SDK 时会提供官方入口，安装后可继续。
      </small>
      {(action.failure || query.error) && (
        <p role="alert">{action.failure || errorMessage(query.error)}</p>
      )}
      <div className="developer-auth-actions">
        {running ? (
          <button
            type="button"
            disabled={action.busy}
            onClick={() => {
              void action.run({ operation: 'cancel' });
            }}
          >
            取消准备
          </button>
        ) : (
          <>
            <button
              type="button"
              disabled={action.busy}
              onClick={() => {
                void action.run({ operation: 'defer' });
              }}
            >
              稍后设置
            </button>
            <button
              type="button"
              disabled={action.busy}
              onClick={() => {
                void action.run({ operation: 'select' });
              }}
            >
              选择源码目录 / 重试
            </button>
            {status?.ticket && (
              <button
                type="button"
                className="primary-button"
                disabled={action.busy}
                onClick={() => {
                  if (status.ticket)
                    void action.run({ operation: 'prepare', ticket: status.ticket, consent: true });
                }}
              >
                确认目录并准备环境
              </button>
            )}
          </>
        )}
        {status?.root && (
          <button
            type="button"
            disabled={action.busy}
            onClick={() => {
              void action.run({ operation: 'logs' });
            }}
          >
            准备日志
          </button>
        )}
        {status?.phase === 'action-required' && (
          <button
            type="button"
            onClick={() => {
              void action.run({ operation: 'prerequisites' });
            }}
          >
            微软 C++ 开发工具
          </button>
        )}
      </div>
    </dialog>
  );
}
export function WorkspaceCard() {
  const query = useWorkspace(),
    action = useWorkspaceAction();
  return (
    <section className="developer-edition-panel">
      <h3>开发工作区</h3>
      <p>{query.data?.root ?? '尚未选择源码目录'}</p>
      <p role="status">{query.data?.message}</p>
      {action.failure && <p role="alert">{action.failure}</p>}
      <button
        type="button"
        disabled={action.busy}
        onClick={() => {
          void action.run({ operation: 'select' });
        }}
      >
        选择目录并准备 / 更新源码
      </button>
      {query.data?.root && (
        <button
          type="button"
          onClick={() => {
            void action.run({ operation: 'open' });
          }}
        >
          打开源码目录
        </button>
      )}
    </section>
  );
}
