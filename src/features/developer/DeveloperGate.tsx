import { useEffect, useRef, useState, type ReactNode, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { executeDeveloper, isDesktop, errorMessage, desktopWindowLabel } from '@/lib/desktop';
import './developer.css';

const key = ['developer-identity'] as const;
function useDeveloperStatus() {
  return useQuery({
    queryKey: key,
    queryFn: () => executeDeveloper({ operation: 'status' }),
    enabled: isDesktop() && desktopWindowLabel() === 'main',
    refetchInterval: 30_000,
    retry: false,
  });
}

/** 位于首次启动及所有页面之上；默认不渲染业务组件，避免后台查询提前发出。 */
export function DeveloperGate({ children }: { children: ReactNode }) {
  const status = useDeveloperStatus();
  if (!isDesktop() || desktopWindowLabel() !== 'main') return children;
  if (status.isPending)
    return (
      <main className="page-loading" role="status">
        正在检查发行通道…
      </main>
    );
  if (status.error)
    return (
      <main className="page-loading" role="alert">
        <p>{errorMessage(status.error)}</p>
        <button
          type="button"
          onClick={() => {
            void status.refetch();
          }}
        >
          重试
        </button>
      </main>
    );
  if (status.data?.mode === 'locked') return <DeveloperAuthentication />;
  return children;
}

export function DeveloperAuthentication({ onClose }: { onClose?: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    const previous = document.activeElement;
    if (!dialog?.open) dialog?.showModal();
    return () => {
      dialog?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  const client = useQueryClient();
  const [email, setEmail] = useState('');
  const [stoken, setStoken] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const submit = async (fallback: boolean) => {
    if (busy) return;
    setBusy(true);
    setFailure('');
    try {
      const status = await executeDeveloper(
        fallback
          ? { operation: 'fallback' }
          : { operation: 'authenticate', email: email.trim().toLowerCase(), stoken: stoken.trim() },
      );
      client.setQueryData(key, status);
      // 通道切换后清除旧更新查询；后端仍重新验签及核对当前通道。
      await client.invalidateQueries({ predicate: (query) => query.queryKey[0] !== key[0] });
      onClose?.();
    } catch (cause) {
      setFailure(errorMessage(cause));
    } finally {
      setStoken('');
      setBusy(false);
    }
  };
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submit(false);
  };
  return (
    <dialog
      ref={dialogRef}
      className="developer-auth glass"
      aria-modal="true"
      aria-labelledby="developer-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) void submit(true);
      }}
    >
      <img src="/assets/home/brand.png" alt="臻境" width="64" />
      <span className="developer-eyebrow">ZHENJING · DEVELOPER</span>
      <h1 id="developer-title">开发者身份认证</h1>
      <p>输入受邀邮箱和与之绑定的 stoken，启用官方开发者通道。</p>
      <form onSubmit={onSubmit}>
        <label>
          邮箱
          <input
            type="email"
            autoComplete="email"
            required
            maxLength={254}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={busy}
          />
        </label>
        <label>
          stoken
          <input
            type="password"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            required
            maxLength={4096}
            value={stoken}
            onChange={(event) => setStoken(event.target.value)}
            disabled={busy}
          />
        </label>
        <small>
          凭据只用于当前会话，不保存在本机。认证失败或跳过将使用稳定功能与更新通道，保留用户数据。
        </small>
        {failure && <p role="alert">{failure}</p>}
        <div className="developer-auth-actions">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void submit(true);
            }}
          >
            使用发布版
          </button>
          <button type="submit" className="primary-button" disabled={busy}>
            {busy ? '正在处理…' : '认证开发者身份'}
          </button>
        </div>
      </form>
    </dialog>
  );
}

export function DeveloperEditionPanel() {
  const status = useDeveloperStatus();
  const [open, setOpen] = useState(false);
  if (status.data?.edition !== 'developer') return null;
  return (
    <section className="developer-edition-panel">
      <strong>
        {status.data.mode === 'developer' ? '开发者通道' : '稳定功能与更新通道'} ·{' '}
        {status.data.build}
      </strong>
      <p role="status">{status.data.message || '开发者安装包；尚未启用开发者身份。'}</p>
      <button type="button" onClick={() => setOpen(true)}>
        {status.data.mode === 'developer' ? '管理开发者身份' : '重新认证开发者身份'}
      </button>
      {open && <DeveloperAuthentication onClose={() => setOpen(false)} />}
    </section>
  );
}
