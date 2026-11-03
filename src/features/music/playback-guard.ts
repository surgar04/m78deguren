/** 等待平台/解码器时允许切歌取消，并确保拒绝或迟到的 Promise 都被消费。 */
export function playbackStep<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  milliseconds: number,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      clean();
      reject(Error(message));
    }, milliseconds);
    const clean = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    };
    const abort = () => {
      clean();
      reject(new DOMException('播放请求已取消', 'AbortError'));
    };
    promise.then(
      (value) => {
        clean();
        resolve(value);
      },
      (cause: unknown) => {
        clean();
        reject(cause instanceof Error ? cause : Error('播放请求未完成，请重试'));
      },
    );
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
  });
}

/** 翻译上游固定错误句子；不回传 Error.cause 或原生堆栈。 */
export function playbackMessage(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : '';
  if (cause instanceof DOMException && cause.name === 'NotAllowedError')
    return '浏览器尚未允许声音播放，请再次点击播放。';
  return message || '音乐播放失败，请重试';
}
