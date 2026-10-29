import { useEffect, useRef, useState } from 'react';
import { DEFAULT_WALLPAPER } from './wallpaper';
import { useText, type TextKey } from './i18n';
import { validBackgroundVideoDuration } from './video';

/** 老素材或磁盘上被替换的文件仍需检查；元数据确认前绝不自动播放。 */
export function BackgroundVideo({ url, reduce }: { url: string; reduce: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [failure, setFailure] = useState<TextKey | null>(null);
  const { t } = useText();
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    let alive = true;
    let rejected = false;
    const reject = (reason: TextKey) => {
      if (!alive || rejected) return;
      rejected = true;
      video.pause();
      setFailure(reason);
    };
    const error = () => reject('视频无法播放，请更换有效的 MP4 / WebM。');
    const change = () => {
      if (!alive || rejected) return;
      if (video.readyState < HTMLMediaElement.HAVE_METADATA) return;
      if (!validBackgroundVideoDuration(video.duration)) {
        reject('视频背景须为 15 秒以内，请重新上传。');
        return;
      }
      if (document.hidden || reduce) video.pause();
      else if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        // 卸载、隐藏或效果偏好变化可能取消尚未完成的 play，取消不应误报素材损坏。
        void video.play().catch((cause: unknown) => {
          if (cause instanceof DOMException && cause.name === 'AbortError') return;
          error();
        });
      }
    };
    const timeout = window.setTimeout(() => {
      if (video.readyState < HTMLMediaElement.HAVE_METADATA) error();
    }, 15_000);
    for (const event of ['loadedmetadata', 'durationchange', 'loadeddata'])
      video.addEventListener(event, change);
    video.addEventListener('error', error);
    document.addEventListener('visibilitychange', change);
    change();
    return () => {
      alive = false;
      window.clearTimeout(timeout);
      for (const event of ['loadedmetadata', 'durationchange', 'loadeddata'])
        video.removeEventListener(event, change);
      video.removeEventListener('error', error);
      document.removeEventListener('visibilitychange', change);
      video.pause();
    };
  }, [url, reduce]);
  return failure ? (
    <div className="settings-background-error" role="alert">
      {t(failure)}
    </div>
  ) : (
    <video
      ref={ref}
      src={url}
      poster={DEFAULT_WALLPAPER}
      muted
      loop
      playsInline
      preload="auto"
      aria-hidden="true"
    />
  );
}
