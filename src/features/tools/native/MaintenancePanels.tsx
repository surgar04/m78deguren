import { useState } from 'react';
import {
  downloadsSchema,
  externalSchema,
  runtimeJobSchema,
  runtimesSchema,
} from '@/lib/tool-contracts';
import { useToolAction, useToolQuery } from './hooks';
import { Feedback } from './Feedback';
import { bytes } from './format';

export function RuntimePanel() {
  const query = useToolQuery('runtime-detect', runtimesSchema);
  const status = useToolQuery('runtime-status', runtimeJobSchema, 700);
  const downloads = useToolQuery('downloads-list', downloadsSchema, 1000);
  const action = useToolAction();
  const [consent, setConsent] = useState(false);
  const job = status.data;
  const busy = job && ['downloading', 'verifying', 'installing', 'unknown'].includes(job.phase);
  const task = downloads.data?.find((item) => item.id === job?.downloadId);
  return (
    <div className="native-tool-panel">
      <p className="native-tool-note">
        检测是只读操作。选择一项后仅下载并验证微软签名；安装前需逐项确认对 Windows
        系统目录与注册表的写入。安装包和应用日志保存在应用数据目录。
      </p>
      <button
        type="button"
        className="native-button"
        disabled={query.isFetching}
        onClick={() => {
          void query.refetch();
        }}
      >
        重新检测组件
      </button>
      <Feedback
        pending={query.isFetching || action.isPending}
        error={query.error || status.error || action.error}
      />
      <div className="native-runtime-list">
        {query.data?.components.map((component) => (
          <div className="native-tool-list-row" key={component.id}>
            <div>
              <strong>{component.name}</strong>
              <p>
                {component.complete
                  ? '已检测到组件'
                  : component.installed
                    ? '检测到安装记录，部分文件缺失'
                    : '未检测到系统安装'}
                {component.version ? ' · ' + component.version : ''}
              </p>
            </div>
            <button
              type="button"
              className="native-button"
              disabled={Boolean(busy) || action.isPending}
              onClick={() => {
                setConsent(false);
                action.mutate({ operation: 'runtime-prepare', id: component.id });
              }}
            >
              准备{component.installed ? '修复' : '安装'}包
            </button>
          </div>
        ))}
      </div>
      {job?.phase && (
        <section className="native-tool-confirm">
          <h3>{job.name}</h3>
          <p role="status">{job.message}</p>
          {task && job.phase === 'downloading' && (
            <>
              <progress
                aria-label="运行库下载进度"
                max={task.total ?? undefined}
                value={task.total ? task.downloaded : undefined}
              />
              <p>
                {bytes(task.downloaded)} / {task.total ? bytes(task.total) : '探测中'} ·{' '}
                {bytes(task.bytesPerSecond)}/s
              </p>
            </>
          )}
          {job.publisher && <p>签名者：{job.publisher}</p>}
          {job.sha256 && <code className="native-tool-hash">SHA256 {job.sha256}</code>}
          {job.phase === 'ready' && (
            <>
              <label className="native-checkbox">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                我确认仅安装此项已验证运行库，允许写入 Windows 系统目录及注册表
              </label>
              <button
                type="button"
                className="mint-button"
                disabled={!consent || action.isPending}
                onClick={() => {
                  if (job.token)
                    action.mutate({
                      operation: 'runtime-install',
                      token: job.token,
                      consent: true,
                    });
                }}
              >
                确认并请求管理员安装
              </button>
            </>
          )}
          {job.exitCode !== null && (
            <p>
              安装器退出码：{job.exitCode}
              {job.restartRequired ? ' · 需要重启' : ''}
            </p>
          )}
          {job.phase === 'complete' && (
            <button
              type="button"
              className="native-button"
              onClick={() => {
                void query.refetch();
              }}
            >
              核对安装后的实际状态
            </button>
          )}
        </section>
      )}
      <p className="native-tool-note">
        .NET Framework 与现代 .NET SDK 不同；旧 DirectX 组件不会升级系统 DirectX
        主版本。旧版组件可能不适用于当前系统；失败会返回真实退出码。
      </p>
    </div>
  );
}
export function ExternalPanel() {
  const query = useToolQuery('external-catalog', externalSchema);
  const action = useToolAction();
  const [search, setSearch] = useState('');
  return (
    <div className="native-tool-panel">
      <p className="native-tool-note">
        下列是独立第三方产品的官方来源。此入口不会代替这些软件的功能，也不会静默运行下载的可执行文件。需要下载时可在下载工具中使用你核对过的官方链接。
      </p>
      <label className="native-tool-search">
        搜索外部工具
        <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} />
      </label>
      <Feedback pending={query.isPending || action.isPending} error={query.error || action.error} />
      {query.data
        ?.filter((tool) =>
          (tool.name + ' ' + tool.description).toLowerCase().includes(search.toLowerCase()),
        )
        .map((tool) => (
          <div className="native-tool-list-row" key={tool.id}>
            <div>
              <strong>{tool.name}</strong>
              <p>{tool.description}</p>
              <small>{tool.website}</small>
            </div>
            <button
              type="button"
              className="native-button"
              onClick={() => action.mutate({ operation: 'external-open', id: tool.id })}
            >
              访问官方来源
            </button>
          </div>
        ))}
    </div>
  );
}
