import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { executeTool, executeSteam } from '@/lib/desktop';
import { runtimesSchema } from '@/lib/tool-contracts';
import { setupJobSchema } from '@/lib/onboarding-contracts';
import { steamSnapshotSchema } from '@/lib/steam-contracts';
import { useSteam } from '@/features/library/repository';
import { useStorage, useSetupAction, useRuntimeStatus } from './repository';
import { Failure, Consent } from './controls';
export function RuntimeStep() {
  const client = useQueryClient(),
    [consent, setConsent] = useState(false);
  const scan = useQuery({
    queryKey: ['onboarding', 'runtimes'],
    queryFn: () => executeTool({ operation: 'runtime-detect' }, runtimesSchema),
    retry: false,
    staleTime: 30000,
  });
  const job = useRuntimeStatus();
  const action = useMutation({
    mutationFn: (
      request:
        | { operation: 'runtime-prepare'; id: string }
        | { operation: 'runtime-install'; token: string; consent: true },
    ) => executeTool(request, z.null()),
  });
  useEffect(() => {
    if (job.data?.phase === 'complete') {
      void client.invalidateQueries({ queryKey: ['onboarding', 'runtimes'] });
    }
  }, [job.data?.phase, client]);
  const busy =
    action.isPending ||
    ['downloading', 'verifying', 'installing', 'unknown'].includes(job.data?.phase ?? '');
  return (
    <>
      <p className="setup-lead">
        检查游戏常用的 VC++、.NET Framework 和 DirectX 兼容组件。只补全缺失项，不下载来历不明的“DLL
        修复包”。
      </p>
      <Failure error={scan.error ?? job.error ?? action.error} />
      {scan.isPending && <p>正在检查组件与文件…</p>}
      <ul className="setup-runtime-list">
        {scan.data?.components.map((component) => (
          <li key={component.id}>
            <div>
              <strong>{component.name}</strong>
              <span>
                {component.complete ? '完整' : component.installed ? '已安装但文件不完整' : '缺失'}
                {component.version ? ` · ${component.version}` : ''}
              </span>
            </div>
            {!component.complete && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setConsent(false);
                  action.mutate({ operation: 'runtime-prepare', id: component.id });
                }}
              >
                自动下载并验证
              </button>
            )}
          </li>
        ))}
      </ul>
      {job.data?.message && (
        <p role="status">
          {job.data.name}：{job.data.message}
        </p>
      )}
      {job.data?.phase === 'ready' && (
        <div className="setup-install-confirm">
          <p>签名：{job.data.publisher}</p>
          <code>SHA256 {job.data.sha256}</code>
          <Consent checked={consent} onChange={setConsent}>
            我确认安装当前这一项运行库，允许微软安装器请求管理员权限并写入 Windows
            系统目录及注册表；恢复入口为 Windows 已安装的应用。
          </Consent>
          <button
            type="button"
            className="setup-primary"
            disabled={!consent || busy || !job.data.token}
            onClick={() => {
              if (job.data?.token)
                action.mutate({
                  operation: 'runtime-install',
                  token: job.data.token,
                  consent: true,
                });
            }}
          >
            安装此组件
          </button>
        </div>
      )}
      {job.data?.restartRequired && (
        <p className="setup-note">该组件要求重启，请保存工作后自行重启 Windows；向导会保留进度。</p>
      )}
    </>
  );
}
export function SteamStep() {
  const client = useQueryClient(),
    steam = useSteam(),
    storage = useStorage(),
    [drive, setDrive] = useState(''),
    [consent, setConsent] = useState(false);
  const locate = useSetupAction(z.null());
  const prepare = useSetupAction(z.object({ token: z.uuid(), publisher: z.string() }).strict()),
    install = useSetupAction(setupJobSchema);
  const refresh = useMutation({
    mutationFn: () => executeSteam({ operation: 'snapshot', refresh: true }, steamSnapshotSchema),
    onSuccess: (data) => client.setQueryData(['steam', 'snapshot'], data),
  });
  const selected =
    drive ||
    storage.data?.volumes.find((volume) => volume.letter !== storage.data?.systemDrive)?.letter ||
    storage.data?.systemDrive ||
    '';
  const busy = prepare.isPending || install.isPending || locate.isPending || refresh.isPending;
  return (
    <>
      <p className="setup-lead">读取 Steam 位置、游戏库目录和本机账号，保存到本机档案。</p>
      <Failure
        error={steam.error ?? locate.error ?? prepare.error ?? install.error ?? refresh.error}
      />
      {steam.isPending ? (
        <p>正在搜索注册表、进程、常见目录及磁盘位置…</p>
      ) : steam.data?.installed ? (
        <>
          <div className="setup-detail">
            <strong>已找到 Steam</strong>
            <span>{steam.data.path}</span>
            <span>
              {steam.data.libraries.length} 个库目录 ·{' '}
              {steam.data.games.filter((game) => game.installed).length} 款已安装游戏
            </span>
          </div>
          {steam.data.libraries.map((library) => (
            <p key={library.id}>
              {library.path} · {library.games} 款游戏
            </p>
          ))}
        </>
      ) : (
        <>
          <p>未在已搜索的位置找到 Steam。非标准目录可先手动定位；仍未安装时可选择磁盘自动安装。</p>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              locate.mutate({ operation: 'steam-pick' }, { onSuccess: () => refresh.mutate() })
            }
          >
            手动选择已有 Steam
          </button>
          <div className="setup-detail">
            <label>
              安装磁盘
              <select
                value={selected}
                disabled={busy}
                onChange={(event) => setDrive(event.target.value)}
              >
                {storage.data?.volumes.map((volume) => (
                  <option key={volume.letter} value={volume.letter}>
                    {volume.letter}: · 可用 {(volume.freeBytes / 1073741824).toFixed(1)} GiB
                  </option>
                ))}
              </select>
            </label>
            <p>目标：{selected}:\Steam。仅使用 Steam 官方安装器，不覆盖非空目录。</p>
            <button
              type="button"
              disabled={busy || !selected}
              onClick={() => prepare.mutate({ operation: 'steam-prepare' })}
            >
              {prepare.isPending ? '正在下载并验证 Valve 签名…' : '准备官方安装器'}
            </button>
            {prepare.data && (
              <>
                <p>已验证：{prepare.data.publisher}</p>
                <Consent checked={consent} onChange={setConsent}>
                  我同意 Steam 的安装许可并确认在所选磁盘安装，允许官方安装器注册客户端与卸载信息。
                </Consent>
                <button
                  type="button"
                  className="setup-primary"
                  disabled={!consent || busy}
                  onClick={() =>
                    install.mutate(
                      {
                        operation: 'steam-install',
                        token: prepare.data.token,
                        drive: selected,
                        consent: true,
                      },
                      { onSuccess: () => refresh.mutate() },
                    )
                  }
                >
                  自动安装 Steam
                </button>
              </>
            )}
          </div>
        </>
      )}
      <button type="button" disabled={busy} onClick={() => refresh.mutate()}>
        重新搜索并保存游戏库
      </button>
      {install.data && <p role="status">{install.data.message}</p>}
    </>
  );
}
