import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { faCopy, faCrosshairs } from '@fortawesome/free-solid-svg-icons';
import { Icon } from '@/features/home/components/Icon';
import { executeGameRoom, errorMessage, isDesktop } from '@/lib/desktop';
import { deltaImageSource } from './image-source';

/** 图片仅经原生白名单网关获取，不把资料里的任意网址放进页面，也不扩大 CSP。 */
export function DeltaImage({
  src,
  alt,
  className = '',
}: {
  src?: string | undefined;
  alt: string;
  className?: string;
}) {
  const url = deltaImageSource(src);
  const query = useQuery({
    queryKey: ['delta-image', url],
    queryFn: () =>
      executeGameRoom(
        { operation: 'asset', url: url ?? '' },
        z.string().startsWith('data:image/').max(6_000_000),
      ),
    enabled: isDesktop() && !!url,
    staleTime: 3600_000,
    gcTime: 600_000,
    retry: false,
  });
  return query.data ? (
    <img className={className} src={query.data} alt={alt} loading="lazy" decoding="async" />
  ) : (
    <span className={`delta-image-placeholder ${className}`} role="img" aria-label={alt}>
      <Icon icon={faCrosshairs} />
    </span>
  );
}
export function DeltaFeedback({ error, notice }: { error?: unknown; notice?: string | undefined }) {
  return (
    <>
      {!!error && (
        <p role="alert" className="delta-error">
          {errorMessage(error)}
        </p>
      )}
      {notice && (
        <p role="status" className="delta-notice">
          {notice}
        </p>
      )}
    </>
  );
}
export function DeltaEmpty({ children }: { children: ReactNode }) {
  return <div className="delta-empty">{children}</div>;
}
export function CopyButton({ value, label = '复制' }: { value: string; label?: string }) {
  const [status, setStatus] = useState('');
  return (
    <button
      type="button"
      title={status || label}
      onClick={() => {
        void navigator.clipboard
          .writeText(value)
          .then(() => setStatus('已复制'))
          .catch(() => setStatus('复制失败，请检查剪贴板权限'));
      }}
    >
      <Icon icon={faCopy} /> {status || label}
    </button>
  );
}
