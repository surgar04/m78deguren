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
  const known: Record<string, string> = {
    'Spotify plays for Premium accounts only':
      'Spotify 需要可用于第三方播放的 Premium 订阅；请检查当前绑定的账号。',
    'Spotify gives this account no audio key':
      'Spotify 拒绝向此账号提供音频密钥，当前播放链路无法播放。请使用 Spotify 官方播放器；重新登录不能解除平台限制。',
    'Spotify refused the audio key for now': 'Spotify 暂时拒绝音频密钥，请稍后重试。',
    'Spotify playback could not connect':
      'Spotify 音频连接未建立。请检查 Spotify 播放网络是否可达；仅网页登录成功不能证明音频连接可用。',
    'Spotify playback is not available on this system':
      'Spotify 原生播放组件无法加载，请使用完整安装包修复安装。',
    'Spotify did not answer': 'Spotify 音频服务响应超时，请重试或检查网络。',
    'Spotify could not be reached': '无法连接 Spotify，请检查网络和地区可用性。',
    'Spotify has no audio for this track': 'Spotify 未提供这首歌曲的可用音源，请尝试其他歌曲。',
    'Spotify asked to wait before trying again': 'Spotify 请求过于频繁，请稍后重试。',
    'Spotify sign-in is required': 'Spotify 登录已失效，请重新连接账号。',
  };
  if (Object.hasOwn(known, message)) return known[message] ?? '音乐播放失败';
  if (cause instanceof DOMException && cause.name === 'NotAllowedError')
    return '浏览器尚未允许声音播放，请再次点击播放。';
  return message || '音乐播放失败，请重试';
}
