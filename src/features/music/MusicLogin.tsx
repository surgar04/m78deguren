import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { faQq, faSpotify, faYoutube } from '@fortawesome/free-brands-svg-icons';
import {
  faMusic,
  faShieldHalved,
  faQrcode,
  faArrowUpRightFromSquare,
  faCheck,
  faSpinner,
  faRotateRight,
} from '@fortawesome/free-solid-svg-icons';
import { Modal } from '@/features/home/components/Modal';
import { Icon } from '@/features/home/components/Icon';
import { errorMessage } from '@/lib/desktop';
import {
  musicLoginSchema,
  musicLoginStateSchema,
  type OnlineMusicProvider,
} from '@/lib/music-contracts';
import { musicEngine } from './engine';
import { providerLabel } from './model';

const symbols = { qq: faQq, netease: faMusic, spotify: faSpotify, ytm: faYoutube };
/** 授权是一条独立流程：选方式→生成→手机/浏览器确认，不在多个零散段落中寻找操作。 */
export function MusicLogin({
  provider,
  onClose,
}: {
  provider: OnlineMusicProvider;
  onClose: () => void;
}) {
  const cache = useQueryClient();
  const [method, setMethod] = useState('');
  const [imageFailed, setImageFailed] = useState(false);
  const [copyStatus, setCopyStatus] = useState('');
  const attempt = useRef<string | null>(null),
    closed = useRef(false);
  const cancel = useCallback(
    (key: string) => musicEngine('loginCancel', [provider, key], z.unknown()).catch(() => {}),
    [provider],
  );
  useEffect(() => {
    closed.current = false;
    return () => {
      closed.current = true;
      if (attempt.current) void cancel(attempt.current);
    };
  }, [provider, cancel]);
  const methods = useQuery({
    queryKey: ['music', 'login-methods', provider],
    queryFn: () =>
      musicEngine(
        'loginMethods',
        [provider],
        z.array(z.object({ id: z.string(), label: z.string() }).passthrough()),
      ),
    retry: false,
  });
  const start = useMutation({
    mutationFn: async () => {
      if (attempt.current) await cancel(attempt.current);
      attempt.current = null;
      setImageFailed(false);
      setCopyStatus('');
      const result = await musicEngine(
        'loginStart',
        [provider, method || undefined],
        musicLoginSchema,
      );
      // 原生浏览器准备可能晚于弹窗关闭。立即回收迟到的尝试，不让登录窗口孤立在后台。
      if (closed.current) {
        await cancel(result.key);
        throw Error('连接窗口已关闭');
      }
      attempt.current = result.key;
      return result;
    },
  });
  const poll = useQuery({
    queryKey: ['music', 'login', provider, start.data?.key],
    enabled: Boolean(start.data?.key) && !start.isPending,
    queryFn: () => musicEngine('loginCheck', [provider, start.data?.key], musicLoginStateSchema),
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: (query) =>
      query.state.status === 'error' ||
      ['confirmed', 'expired', 'error'].includes(query.state.data?.state ?? '')
        ? false
        : 2000,
  });
  useEffect(() => {
    if (poll.data?.state !== 'confirmed') return;
    attempt.current = null;
    // 等账户读取完成后再刷新歌单，避免两者并行时把访客的空歌单缓存到新账号。
    void cache
      .invalidateQueries({ queryKey: ['music', 'account', provider] })
      .then(() =>
        Promise.all([
          cache.invalidateQueries({ queryKey: ['music', 'collections', provider] }),
          cache.invalidateQueries({ queryKey: ['music', 'songs', provider] }),
        ]),
      );
  }, [poll.data?.state, provider, cache]);
  const browser = provider === 'ytm' || provider === 'spotify';
  const confirmed = !start.isPending && poll.data?.state === 'confirmed';
  const failure = start.error ?? poll.error ?? methods.error;
  const status = confirmed
    ? '连接成功'
    : imageFailed
      ? '二维码加载失败，请重新生成'
      : poll.data?.state === 'expired'
        ? browser
          ? '浏览器授权未完成或已过期，请重新授权'
          : '二维码已过期，请重新生成'
        : poll.data?.state === 'scanned'
          ? '已扫码，请在手机确认'
          : poll.data?.state === 'error'
            ? '连接未完成，请查看下方原因'
            : start.data
              ? provider === 'ytm' && poll.data?.phase === 'reading'
                ? '正在读取专用浏览器的登录会话，临时占用时会自动重试…'
                : provider === 'ytm' && poll.data?.phase === 'verifying'
                  ? '正在连接 YouTube Music 验证账号，请稍候…'
                  : browser
                    ? '等待专用浏览器授权完成并关闭窗口'
                    : '等待你完成授权'
              : failure
                ? '连接失败，请查看下方原因'
                : '准备连接你的音乐';
  return (
    <Modal
      title={`连接 ${providerLabel(provider)}`}
      onClose={onClose}
      wide
      className="music-login-dialog"
    >
      <div className="music-login-layout">
        <aside className={`music-login-intro provider-${provider}`}>
          <div className="music-login-brand">
            <Icon icon={symbols[provider]} />
          </div>
          <span className="music-login-kicker">YOUR MUSIC, TOGETHER</span>
          <h3>
            让喜欢的歌，
            <br />
            在这里相遇。
          </h3>
          <p>连接后读取你的歌单与收藏，使用平台提供的播放权益。</p>
          {provider === 'spotify' && (
            <p>Spotify 播放需要 Premium；平台拒绝音频密钥或地区版权限制时仍可能无法播放。</p>
          )}
          {provider === 'ytm' && <p>通过 YouTube Music 网页授权，无需安装桌面客户端或 PWA。</p>}
          <div className="music-login-privacy">
            <Icon icon={faShieldHalved} />
            <span>
              授权信息仅保存在本机
              <br />
              随时可以断开连接
            </span>
          </div>
        </aside>
        <section className="music-login-action" aria-label="平台授权">
          <h3>{browser ? '在浏览器中安全连接' : '使用手机扫码连接'}</h3>
          <p>
            {provider === 'ytm'
              ? '在专用窗口中登录 Google，等待 YouTube Music 页面显示你的账号，然后关闭这个专用浏览器的所有窗口。返回后将自动读取并验证登录会话。'
              : browser
                ? '点击下方按钮，在打开的浏览器中完成授权。'
                : `打开${providerLabel(provider)}，扫描下方二维码。`}
          </p>
          {(methods.data?.length ?? 0) > 1 && (
            <div className="music-login-methods" aria-label="登录方式">
              {methods.data?.map((row, index) => (
                <button
                  type="button"
                  key={row.id}
                  aria-pressed={(method || methods.data?.[0]?.id) === row.id}
                  disabled={start.isPending}
                  onClick={() => {
                    setMethod(row.id);
                    start.reset();
                    if (attempt.current) {
                      void cancel(attempt.current);
                      attempt.current = null;
                    }
                  }}
                >
                  {row.label || `方式 ${index + 1}`}
                </button>
              ))}
            </div>
          )}
          <div
            className={`music-login-code ${browser ? 'browser' : ''}`}
            aria-busy={start.isPending}
          >
            {confirmed ? (
              <Icon icon={faCheck} />
            ) : start.isPending ? (
              <>
                <Icon icon={faSpinner} className="music-spin" />
                <span>正在准备授权…</span>
              </>
            ) : !browser && start.data?.image && !imageFailed ? (
              <img
                src={start.data.image}
                alt={`${providerLabel(provider)}登录二维码`}
                onError={() => setImageFailed(true)}
              />
            ) : (
              <>
                <Icon icon={browser ? faArrowUpRightFromSquare : faQrcode} />
                <span>
                  {browser
                    ? '账号与密码在平台页面填写'
                    : imageFailed
                      ? '点击下方按钮重新生成'
                      : '点击下方按钮生成二维码'}
                </span>
              </>
            )}
          </div>
          <div className={`music-login-status ${confirmed ? 'connected' : ''}`} role="status">
            {status}
          </div>
          {(failure || poll.data?.state === 'error') && (
            <p className="music-login-error" role="alert">
              {failure ? errorMessage(failure) : poll.data?.message}
              {poll.data?.code && <small>诊断代码：{poll.data.code}</small>}
            </p>
          )}
          {poll.data?.diagnostics && (
            <div className="music-login-diagnostics">
              <button
                type="button"
                className="glass-button"
                onClick={() => {
                  const content = `臻境 YouTube Music 授权诊断\n${poll.data?.diagnostics ?? ''}`;
                  if (typeof navigator.clipboard?.writeText !== 'function') {
                    setCopyStatus('剪贴板不可用，请展开诊断后手动复制');
                    return;
                  }
                  void navigator.clipboard.writeText(content).then(
                    () => setCopyStatus('已复制脱敏诊断，不含账号、Cookie 或令牌'),
                    () => setCopyStatus('复制失败，请展开诊断后手动复制'),
                  );
                }}
              >
                复制脱敏诊断
              </button>
              <span role="status">{copyStatus}</span>
              <details>
                <summary>查看授权阶段</summary>
                <pre>{poll.data.diagnostics}</pre>
              </details>
            </div>
          )}
          <button
            type="button"
            className="mint-button music-login-primary"
            disabled={start.isPending || methods.isPending}
            onClick={() => (confirmed ? onClose() : start.mutate())}
          >
            <Icon
              icon={
                confirmed
                  ? faCheck
                  : start.data
                    ? faRotateRight
                    : browser
                      ? faArrowUpRightFromSquare
                      : faQrcode
              }
            />
            {confirmed
              ? '完成连接'
              : start.isPending
                ? '正在准备…'
                : start.data
                  ? '重新授权'
                  : browser
                    ? '打开授权页面'
                    : '生成登录二维码'}
          </button>
          <small>
            {provider === 'spotify'
              ? '完整播放需要 Spotify Premium，曲目可用性由平台决定。'
              : provider === 'ytm'
                ? '使用专用浏览器窗口，不读取已有浏览器的个人资料。'
                : '请仅使用本人账号授权，平台会员与地区限制保持不变。'}
          </small>
        </section>
      </div>
    </Modal>
  );
}
