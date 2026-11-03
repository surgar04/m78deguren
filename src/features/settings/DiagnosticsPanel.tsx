import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { executeDiagnostics, errorMessage } from '@/lib/desktop';
import { diagnosticSnapshotSchema, type DiagnosticRequest } from '@/lib/diagnostic-contracts';
import { Modal } from '@/features/home/components/Modal';
import { bytes } from './format';

/** 日志不复制为本地状态；筛选和弹窗属于 UI，记录及详细模式始终以原生状态为准。 */
export function DiagnosticsPanel() {
  const [open, setOpen] = useState(false),
    [level, setLevel] = useState<'all' | 'error' | 'warn' | 'info' | 'debug'>('all'),
    [search, setSearch] = useState(''),
    [paused, setPaused] = useState(false),
    [clear, setClear] = useState(false),
    [notice, setNotice] = useState('');
  const query = useQuery({
    queryKey: ['diagnostics', level, search],
    queryFn: () =>
      executeDiagnostics({ operation: 'read', level, search }, diagnosticSnapshotSchema),
    enabled: open,
    retry: false,
    refetchInterval: open && !paused ? 5000 : false,
  });
  const action = useMutation({
    mutationFn: (request: DiagnosticRequest) => executeDiagnostics(request, z.unknown()),
    onSuccess: (result) => {
      void query.refetch();
      setNotice(
        z.object({ saved: z.literal(false) }).safeParse(result).success
          ? '已取消导出，未写入文件'
          : z.object({ saved: z.literal(true) }).safeParse(result).success
            ? '脱敏诊断包已保存'
            : '操作已完成',
      );
    },
    onError: () => setNotice('操作未完成，请查看错误说明'),
  });
  return (
    <section className="diagnostics-settings">
      <h3>日志与诊断</h3>
      <p>
        本地分级日志、自动轮转和脱敏诊断包。默认不记录账号、凭据、请求正文或环境变量，不自动上传。
      </p>
      <div className="settings-actions">
        <button type="button" onClick={() => setOpen(true)}>
          查看应用日志
        </button>
        <button
          type="button"
          disabled={action.isPending}
          onClick={() => action.mutate({ operation: 'open' })}
        >
          打开日志目录
        </button>
        <button
          type="button"
          disabled={action.isPending}
          onClick={() => action.mutate({ operation: 'export' })}
        >
          导出脱敏诊断包
        </button>
      </div>
      {action.error && <p role="alert">{errorMessage(action.error)}</p>}
      <span role="status">{notice}</span>
      {open && (
        <Modal
          title="应用日志与诊断"
          onClose={() => setOpen(false)}
          wide
          className="diagnostics-dialog"
        >
          {action.error && <p role="alert">{errorMessage(action.error)}</p>}
          <span role="status">{notice}</span>
          <p>
            单文件 2 MiB，最多保留 6 份应用日志，历史保留 14 天。详细模式 30
            分钟后自动关闭，仍执行脱敏。
          </p>
          {query.data?.previousUnclean && (
            <p role="alert">
              上次会话没有正常退出记录，可能是强制结束、崩溃或另一个实例；可导出诊断协助排查。
            </p>
          )}
          <div className="diagnostics-toolbar">
            <label>
              级别
              <select
                value={level}
                onChange={(e) =>
                  setLevel(z.enum(['all', 'error', 'warn', 'info', 'debug']).parse(e.target.value))
                }
              >
                {['all', 'error', 'warn', 'info', 'debug'].map((v) => (
                  <option key={v} value={v}>
                    {v === 'all' ? '全部' : v}
                  </option>
                ))}
              </select>
            </label>
            <label>
              搜索
              <input
                value={search}
                maxLength={120}
                placeholder="模块、事件或诊断代码"
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <button type="button" onClick={() => setPaused(!paused)}>
              {paused ? '自动刷新' : '暂停刷新'}
            </button>
            <button
              type="button"
              disabled={query.isFetching}
              onClick={() => {
                void query.refetch();
              }}
            >
              刷新
            </button>
          </div>
          <div className="settings-actions">
            <button
              type="button"
              disabled={action.isPending}
              onClick={() =>
                action.mutate({
                  operation: 'detail',
                  enabled: !query.data?.detailed,
                })
              }
            >
              {query.data?.detailed ? '关闭详细模式' : '开启详细模式（30 分钟）'}
            </button>
            <button
              type="button"
              disabled={action.isPending}
              onClick={() => action.mutate({ operation: 'export' })}
            >
              导出诊断
            </button>
            <button type="button" onClick={() => setClear(true)}>
              清除诊断日志
            </button>
          </div>
          {clear && (
            <div role="alert" className="diagnostics-clear">
              <p>
                只清除应用诊断日志，操作不可恢复。不会删除账号、设置、游戏或更新安装记录。继续？
              </p>
              <button
                type="button"
                disabled={action.isPending}
                onClick={() => {
                  action.mutate({ operation: 'clear', consent: true });
                  setClear(false);
                }}
              >
                确认清除
              </button>
              <button type="button" onClick={() => setClear(false)}>
                取消
              </button>
            </div>
          )}
          {query.error && <p role="alert">{errorMessage(query.error)}</p>}
          {query.data && (
            <>
              <p>
                {query.data.version} · {query.data.files} 个文件 · {bytes(query.data.bytes)} · 会话{' '}
                {query.data.session}
                {query.data.dropped > 0 ? ` · 已限流合并 ${query.data.dropped} 条事件` : ''}
              </p>
              <div className="diagnostics-records" aria-label="日志记录">
                {query.data.entries.length === 0 ? (
                  <p>当前筛选下没有日志。</p>
                ) : (
                  query.data.entries.map((entry, index) => (
                    <details key={`${entry.at}/${entry.trace ?? ''}/${index}`}>
                      <summary>
                        <time>{entry.at}</time>
                        <strong data-level={entry.level}>{entry.level}</strong>
                        <span>
                          {entry.source} · {entry.event} {entry.operation ?? ''}
                        </span>
                      </summary>
                      <p>{entry.message || '无额外正文'}</p>
                      <code>
                        关联 ID：{entry.trace ?? '—'} · 耗时：{entry.durationMs ?? '—'} ms · 会话：
                        {entry.session}
                      </code>
                    </details>
                  ))
                )}
              </div>
            </>
          )}
        </Modal>
      )}
    </section>
  );
}
