import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { executeTool } from '@/lib/desktop';
import {
  ntpResultSchema,
  ntpServersSchema,
  speedSchema,
  toolRequestSchema,
} from '@/lib/tool-contracts';
import { useToolAction, useToolQuery } from './hooks';
import { Feedback } from './Feedback';
import { bytes } from './format';

export function SpeedPanel() {
  const query = useToolQuery('speed-status', speedSchema, 500);
  const action = useToolAction();
  const value = query.data;
  const [node, setNode] = useState<'cloudflare' | 'nuaa' | 'zju' | 'ustc'>('cloudflare');
  const [connections, setConnections] = useState<1 | 4 | 8>(4);
  return (
    <div className="native-tool-panel">
      <p className="native-tool-note">
        延迟为 HTTP 往返中位数，抖动为相邻成功样本的延迟差均值，失败率为 HTTP 探测失败比例（不是
        ICMP 丢包率）。流量上限约 36 MiB，上传不读取文件。高校节点可能限制校外访问；非 Cloudflare
        节点的上传使用南航 HTTP 服务，界面明确显示，不静默更换节点。
      </p>
      <div className="native-tool-form">
        <label>
          测试节点
          <select
            value={node}
            disabled={value?.running}
            onChange={(e) => {
              const result = z
                .enum(['cloudflare', 'nuaa', 'zju', 'ustc'])
                .safeParse(e.target.value);
              if (result.success) setNode(result.data);
            }}
          >
            <option value="cloudflare">Cloudflare · HTTPS</option>
            <option value="nuaa">南京航空航天大学 · HTTP</option>
            <option value="zju">浙江大学 · HTTP · 上传南航</option>
            <option value="ustc">中国科学技术大学 · HTTPS · 上传南航 HTTP</option>
          </select>
        </label>
        <label>
          并行连接
          <select
            value={connections}
            disabled={value?.running}
            onChange={(e) => {
              const number = Number(e.target.value);
              if (number === 1 || number === 4 || number === 8) setConnections(number);
            }}
          >
            {[1, 4, 8].map((number) => (
              <option key={number} value={number}>
                {number} 个连接
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="native-tool-metrics">
        {[
          ['HTTP延迟', value?.latencyMs, 'ms'],
          ['下载', value?.downloadMbps, 'Mbps'],
          ['上传', value?.uploadMbps, 'Mbps'],
          ['HTTP 抖动', value?.jitterMs, 'ms'],
          ['HTTP 探测失败率', value?.failurePercent, '%'],
        ].map(([label, number, unit]) => (
          <div key={String(label)}>
            <span>{label}</span>
            <strong>{typeof number === 'number' ? number.toFixed(2) : '—'}</strong>
            <small>{unit}</small>
          </div>
        ))}
      </div>
      <div className="native-tool-actions">
        <button
          type="button"
          className="mint-button"
          disabled={value?.running || action.isPending}
          onClick={() => action.mutate({ operation: 'speed-start', node, connections })}
        >
          开始测速
        </button>
        <button
          type="button"
          className="native-button"
          disabled={!value?.running || action.isPending}
          onClick={() => action.mutate({ operation: 'speed-stop' })}
        >
          停止
        </button>
      </div>
      {Boolean(value?.series.length) && (
        <svg
          className="native-speed-chart"
          viewBox="0 0 600 180"
          role="img"
          aria-label="实际测速吞吐变化，绿色下载、蓝色上传"
        >
          {(['download', 'upload'] as const).map((phase) => {
            const points = value?.series.filter((point) => point.phase === phase) ?? [];
            const maximum = Math.max(1, ...(value?.series.map((point) => point.mbps) ?? []));
            return (
              <polyline
                key={phase}
                fill="none"
                stroke={phase === 'download' ? '#13b99b' : '#397fea'}
                strokeWidth="2"
                points={points
                  .map(
                    (point) =>
                      `${12 + (Math.min(point.seconds, 13) / 13) * 576},${165 - (point.mbps / maximum) * 150}`,
                  )
                  .join(' ')}
              />
            );
          })}
        </svg>
      )}
      <p role="status">
        {value?.message || '尚未进行测速'}
        {value?.transferred ? ' · 实际传输 ' + bytes(value.transferred) : ''}
      </p>
      <Feedback pending={action.isPending || query.isPending} error={action.error || query.error} />
    </div>
  );
}
export function TimePanel() {
  const servers = useToolQuery('ntp-servers', ntpServersSchema);
  const [server, setServer] = useState('aliyun');
  const [consent, setConsent] = useState(false);
  const probe = useMutation({
    mutationFn: async () => {
      const request = toolRequestSchema.parse({ operation: 'ntp-query', server });
      return executeTool(request, ntpResultSchema);
    },
  });
  const apply = useMutation({
    mutationFn: async (token: string) =>
      executeTool({ operation: 'ntp-apply', token, consent: true }, z.number().finite()),
  });
  const result = probe.data;
  return (
    <div className="native-tool-panel">
      <div className="native-tool-form">
        <label>
          NTP时间服务器
          <select
            value={server}
            onChange={(e) => {
              setServer(e.target.value);
              probe.reset();
              setConsent(false);
            }}
          >
            {servers.data?.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · {item.host}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="mint-button"
          disabled={probe.isPending || apply.isPending}
          onClick={() => {
            setConsent(false);
            probe.mutate();
          }}
        >
          查询时间偏差
        </button>
      </div>
      {result && (
        <dl className="native-tool-facts">
          <div>
            <dt>本机时间（UTC）</dt>
            <dd>{new Date(result.localTimeMs).toISOString()}</dd>
          </div>
          <div>
            <dt>服务器时间（UTC）</dt>
            <dd>{new Date(result.serverTimeMs).toISOString()}</dd>
          </div>
          <div>
            <dt>时钟偏差</dt>
            <dd>
              {result.offsetMs >= 0 ? '+' : ''}
              {result.offsetMs.toFixed(3)} ms
            </dd>
          </div>
          <div>
            <dt>网络往返</dt>
            <dd>
              {result.delayMs.toFixed(3)} ms · Stratum {result.stratum}
            </dd>
          </div>
        </dl>
      )}
      <p className="native-tool-note">
        查询不修改系统。应用校时前会重新探测；检测令牌60秒有效，偏差超过一天会拒绝自动校时。校时需要以管理员身份运行臻境。
      </p>
      <label className="native-checkbox">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        我已核对偏差，确认修改 Windows 系统时间
      </label>
      <button
        type="button"
        className="native-button"
        disabled={!consent || !result || apply.isPending || probe.isPending}
        onClick={() => {
          if (result) apply.mutate(result.token);
        }}
      >
        应用校时
      </button>
      <Feedback
        pending={probe.isPending || apply.isPending || servers.isPending}
        error={probe.error || apply.error || servers.error}
        success={
          apply.isSuccess ? '系统返回校时完成：' + new Date(apply.data).toISOString() : undefined
        }
      />
    </div>
  );
}
