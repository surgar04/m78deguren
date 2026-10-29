import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { BackgroundVideo } from './BackgroundVideo';
import { validBackgroundVideoDuration } from './video';
import { useSettingsUi } from './ui-store';

describe('视频背景的播放边界与资源生命周期', () => {
  const play = vi.fn<() => Promise<void>>();
  const pause = vi.fn<() => void>();
  beforeEach(() => {
    useSettingsUi.getState().patch({ language: 'zh-CN' });
    play.mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(play);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(pause);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });
  const metadata = (video: HTMLVideoElement, duration: number) => {
    Object.defineProperties(video, {
      readyState: { configurable: true, value: HTMLMediaElement.HAVE_CURRENT_DATA },
      duration: { configurable: true, value: duration },
    });
    fireEvent.loadedMetadata(video);
  };
  const findVideo = (container: HTMLElement) => {
    const video = container.querySelector('video');
    if (!video) throw new Error('视频未渲染');
    return video;
  };
  it('仅允许正数有限时长，15 秒边界不放宽', () => {
    expect(validBackgroundVideoDuration(15)).toBe(true);
    expect(validBackgroundVideoDuration(0.001)).toBe(true);
    for (const value of [0, -1, NaN, Infinity, 15.000001, 16])
      expect(validBackgroundVideoDuration(value)).toBe(false);
  });
  it('检查前不播放；合格的视频静音循环，卸载时停止', () => {
    const view = render(<BackgroundVideo url="/short.mp4" reduce={false} />);
    const video = findVideo(view.container);
    expect(video.muted).toBe(true);
    expect(video.loop).toBe(true);
    expect(play).not.toHaveBeenCalled();
    metadata(video, 15);
    expect(play).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(pause).toHaveBeenCalled();
  });
  it('旧素材超过限制也不播放，展示可理解的错误', () => {
    const view = render(<BackgroundVideo url="/old.mp4" reduce={false} />);
    metadata(findVideo(view.container), 16);
    expect(play).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('15 秒以内');
    expect(view.container.querySelector('video')).toBeNull();
  });
  it('隐藏窗口或减少动态效果时暂停，恢复可见时继续', () => {
    const view = render(<BackgroundVideo url="/short.webm" reduce={true} />);
    const video = findVideo(view.container);
    metadata(video, 1);
    expect(play).not.toHaveBeenCalled();
    view.rerender(<BackgroundVideo url="/short.webm" reduce={false} />);
    expect(play).toHaveBeenCalledTimes(1);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    fireEvent(document, new Event('visibilitychange'));
    expect(pause).toHaveBeenCalled();
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    fireEvent(document, new Event('visibilitychange'));
    expect(play).toHaveBeenCalledTimes(2);
  });
});
