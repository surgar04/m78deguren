import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { z } from 'zod';
import { executeMusic, errorMessage } from '@/lib/desktop';
import { musicBackgroundSchema, musicStyleSchema, musicThemeSchema } from '@/lib/music-contracts';
import { musicPlayer, useMusicPlayer } from './player';
import { useMusicPreferences } from './preferences';
import { musicEngine } from './engine';
import { immersiveSession } from './immersive-session';

const themes = z.object({ light: musicThemeSchema, dark: musicThemeSchema });
const actionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('policy'), policy: z.enum(['auto', 'original', 'efficient']) }),
  z.object({ kind: z.literal('embed'), id: z.uuid(), url: z.url().max(4096) }),
  z.object({ kind: z.enum(['exit', 'toggle', 'next', 'previous', 'ready']) }),
  z.object({ kind: z.literal('seek'), seconds: z.number().finite().nonnegative() }),
  z.object({ kind: z.literal('style'), style: musicStyleSchema }),
  z.object({ kind: z.literal('background'), background: musicBackgroundSchema }),
]);
/** iframe 的生命周期就是 GPU 资源边界；关闭后移除整个文档，不把隐藏的 WebGL 留在后台。 */
export function ImmersivePlayer({ onExit }: { onExit: () => void }) {
  const playback = useMusicPlayer(),
    preferences = useMusicPreferences();
  const frame = useRef<HTMLIFrameElement>(null),
    port = useRef<MessagePort | null>(null);
  const [ready, setReady] = useState(false),
    [failure, setFailure] = useState('');
  const [palette, setPalette] = useState<z.infer<typeof themes> | null>(null);
  const exit = useRef(onExit);
  useEffect(() => {
    exit.current = onExit;
  }, [onExit]);
  useEffect(() => {
    let active = true;
    const htmlOverflow = document.documentElement.style.overflow,
      bodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    const lease = immersiveSession.acquire();
    void lease.ready.catch((cause: unknown) => {
      if (active) setFailure(errorMessage(cause));
    });
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') exit.current();
    };
    window.addEventListener('keydown', key);
    return () => {
      active = false;
      document.documentElement.style.overflow = htmlOverflow;
      document.body.style.overflow = bodyOverflow;
      window.removeEventListener('keydown', key);
      port.current?.close();
      void lease.release().catch(() => {});
    };
  }, []);
  useEffect(() => {
    if (ready) return;
    const timer = window.setTimeout(() => setFailure('歌词引擎加载超时，请退出后重试。'), 45000);
    return () => window.clearTimeout(timer);
  }, [ready]);
  useEffect(() => {
    let active = true;
    const operation =
      preferences.themeSource === 'cover'
        ? musicEngine('palette', [playback.track?.cover ?? null], themes)
        : musicEngine('themes', [], themes);
    void operation
      .then((value) => {
        if (active) setPalette(value);
      })
      .catch((cause: unknown) => {
        if (active) setFailure(errorMessage(cause));
      });
    return () => {
      active = false;
    };
  }, [playback.track?.cover, preferences.themeSource]);
  useEffect(() => {
    const connect = (event: MessageEvent<unknown>) => {
      if (
        event.source !== frame.current?.contentWindow ||
        event.origin !== location.origin ||
        event.data !== 'zhenjing-music-stage-ready'
      )
        return;
      port.current?.close();
      const channel = new MessageChannel();
      port.current = channel.port1;
      channel.port1.onmessage = (message: MessageEvent<unknown>) => {
        const result = actionSchema.safeParse(message.data);
        if (!result.success) return;
        const action = result.data;
        switch (action.kind) {
          case 'policy':
            useMusicPreferences.getState().patch({ renderPolicy: action.policy });
            break;
          case 'embed':
            void executeMusic(
              { operation: 'embed', url: action.url },
              z.object({ url: z.string() }),
            )
              .then((value) =>
                channel.port1.postMessage({ kind: 'embed-result', id: action.id, url: value.url }),
              )
              .catch(() =>
                channel.port1.postMessage({ kind: 'embed-result', id: action.id, url: null }),
              );
            break;
          case 'ready':
            setReady(true);
            break;
          case 'exit':
            exit.current();
            break;
          case 'toggle':
            void musicPlayer.toggle();
            break;
          case 'next':
            void musicPlayer.next(1);
            break;
          case 'previous':
            void musicPlayer.next(-1);
            break;
          case 'seek':
            musicPlayer.seekLyric(action.seconds);
            break;
          case 'style':
            useMusicPreferences.getState().patch({ style: action.style });
            break;
          case 'background':
            useMusicPreferences.getState().patch({ background: action.background });
            break;
        }
      };
      channel.port1.start();
      frame.current?.contentWindow?.postMessage('zhenjing-music-stage-connect', location.origin, [
        channel.port2,
      ]);
      frame.current?.focus();
    };
    window.addEventListener('message', connect);
    return () => {
      window.removeEventListener('message', connect);
    };
  }, []);
  useEffect(() => {
    if (!ready || !palette || !playback.track) return;
    const theme =
      preferences.themeSource === 'custom' && preferences.customTheme
        ? preferences.customTheme
        : preferences.daylight
          ? palette.light
          : palette.dark;
    port.current?.postMessage({
      kind: 'state',
      renderPolicy: preferences.renderPolicy,
      track: playback.track,
      lyrics: playback.lyrics,
      style: preferences.style,
      background: preferences.background,
      theme,
      daylight: preferences.daylight,
    });
  }, [
    ready,
    palette,
    playback.track,
    playback.lyrics,
    preferences.style,
    preferences.background,
    preferences.daylight,
    preferences.themeSource,
    preferences.customTheme,
    preferences.renderPolicy,
  ]);
  useEffect(() => {
    if (!ready) return;
    const send = () => {
      if (!document.hidden) port.current?.postMessage(musicPlayer.clock());
    };
    send();
    const timer = window.setInterval(send, 50);
    return () => clearInterval(timer);
  }, [ready]);
  return createPortal(
    <section className="music-immersive" aria-label="沉浸演绎">
      <iframe
        ref={frame}
        src="/music-engine/stage.html"
        title="Folia 沉浸歌词"
        allow="fullscreen"
      />
      {(!ready || failure) && (
        <div className="music-immersive-message" role={failure ? 'alert' : 'status'}>
          {failure || '正在准备原版歌词引擎…'}
          <button type="button" onClick={onExit}>
            退出沉浸演绎
          </button>
        </div>
      )}
    </section>,
    document.body,
  );
}
