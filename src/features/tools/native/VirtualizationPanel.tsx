import { virtualizationSnapshotSchema } from '@/lib/builtin-contracts';
import { useBuiltinQuery } from './builtin-hooks';
import { SystemChangeHistory, SystemChangeReview } from './SystemChangeReview';
import { useSystemChange } from './use-system-change';
import { Feedback } from './Feedback';

const enabled = (value: number | null | undefined) =>
  value === undefined || value === null ? '未配置 / 不可读' : value === 0 ? '关闭' : '开启';
export function VirtualizationPanel() {
  const query = useBuiltinQuery(
    { operation: 'query', tool: 'virtualization' },
    virtualizationSnapshotSchema,
  );
  const control = useSystemChange();
  return (
    <div className="native-tool-panel">
      <p className="native-tool-note">
        管理 Windows 的 VBS、内存完整性及 Hyper-V 启动设置。此工具不修改
        BIOS；关闭后会影响虚拟化软件和系统安全能力。
      </p>
      <dl className="native-spec-grid">
        <div>
          <dt>内存完整性</dt>
          <dd>{enabled(query.data?.memoryIntegrity)}</dd>
        </div>
        <div>
          <dt>VBS 配置</dt>
          <dd>{enabled(query.data?.vbs)}</dd>
        </div>
        <div>
          <dt>Hyper-V 启动类型</dt>
          <dd>{query.data?.hypervisorLaunch ?? '无法读取'}</dd>
        </div>
        <div>
          <dt>VBS 实际运行状态</dt>
          <dd>
            {query.data?.vbsRunning === 2
              ? '正在运行'
              : query.data?.vbsRunning === 1
                ? '已配置，未运行'
                : query.data?.vbsRunning === 0
                  ? '未运行'
                  : '无法读取'}
          </dd>
        </div>
      </dl>
      <div className="native-tool-actions">
        <button
          type="button"
          className="mint-button"
          disabled={!query.data || control.busy}
          onClick={() => control.prepare({ kind: 'virtualization', enabled: false })}
        >
          预览关闭相关设置
        </button>
        <button
          type="button"
          className="native-button"
          disabled={!query.data || control.busy}
          onClick={() => control.prepare({ kind: 'virtualization', enabled: true })}
        >
          预览启用相关设置
        </button>
        <button
          type="button"
          className="native-button"
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
      <SystemChangeHistory control={control} />
    </div>
  );
}
