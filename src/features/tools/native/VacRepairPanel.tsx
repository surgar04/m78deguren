import { vacSnapshotSchema } from '@/lib/builtin-contracts';
import { useBuiltinQuery } from './builtin-hooks';
import { SystemChangeReview } from './SystemChangeReview';
import { useSystemChange } from './use-system-change';
import { Feedback } from './Feedback';

export function VacRepairPanel() {
  const query = useBuiltinQuery({ operation: 'query', tool: 'vac' }, vacSnapshotSchema);
  const control = useSystemChange();
  return (
    <div className="native-tool-panel">
      <p className="native-tool-note">
        修复 Steam 服务及本地 Windows 配置，不提供账号或服务器封禁解除。操作会关闭并重新启动
        Steam，请先保存游戏进度。
      </p>
      <dl className="native-spec-grid">
        <div>
          <dt>Steam 安装</dt>
          <dd>{query.data ? (query.data.installed ? '已检测到' : '未检测到') : '读取中'}</dd>
        </div>
        <div>
          <dt>服务文件</dt>
          <dd>{query.data ? (query.data.serviceExists ? '存在' : '未找到') : '读取中'}</dd>
        </div>
        <div>
          <dt>Steam 进程</dt>
          <dd>{query.data ? (query.data.running ? '运行中' : '未运行') : '读取中'}</dd>
        </div>
        <div>
          <dt>当前权限</dt>
          <dd>{query.data ? (query.data.admin ? '管理员' : '需要 UAC 确认') : '读取中'}</dd>
        </div>
      </dl>
      {query.data?.path && <p className="native-path">{query.data.path}</p>}
      <div className="native-tool-actions">
        <button
          type="button"
          className="mint-button"
          disabled={!query.data?.serviceExists || control.busy}
          onClick={() => control.prepare({ kind: 'vac-repair' })}
        >
          查看修复步骤并确认…
        </button>
        <button
          className="native-button"
          type="button"
          disabled={query.isFetching}
          onClick={() => {
            void query.refetch();
          }}
        >
          重新检测
        </button>
      </div>
      <Feedback pending={query.isPending} error={query.error} />
      <SystemChangeReview control={control} />
    </div>
  );
}
