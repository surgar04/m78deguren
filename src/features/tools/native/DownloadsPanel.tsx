import { useState } from 'react';
import { downloadInputSchema, downloadsSchema, downloadSettingsSchema } from '@/lib/tool-contracts';
import { useToolAction, useToolQuery } from './hooks';
import { Feedback } from './Feedback';
import { bytes } from './format';

/** 任务进度、速度、校验值全部来自Rust，页面只保存尚未提交的表单。 */
export function DownloadsPanel() {
  const query = useToolQuery('downloads-list', downloadsSchema, 700);
  const settings = useToolQuery('downloads-settings', downloadSettingsSchema);
  const [globalLimit, setGlobalLimit] = useState<number | null>(null);
  const action = useToolAction();
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [connections, setConnections] = useState(4);
  const [limit, setLimit] = useState(0);
  const [hash, setHash] = useState('');
  const [formError, setFormError] = useState('');
  return (
    <div className="native-tool-panel">
      <form
        className="native-tool-actions"
        onSubmit={(event) => {
          event.preventDefault();
          action.mutate({
            operation: 'download-limit',
            limitKib: globalLimit ?? settings.data?.limitKib ?? 0,
          });
        }}
      >
        <label>
          全局限速（KiB/s，0为不限）
          <input
            aria-label="全局下载限速"
            type="number"
            min={0}
            max={1_048_576}
            value={globalLimit ?? settings.data?.limitKib ?? 0}
            onChange={(event) => setGlobalLimit(Number(event.target.value))}
          />
        </label>
        <button
          className="native-button"
          type="submit"
          disabled={action.isPending || !settings.data}
        >
          保存全局限速
        </button>
      </form>
      <form
        className="native-tool-form"
        onSubmit={(event) => {
          event.preventDefault();
          const input = downloadInputSchema.safeParse({
            url,
            fileName: name,
            connections,
            limitKib: limit,
            expectedSha256: hash.trim() || null,
          });
          if (!input.success) {
            setFormError(input.error.issues.map((issue) => issue.message).join('；'));
            return;
          }
          setFormError('');
          action.mutate({ operation: 'download-create', input: input.data });
        }}
      >
        <label className="native-full-width">
          下载链接
          <input
            type="url"
            required
            value={url}
            maxLength={4096}
            placeholder="https://…"
            onChange={(e) => {
              setUrl(e.target.value);
              if (!name) {
                try {
                  const part = new URL(e.target.value).pathname.split('/').at(-1);
                  if (part) setName(decodeURIComponent(part).slice(0, 120));
                } catch {
                  /* 未输入完整URL时不改写文件名。 */
                }
              }
            }}
          />
        </label>
        <label>
          文件名称
          <input required value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          最大连接数
          <select value={connections} onChange={(e) => setConnections(Number(e.target.value))}>
            {[1, 2, 4, 6, 8].map((value) => (
              <option key={value} value={value}>
                {value} 个连接
              </option>
            ))}
          </select>
        </label>
        <label>
          任务限速（KiB/s，0为不限）
          <input
            type="number"
            min={0}
            max={1_048_576}
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
          />
        </label>
        <label>
          预期 SHA256（可选）
          <input
            value={hash}
            maxLength={64}
            onChange={(e) => setHash(e.target.value)}
            placeholder="64位十六进制校验值"
          />
        </label>
        <button type="submit" className="mint-button" disabled={action.isPending}>
          新建下载
        </button>
      </form>
      <p className="native-tool-note">
        下载与分段缓存保存在应用数据目录。完成后可复制至你选择的本地目录；服务器不支持分段时使用单连接。
        重启应用后可恢复有验证器的未完成任务。
      </p>
      <Feedback
        pending={action.isPending || query.isPending}
        error={formError || action.error || query.error || settings.error}
      />
      <div className="native-tool-section-heading">
        <h3>下载任务</h3>
        <button
          type="button"
          className="native-button"
          onClick={() => {
            void query.refetch();
          }}
        >
          重新扫描
        </button>
      </div>
      {query.data?.length === 0 && <p className="native-tool-empty">尚无下载任务</p>}
      {query.data?.map((task) => (
        <article className="native-download-task" key={task.id}>
          <div className="native-tool-section-heading">
            <h4>{task.fileName}</h4>
            <span>
              {
                {
                  paused: '已暂停',
                  probing: '探测资源',
                  running: '下载中',
                  pausing: '正在暂停',
                  cancelling: '正在取消',
                  cancelled: '已取消',
                  complete: '已完成',
                  failed: '失败',
                }[task.status]
              }
            </span>
          </div>
          <progress
            aria-label={task.fileName + '下载进度'}
            max={task.total ?? undefined}
            value={task.total ? Math.min(task.downloaded, task.total) : undefined}
          />
          <p>
            {bytes(task.downloaded)} / {task.total === null ? '大小待确定' : bytes(task.total)} ·{' '}
            {bytes(task.bytesPerSecond)}/s
          </p>
          {task.message && (
            <p
              className={
                task.status === 'failed' ? 'native-tool-feedback error' : 'native-tool-note'
              }
            >
              {task.message}
            </p>
          )}
          {task.sha256 && <code className="native-tool-hash">SHA256 {task.sha256}</code>}
          <div className="native-tool-actions">
            {['running', 'probing'].includes(task.status) && (
              <button
                type="button"
                className="native-button"
                disabled={action.isPending}
                onClick={() =>
                  action.mutate({ operation: 'download-action', id: task.id, action: 'pause' })
                }
              >
                暂停
              </button>
            )}
            {['paused', 'failed'].includes(task.status) && (
              <button
                type="button"
                className="native-button"
                disabled={action.isPending}
                onClick={() =>
                  action.mutate({ operation: 'download-action', id: task.id, action: 'resume' })
                }
              >
                恢复 / 重试
              </button>
            )}
            {!['complete', 'cancelled', 'pausing', 'cancelling'].includes(task.status) && (
              <button
                type="button"
                className="native-button"
                disabled={action.isPending}
                onClick={() =>
                  action.mutate({ operation: 'download-action', id: task.id, action: 'cancel' })
                }
              >
                取消任务
              </button>
            )}
            {task.status === 'complete' && (
              <>
                {!/\.(exe|msi|msix|bat|cmd|ps1|vbs|js|lnk|scr|com|hta|reg|url|website|jse|vbe|wsf|wsh|cpl|psm1|psd1|msixbundle|appx|appxbundle|appinstaller|msp|mst|jar|py|pyw|rb|pl|sh)$/iu.test(
                  task.fileName,
                ) && (
                  <button
                    type="button"
                    className="native-button"
                    onClick={() =>
                      action.mutate({ operation: 'download-file', id: task.id, action: 'open' })
                    }
                  >
                    打开文件
                  </button>
                )}
                <button
                  type="button"
                  className="native-button"
                  onClick={() =>
                    action.mutate({ operation: 'download-file', id: task.id, action: 'reveal' })
                  }
                >
                  定位文件
                </button>
                <button
                  type="button"
                  className="native-button"
                  onClick={() =>
                    action.mutate({ operation: 'download-file', id: task.id, action: 'copy' })
                  }
                >
                  另存到本地目录
                </button>
              </>
            )}
            {!['running', 'probing', 'pausing', 'cancelling'].includes(task.status) && (
              <button
                type="button"
                className="native-button"
                disabled={action.isPending}
                onClick={() =>
                  action.mutate({ operation: 'download-action', id: task.id, action: 'remove' })
                }
              >
                移除记录{task.status === 'complete' ? '（保留文件）' : ''}
              </button>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}
