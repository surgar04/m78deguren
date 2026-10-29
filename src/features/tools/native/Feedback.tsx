import { errorMessage } from '@/lib/desktop';

/** 所有异步入口均有忙碌/错误/空状态，不将未读取结果显示成零或成功。 */
export function Feedback({
  pending,
  error,
  success,
}: {
  pending?: boolean;
  error?: unknown;
  success?: string | undefined;
}) {
  if (error)
    return (
      <p className="native-tool-feedback error" role="alert">
        {typeof error === 'string' ? error : errorMessage(error)}
      </p>
    );
  if (pending)
    return (
      <p className="native-tool-feedback" role="status">
        正在处理，请稍候…
      </p>
    );
  return success ? (
    <p className="native-tool-feedback" role="status">
      {success}
    </p>
  ) : null;
}
