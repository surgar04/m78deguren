import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { executeSettings } from '@/lib/desktop';
import { latencySchema, serverSchema } from '@/lib/settings-contracts';
import { useSettingsQuery, useNativePatch } from './repository';
import { Failure } from './controls';
import { useText } from './i18n';

export function NetworkPanel() {
  const navigate = useNavigate();
  const { t, locale } = useText();
  const client = useQueryClient();
  const servers = useSettingsQuery({ operation: 'network-sites' }, z.array(serverSchema).max(40));
  const patch = useNativePatch();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  // 测量结果只在 Query 缓存保存，组件不再复制一份服务响应。
  const results = useQuery({
    queryKey: ['settings-latency'],
    queryFn: () => Promise.resolve([]),
    initialData: [] as z.infer<typeof latencySchema>[],
    enabled: false,
  });
  const test = useMutation({
    mutationFn: (ids: string[]) =>
      executeSettings({ operation: 'network-test', ids }, z.array(latencySchema)),
    onSuccess: (rows) =>
      client.setQueryData<z.infer<typeof latencySchema>[]>(['settings-latency'], (previous) => [
        ...(previous ?? []).filter((item) => !rows.some((row) => row.id === item.id)),
        ...rows,
      ]),
  });
  return (
    <>
      <h2>{t('网络')}</h2>
      <div className="settings-actions">
        <button
          type="button"
          onClick={() => {
            void navigate('/tools/game-acceleration');
          }}
        >
          QuickFox · 游戏加速准备
        </button>
      </div>
      <p className="settings-note">
        海外国服游戏可通过官方客户端准备线路；客户端位置和退出提醒在“游戏加速”中管理。以下站点连通测试不代表游戏延迟。
      </p>
      <p className="settings-note">
        公网直连 HTTP HEAD 连通耗时，包括 DNS、TLS 和响应头，非 ICMP Ping。HTTP
        拒绝与网络失败分别展示；不访问本地、内网或重定向私有地址。
      </p>
      <Failure error={servers.error ?? patch.error ?? test.error} />
      <div className="settings-actions">
        <button
          type="button"
          disabled={!servers.data?.length || test.isPending}
          onClick={() => test.mutate(servers.data?.map((row) => row.id) ?? [])}
        >
          {t('全部测试')}
        </button>
      </div>
      <div className="settings-network-list">
        {servers.data?.map((server) => {
          const result = results.data.find((row) => row.id === server.id);
          return (
            <div className="settings-network-row" key={server.id}>
              <div>
                <strong>{server.name}</strong>
                <small>{server.url}</small>
              </div>
              <div>
                <strong>
                  {result
                    ? (result.error ??
                      `${result.elapsedMs?.toFixed(0)} ms · HTTP ${result.httpStatus}`)
                    : t('尚未测试')}
                </strong>
                {result && <small>{new Date(result.measuredAt).toLocaleTimeString(locale)}</small>}
              </div>
              <button
                type="button"
                disabled={test.isPending}
                onClick={() => test.mutate([server.id])}
              >
                {t('测试')}
              </button>
              {server.custom && (
                <button
                  type="button"
                  disabled={patch.isPending}
                  onClick={() => patch.patch({ kind: 'server-remove', id: server.id })}
                >
                  {t('删除')}
                </button>
              )}
            </div>
          );
        })}
      </div>
      <form
        className="settings-server-form"
        onSubmit={(event) => {
          event.preventDefault();
          patch.mutate(
            { operation: 'patch', patch: { kind: 'server-add', name, url } },
            {
              onSuccess: () => {
                setName('');
                setUrl('');
              },
            },
          );
        }}
      >
        <label>
          {t('名称')}
          <input
            required
            maxLength={60}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          HTTPS URL
          <input
            type="url"
            required
            maxLength={4096}
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://example.com/"
          />
        </label>
        <button type="submit" disabled={patch.isPending}>
          {t('添加服务器')}
        </button>
      </form>
    </>
  );
}
