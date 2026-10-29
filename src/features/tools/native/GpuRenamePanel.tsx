import { useState } from 'react';
import { gpuSnapshotSchema } from '@/lib/builtin-contracts';
import { useBuiltinQuery } from './builtin-hooks';
import { SystemChangeHistory, SystemChangeReview } from './SystemChangeReview';
import { useSystemChange } from './use-system-change';
import { Feedback } from './Feedback';

/** 名称改写与真实 GPU 能力严格分开展示，原值恢复按每次操作备份处理。 */
export function GpuRenamePanel() {
  const query = useBuiltinQuery({ operation: 'query', tool: 'gpus' }, gpuSnapshotSchema);
  const control = useSystemChange();
  const [selected, setSelected] = useState('');
  const [name, setName] = useState('');
  const gpu = query.data?.gpus.find((value) => value.id === selected) ?? query.data?.gpus[0];
  return (
    <div className="native-tool-panel">
      <p className="native-tool-note">
        修改 Windows 设备显示名称，不改变显存、硬件规格或性能。每次变更保存原值，可从下方记录恢复。
      </p>
      <div className="native-tool-form">
        <label>
          目标显卡
          <select value={gpu?.id ?? ''} onChange={(e) => setSelected(e.target.value)}>
            {query.data?.gpus.map((value) => (
              <option key={value.id} value={value.id}>
                {value.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          新显示名称
          <input
            maxLength={80}
            value={name}
            placeholder="输入自定义显卡名称"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
      </div>
      {gpu && (
        <p>
          当前：{gpu.name} · 驱动 {gpu.driver} · {gpu.status}
        </p>
      )}
      <div className="native-preset-buttons">
        {[
          'NVIDIA GeForce RTX 4090',
          'NVIDIA GeForce RTX 3060',
          'AMD Radeon RX 7900 XTX',
          'Intel Arc A770',
        ].map((value) => (
          <button
            className="native-button"
            type="button"
            key={value}
            onClick={() => setName(value)}
          >
            {value}
          </button>
        ))}
      </div>
      <div className="native-tool-actions">
        <button
          className="mint-button"
          type="button"
          disabled={!gpu || !name.trim() || control.busy}
          onClick={() => {
            if (gpu) control.prepare({ kind: 'gpu-rename', id: gpu.id, name: name.trim() });
          }}
        >
          预览名称改写
        </button>
        <button
          className="native-button"
          type="button"
          disabled={!query.data?.gpus.length || control.busy}
          onClick={() => control.prepare({ kind: 'gpu-restart' })}
        >
          重启显卡驱动…
        </button>
      </div>
      <Feedback pending={query.isPending} error={query.error} />
      <SystemChangeReview control={control} />
      <SystemChangeHistory control={control} />
    </div>
  );
}
