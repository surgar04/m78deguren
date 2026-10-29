import { useState } from 'react';
import { recordingsSchema, type Recording } from '@/lib/tool-contracts';
import { recordingMediaUrl } from '@/lib/desktop';
import { useToolAction, useToolQuery } from './hooks';
import { Feedback } from './Feedback';
import { bytes } from './format';

/** 缩略图取自真实视频帧；解码不支持时提供系统播放器入口，不生成虚假封面。 */
function VideoThumbnail({ file }: { file: Recording }) {
  const [thumbnail, setThumbnail] = useState('');
  const [unavailable, setUnavailable] = useState(false);
  const capture = (video: HTMLVideoElement) => {
    if (!video.videoWidth || !video.videoHeight) return;
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = Math.round((256 * video.videoHeight) / video.videoWidth);
    const context = canvas.getContext('2d');
    if (!context) return;
    try {
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      setThumbnail(canvas.toDataURL('image/jpeg', 0.72));
    } catch {
      setUnavailable(true);
    }
  };
  return (
    <div className="native-video-thumbnail">
      {thumbnail ? (
        <img src={thumbnail} alt={file.name + '视频缩略图'} />
      ) : (
        <span>{unavailable ? '此格式请用系统播放器预览' : '正在读取视频帧…'}</span>
      )}
      {!unavailable && !thumbnail && (
        <video
          src={recordingMediaUrl(file.id)}
          crossOrigin="anonymous"
          preload="auto"
          muted
          onLoadedMetadata={(e) => {
            const video = e.currentTarget;
            if (Number.isFinite(video.duration) && video.duration > 0)
              video.currentTime = Math.min(1, video.duration * 0.1);
          }}
          onLoadedData={(e) => capture(e.currentTarget)}
          onSeeked={(e) => capture(e.currentTarget)}
          onError={() => setUnavailable(true)}
        />
      )}
    </div>
  );
}
export function RecordingsPanel() {
  const query = useToolQuery('recording-scan', recordingsSchema);
  const action = useToolAction();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [rename, setRename] = useState('');
  const [confirm, setConfirm] = useState<string | null>(null);
  const [folder, setFolder] = useState('');
  const [after, setAfter] = useState('');
  const [before, setBefore] = useState('');
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const [batchConsent, setBatchConsent] = useState(false);
  const files =
    query.data?.files.filter(
      (file) =>
        (!folder || file.rootId === folder) &&
        (!after || file.modifiedMs >= new Date(`${after}T00:00:00`).getTime()) &&
        (!before || file.modifiedMs < new Date(`${before}T23:59:59.999`).getTime()) &&
        file.name
          .normalize('NFKC')
          .toLocaleLowerCase()
          .includes(search.normalize('NFKC').toLocaleLowerCase()),
    ) ?? [];
  const active = query.data?.files.find((file) => file.id === selected);
  return (
    <div className="native-tool-panel">
      <div className="native-tool-actions">
        <button
          type="button"
          className="native-button"
          disabled={action.isPending}
          onClick={() => action.mutate({ operation: 'recording-discover' })}
        >
          发现系统视频目录
        </button>
        <button
          type="button"
          className="mint-button"
          disabled={action.isPending}
          onClick={() => action.mutate({ operation: 'recording-add' })}
        >
          添加录屏目录
        </button>
        <button
          type="button"
          className="native-button"
          disabled={query.isFetching}
          onClick={() => {
            void query.refetch();
          }}
        >
          刷新文件
        </button>
      </div>
      <p className="native-tool-note">
        管理已有视频。默认目录从 Windows 视频库读取，也可手动添加本地录屏目录。
        移除文件会进入原目录所在磁盘的可恢复暂存区；不会开始录屏或自动清理文件。
      </p>
      <Feedback
        pending={query.isFetching || action.isPending}
        error={query.error || action.error}
      />
      {query.data?.roots.map((root) => (
        <div className="native-tool-list-row" key={root.id}>
          <code>{root.path}</code>
          <button
            type="button"
            className="native-button"
            onClick={() => action.mutate({ operation: 'recording-root-remove', id: root.id })}
          >
            移除目录（保留文件）
          </button>
        </div>
      ))}
      {query.data?.truncated && (
        <p className="native-tool-feedback">目录超过单次扫描上限，请添加更具体的子目录。</p>
      )}
      <label className="native-tool-search">
        搜索视频
        <input
          type="search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
        />
      </label>
      <div className="native-tool-form">
        <label>
          录屏目录
          <select
            value={folder}
            onChange={(e) => {
              setFolder(e.target.value);
              setPage(0);
            }}
          >
            <option value="">全部目录</option>
            {query.data?.roots.map((root) => (
              <option key={root.id} value={root.id}>
                {root.path}
              </option>
            ))}
          </select>
        </label>
        <label>
          开始日期
          <input
            type="date"
            value={after}
            onChange={(e) => {
              setAfter(e.target.value);
              setPage(0);
            }}
          />
        </label>
        <label>
          结束日期
          <input
            type="date"
            value={before}
            onChange={(e) => {
              setBefore(e.target.value);
              setPage(0);
            }}
          />
        </label>
      </div>
      <section className="native-tool-confirm">
        <div className="native-tool-actions">
          <button
            type="button"
            className="native-button"
            onClick={() => {
              setChecked(new Set(files.slice(page * 12, (page + 1) * 12).map((file) => file.id)));
              setBatchConsent(false);
            }}
          >
            选择当前页
          </button>
          <button
            type="button"
            className="native-button"
            onClick={() => {
              setChecked(new Set());
              setBatchConsent(false);
            }}
          >
            清空选择
          </button>
          <span>已选 {checked.size} 个</span>
        </div>
        <label className="native-checkbox">
          <input
            type="checkbox"
            checked={batchConsent}
            onChange={(e) => setBatchConsent(e.target.checked)}
          />
          确认对当前选择的视频执行所选批量操作
        </label>
        <div className="native-tool-actions">
          {(['copy', 'remove'] as const).map((operation) => (
            <button
              type="button"
              className="native-button"
              key={operation}
              disabled={
                !batchConsent || checked.size === 0 || checked.size > 100 || action.isPending
              }
              onClick={() => {
                action.mutate({
                  operation: 'recording-batch',
                  ids: [...checked],
                  action: operation,
                  consent: true,
                });
                setBatchConsent(false);
              }}
            >
              {operation === 'copy' ? '批量复制到本地目录' : '批量移到可恢复暂存区'}
            </button>
          ))}
        </div>
        {action.isSuccess && Array.isArray(action.data) && (
          <p role="status">
            操作结果：
            {action.data.map((row) => `${row.id.slice(0, 8)}：${row.error ?? '完成'}`).join('；')}
          </p>
        )}
      </section>
      {active && (
        <section className="native-video-player">
          <h3>{active.name}</h3>
          <video key={active.id} src={recordingMediaUrl(active.id)} controls preload="metadata" />
          <p className="native-tool-note">浏览器不支持的编码可选择“系统播放器打开”。</p>
          <div className="native-tool-actions">
            <button
              type="button"
              className="native-button"
              onClick={() =>
                action.mutate({ operation: 'recording-file', id: active.id, action: 'open' })
              }
            >
              系统播放器打开
            </button>
            <button
              type="button"
              className="native-button"
              onClick={() =>
                action.mutate({ operation: 'recording-file', id: active.id, action: 'reveal' })
              }
            >
              定位
            </button>
            <button
              type="button"
              className="native-button"
              onClick={() =>
                action.mutate({ operation: 'recording-file', id: active.id, action: 'copy' })
              }
            >
              复制到本地目录
            </button>
          </div>
          <form
            className="native-tool-actions"
            onSubmit={(e) => {
              e.preventDefault();
              action.mutate({ operation: 'recording-rename', id: active.id, name: rename });
            }}
          >
            <label>
              新文件名
              <input
                required
                maxLength={120}
                value={rename}
                onChange={(e) => setRename(e.target.value)}
              />
            </label>
            <button type="submit" className="native-button">
              重命名
            </button>
          </form>
          {confirm === active.id ? (
            <div className="native-tool-confirm">
              <p>确认将“{active.name}”移到可恢复暂存区？</p>
              <button type="button" className="native-button" onClick={() => setConfirm(null)}>
                取消
              </button>
              <button
                type="button"
                className="native-button"
                disabled={action.isPending}
                onClick={() => {
                  action.mutate({ operation: 'recording-remove', id: active.id });
                  setConfirm(null);
                }}
              >
                确认移除
              </button>
            </div>
          ) : (
            <button type="button" className="native-button" onClick={() => setConfirm(active.id)}>
              移除视频
            </button>
          )}
        </section>
      )}
      {files.length === 0 && (
        <p className="native-tool-empty">
          {query.data?.roots.length ? '没有找到匹配的视频文件' : '请先添加录屏所在目录'}
        </p>
      )}
      <div className="native-recording-grid">
        {files.slice(page * 12, (page + 1) * 12).map((file) => (
          <div key={file.id}>
            <label className="native-checkbox">
              <input
                type="checkbox"
                aria-label={`选择${file.name}`}
                checked={checked.has(file.id)}
                onChange={(e) => {
                  setChecked((current) => {
                    const next = new Set(current);
                    if (e.target.checked) next.add(file.id);
                    else next.delete(file.id);
                    return next;
                  });
                  setBatchConsent(false);
                }}
              />
              选择视频
            </label>
            <button
              type="button"
              className="native-recording-card"
              key={file.id}
              onClick={() => {
                setSelected(file.id);
                setRename(file.name);
                setConfirm(null);
              }}
            >
              <VideoThumbnail file={file} />
              <strong>{file.name}</strong>
              <span>
                {bytes(file.bytes)} · {new Date(file.modifiedMs).toLocaleString('zh-CN')}
              </span>
            </button>
          </div>
        ))}
      </div>
      {files.length > 12 && (
        <div className="native-tool-actions">
          <button
            type="button"
            className="native-button"
            disabled={page === 0}
            onClick={() => setPage((value) => value - 1)}
          >
            上一页
          </button>
          <span>
            第 {page + 1} 页 / 共 {Math.ceil(files.length / 12)} 页
          </span>
          <button
            type="button"
            className="native-button"
            disabled={(page + 1) * 12 >= files.length}
            onClick={() => setPage((value) => value + 1)}
          >
            下一页
          </button>
        </div>
      )}
      {Boolean(query.data?.removed.length) && (
        <section>
          <h3>可恢复的文件</h3>
          {query.data?.removed.map((file) => (
            <div className="native-tool-list-row" key={file.id}>
              <span>{file.name}</span>
              {confirm === `purge:${file.id}` ? (
                <>
                  <span>永久删除不可恢复，确认删除此文件？</span>
                  <button
                    type="button"
                    className="native-button"
                    disabled={action.isPending}
                    onClick={() => {
                      action.mutate({ operation: 'recording-purge', id: file.id, consent: true });
                      setConfirm(null);
                    }}
                  >
                    确认永久删除
                  </button>
                  <button type="button" className="native-button" onClick={() => setConfirm(null)}>
                    取消
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="native-button"
                  onClick={() => setConfirm(`purge:${file.id}`)}
                >
                  永久删除
                </button>
              )}
              <button
                type="button"
                className="native-button"
                disabled={action.isPending}
                onClick={() => action.mutate({ operation: 'recording-restore', id: file.id })}
              >
                恢复原位置
              </button>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
