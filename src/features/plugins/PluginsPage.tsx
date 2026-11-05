import { lazy, Suspense, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { PageHeader } from '@/components/PageHeader';
import { WorkspaceLayout } from '@/features/home/components/WorkspaceLayout';
import { Modal } from '@/features/home/components/Modal';
import { useGameWorkspace } from '@/features/home/useGameWorkspace';
import { errorMessage, isDesktop } from '@/lib/desktop';
import {
  PLUGIN_PERMISSION_NAMES,
  pluginPreviewSchema,
  type PluginPreview,
  type PluginRecord,
  type PluginPermissionId,
} from '@/lib/plugin-contracts';
import { usePlugins, usePluginAction } from './repository';
import { PluginView, PluginCommand } from './PluginView';
import './plugins.css';
const DuesTable = lazy(() => import('./dues/DuesTable'));

type Review =
  | { kind: 'install'; preview: PluginPreview }
  | { kind: 'permissions'; plugin: PluginRecord }
  | { kind: 'uninstall'; plugin: PluginRecord }
  | { kind: 'rollback'; plugin: PluginRecord }
  | { kind: 'safe'; enabled: boolean };
/** 复核组件以包摘要重新挂载，避免新版本沿用旧版本已勾选的授权与确认。 */
export function PluginReview({
  review,
  revision,
  onClose,
  onDone,
}: {
  review: Review;
  revision: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const manifest =
    review.kind === 'install'
      ? review.preview.manifest
      : 'plugin' in review
        ? review.plugin.manifest
        : null;
  const [grants, setGrants] = useState<PluginPermissionId[]>(
    review.kind === 'install'
      ? review.preview.manifest.permissions.filter((p) => !p.optional).map((p) => p.id)
      : review.kind === 'permissions'
        ? review.plugin.manifest.permissions
            .filter((p) => !p.optional || review.plugin.grants.includes(p.id))
            .map((p) => p.id)
        : [],
  );
  const [consent, setConsent] = useState(false),
    [purge, setPurge] = useState(false);
  const action = usePluginAction(z.null());
  const required = manifest?.permissions.filter((p) => !p.optional) ?? [];
  const canConfirm = consent && required.every((p) => grants.includes(p.id));
  function submit() {
    if (!consent) return;
    const request =
      review.kind === 'install'
        ? {
            operation: 'install' as const,
            ticket: review.preview.ticket,
            grants,
            revision,
            consent: true as const,
          }
        : review.kind === 'permissions'
          ? {
              operation: 'configure' as const,
              id: review.plugin.manifest.id,
              digest: review.plugin.digest,
              enabled: true,
              grants,
              revision,
              consent: true as const,
            }
          : review.kind === 'uninstall'
            ? {
                operation: 'uninstall' as const,
                id: review.plugin.manifest.id,
                purge,
                revision,
                consent: true as const,
              }
            : review.kind === 'rollback'
              ? {
                  operation: 'rollback' as const,
                  id: review.plugin.manifest.id,
                  revision,
                  consent: true as const,
                }
              : {
                  operation: 'safe-mode' as const,
                  enabled: review.enabled,
                  consent: true as const,
                };
    action.mutate(request, { onSuccess: onDone });
  }
  return (
    <Modal
      title={
        review.kind === 'install'
          ? '安装插件'
          : review.kind === 'permissions'
            ? '授权并启用插件'
            : review.kind === 'uninstall'
              ? '卸载插件'
              : review.kind === 'rollback'
                ? '回退插件版本'
                : '插件安全模式'
      }
      onClose={() => {
        if (!action.isPending) onClose();
      }}
    >
      {manifest && (
        <>
          <h3>
            {manifest.name} · {manifest.version}
          </h3>
          <p>{manifest.description}</p>
          <p className="plugin-secondary">
            组件内存 {manifest.limits.memoryMb} MiB · 私有数据 {manifest.limits.storageMb} MiB ·
            每次 {manifest.limits.timeoutMs} ms · 后台任务 {manifest.tasks.length} 项
          </p>
          <p className="plugin-secondary">
            {manifest.publisher} · {manifest.id}
          </p>
        </>
      )}
      {review.kind === 'install' && (
        <>
          <p className="plugin-message">
            {review.preview.publisherKey
              ? '签名有效；请核对以下发布者公钥指纹。签名不能代替对发布者的信任。'
              : '本地开发插件：未签名，仅用于开发调试。'}
          </p>
          <code className="plugin-fingerprint">{review.preview.publisherKey ?? '未签名'}</code>
          {review.preview.previous && (
            <p>
              将更新已安装的 {review.preview.previous}。新增或扩大权限：
              {review.preview.addedPermissions.join('、') || '无'}。
            </p>
          )}
        </>
      )}
      {(review.kind === 'install' || review.kind === 'permissions') && (
        <fieldset className="plugin-permissions">
          <legend>插件能力</legend>
          {manifest?.permissions.length === 0 && <p>此插件未申请宿主能力。</p>}
          {manifest?.permissions.map((permission) => (
            <label key={permission.id}>
              <input
                type="checkbox"
                checked={grants.includes(permission.id)}
                disabled={!permission.optional || action.isPending}
                onChange={(e) =>
                  setGrants((current) =>
                    e.target.checked
                      ? [...current, permission.id]
                      : current.filter((id) => id !== permission.id),
                  )
                }
              />
              <span>
                <strong>
                  {PLUGIN_PERMISSION_NAMES[permission.id]}
                  {permission.optional ? '（可选）' : '（必需）'}
                </strong>
                <small>{permission.reason}</small>
                {permission.origins.map((origin) => (
                  <code key={origin}>{origin}</code>
                ))}
              </span>
            </label>
          ))}
        </fieldset>
      )}
      {review.kind === 'uninstall' && (
        <>
          <p>将停止插件并撤销权限。默认保留私有数据，重新安装仍需匹配原发布者。</p>
          <label>
            <input type="checkbox" checked={purge} onChange={(e) => setPurge(e.target.checked)} />
            永久删除此插件的私有数据及回退备份
          </label>
        </>
      )}
      {review.kind === 'rollback' && (
        <p>
          将代码与私有数据一起恢复到上一版本备份，并撤销授权。当前版本产生的新数据保留在对应版本备份中，之后需要重新授权启用。
        </p>
      )}
      {review.kind === 'safe' && (
        <p>
          {review.enabled
            ? '停止所有插件并阻止后台任务；不会删除插件与数据。'
            : '恢复允许插件运行。已启用插件的后台任务将按各自周期恢复。'}
        </p>
      )}
      <label className="plugin-consent">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        我已核对来源、权限与影响，确认本次操作
      </label>
      {action.error && (
        <p role="alert" className="plugin-message">
          {errorMessage(action.error)}
        </p>
      )}
      <div className="plugin-actions">
        <button type="button" disabled={action.isPending} onClick={onClose}>
          取消
        </button>
        <button
          className="mint-button"
          type="button"
          disabled={
            action.isPending ||
            !consent ||
            ((review.kind === 'install' || review.kind === 'permissions') && !canConfirm)
          }
          onClick={submit}
        >
          {action.isPending ? '正在处理…' : '确认'}
        </button>
      </div>
    </Modal>
  );
}
export default function PluginsPage() {
  const workspace = useGameWorkspace(),
    query = usePlugins(),
    action = usePluginAction(z.null()),
    preview = usePluginAction(pluginPreviewSchema.nullable());
  const [review, setReview] = useState<Review | null>(null),
    [allowUnsigned, setAllowUnsigned] = useState(false),
    [search, setSearch] = useState('');
  const { pluginId } = useParams<{ pluginId: string }>();
  const [searchParams] = useSearchParams();
  const selected = query.data?.items.find((p) => p.manifest.id === pluginId);
  const builtin = query.data?.builtins.find((p) => p.id === pluginId);
  const requestedCommand = searchParams.get('command');
  const contribution = selected?.manifest.contributions.find((c) => c.command === requestedCommand);
  const busy = action.isPending || preview.isPending;
  const fail = (cause: unknown) => workspace.notify(errorMessage(cause));
  const close = () => {
    if (review?.kind === 'install')
      action.mutate(
        { operation: 'cancel-preview', ticket: review.preview.ticket },
        { onError: fail },
      );
    setReview(null);
  };
  return (
    <WorkspaceLayout workspace={workspace} active="settings">
      <main id="main-content" tabIndex={-1} className="plugins-main">
        <PageHeader
          title={selected?.manifest.name ?? builtin?.name ?? '插件中心'}
          description="按需扩展你的工作空间，清楚掌握每项能力。"
          actions={
            <>
              <button
                className="glass"
                type="button"
                disabled={!isDesktop() || busy}
                onClick={() =>
                  preview.mutate(
                    { operation: 'choose', allowUnsigned },
                    {
                      onSuccess: (p) => {
                        if (p) setReview({ kind: 'install', preview: p });
                      },
                      onError: fail,
                    },
                  )
                }
              >
                安装 .zjplug
              </button>
              <button
                className="glass"
                type="button"
                disabled={!query.data || busy}
                onClick={() => setReview({ kind: 'safe', enabled: !query.data?.safeMode })}
              >
                {query.data?.safeMode ? '退出安全模式' : '安全模式'}
              </button>
            </>
          }
        />
        {!isDesktop() && (
          <p className="plugin-message">
            请在桌面应用中安装与运行插件，网页预览不会制造插件或授权记录。
          </p>
        )}
        {query.error && (
          <p className="plugin-message" role="alert">
            {errorMessage(query.error)}{' '}
            <button
              type="button"
              onClick={() => {
                void query.refetch();
              }}
            >
              重试
            </button>
          </p>
        )}
        {query.data?.notice && (
          <p className="plugin-message" role="alert">
            {query.data.notice}
          </p>
        )}
        {query.data?.safeMode && (
          <p className="plugin-message" role="status">
            安全模式已开启：所有插件已停止，后台任务已暂停。
          </p>
        )}
        {query.data && !query.data.runtimeAvailable && (
          <p className="plugin-message" role="status">
            独立插件宿主尚未构建或安装不完整。可以检查已安装信息，暂时不能执行插件。
          </p>
        )}
        {builtin ? (
          <>
            <Link to="/plugins">返回插件列表</Link>
            {query.data?.safeMode ? (
              <p className="plugin-message">请退出插件安全模式后使用内置表格。</p>
            ) : (
              <Suspense fallback={<p role="status">正在打开智能表格…</p>}>
                <DuesTable />
              </Suspense>
            )}
          </>
        ) : selected ? (
          <>
            <Link to="/plugins">返回插件列表</Link>
            <section className="plugin-card glass">
              <h2>插件详情</h2>
              <p>{selected.manifest.description}</p>
              <p className="plugin-secondary">
                {selected.manifest.publisher} · {selected.manifest.version} ·{' '}
                {selected.manifest.language}
              </p>
              <code className="plugin-fingerprint">
                {selected.publisherKey ?? '未签名开发插件'}
              </code>
              <dl className="plugin-details">
                <dt>运行方式</dt>
                <dd>独立 Wasm 沙箱</dd>
                <dt>组件线性内存</dt>
                <dd>{selected.manifest.limits.memoryMb} MiB</dd>
                <dt>私有存储上限</dt>
                <dd>{selected.manifest.limits.storageMb} MiB</dd>
                <dt>单次调用期限</dt>
                <dd>{selected.manifest.limits.timeoutMs} ms</dd>
                <dt>许可</dt>
                <dd>{selected.manifest.license}</dd>
              </dl>
            </section>
            <nav className="plugin-actions" aria-label="插件扩展入口">
              {selected.manifest.contributions.map((c) => (
                <Link
                  key={c.id}
                  to={`/plugins/${selected.manifest.id}?command=${encodeURIComponent(c.command)}`}
                >
                  {c.title}
                </Link>
              ))}
            </nav>
            {selected.enabled &&
              !selected.quarantined &&
              !query.data?.safeMode &&
              (contribution?.kind === 'command' ? (
                <PluginCommand
                  key={`${selected.digest}:${contribution.command}`}
                  plugin={selected}
                  command={contribution.command}
                  title={contribution.title}
                />
              ) : (
                <PluginView plugin={selected} command={contribution?.command ?? 'render'} />
              ))}
          </>
        ) : (
          <>
            <div className="plugin-toolbar">
              <label>
                搜索插件
                <input
                  type="search"
                  value={search}
                  maxLength={96}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="插件名称、发布者或语言"
                />
              </label>
              <details>
                <summary>开发调试</summary>
                <label>
                  <input
                    type="checkbox"
                    checked={allowUnsigned}
                    onChange={(e) => setAllowUnsigned(e.target.checked)}
                  />
                  允许选择未签名开发插件（原生端会核对开发身份）
                </label>
              </details>
            </div>
            <div className="plugin-grid">
              {query.data?.builtins
                .filter((p) => `${p.name} ${p.description}`.includes(search))
                .map((p) => (
                  <article key={p.id} className="plugin-card glass">
                    <div className="plugin-card-heading">
                      <h2>
                        <Link to={`/plugins/${p.id}`}>{p.name}</Link>
                      </h2>
                      <span className="plugin-status">开发者内置</span>
                    </div>
                    <p>{p.description}</p>
                    <p className="plugin-secondary">臻境 · {p.version} · 第一方内置模块</p>
                    <div className="plugin-actions">
                      <Link className="mint-button" to={`/plugins/${p.id}`}>
                        打开智能表格
                      </Link>
                    </div>
                  </article>
                ))}
              {query.data?.items
                .filter((p) =>
                  `${p.manifest.name} ${p.manifest.publisher} ${p.manifest.language}`
                    .toLocaleLowerCase()
                    .includes(search.toLocaleLowerCase()),
                )
                .map((plugin) => (
                  <article key={plugin.manifest.id} className="plugin-card glass">
                    <div className="plugin-card-heading">
                      <h2>
                        <Link to={`/plugins/${plugin.manifest.id}`}>{plugin.manifest.name}</Link>
                      </h2>
                      <span className="plugin-status">
                        {plugin.quarantined
                          ? '故障隔离'
                          : plugin.enabled
                            ? plugin.running
                              ? '运行中'
                              : '已启用'
                            : '已停用'}
                      </span>
                    </div>
                    <p>{plugin.manifest.description}</p>
                    <p className="plugin-secondary">
                      {plugin.manifest.publisher} · {plugin.manifest.version} ·{' '}
                      {plugin.manifest.language}
                    </p>
                    <p className="plugin-secondary">
                      {plugin.publisherKey ? '发布者签名已验证' : '未签名开发插件'} · 独立 Wasm 沙箱
                    </p>
                    <div className="plugin-actions">
                      <button
                        type="button"
                        disabled={busy || !query.data}
                        onClick={() => {
                          if (!query.data) return;
                          if (plugin.enabled)
                            action.mutate(
                              {
                                operation: 'configure',
                                id: plugin.manifest.id,
                                digest: plugin.digest,
                                enabled: false,
                                grants: plugin.grants,
                                revision: query.data.revision,
                                consent: false,
                              },
                              { onError: fail },
                            );
                          else setReview({ kind: 'permissions', plugin });
                        }}
                      >
                        {plugin.enabled ? '停用' : '授权并启用'}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setReview({ kind: 'permissions', plugin })}
                      >
                        权限
                      </button>
                      <button
                        type="button"
                        disabled={busy || !plugin.running}
                        onClick={() =>
                          action.mutate(
                            { operation: 'stop', id: plugin.manifest.id },
                            { onError: fail },
                          )
                        }
                      >
                        停止运行
                      </button>
                      <button
                        type="button"
                        disabled={busy || !plugin.manifest.updateUrl}
                        onClick={() =>
                          preview.mutate(
                            { operation: 'update', id: plugin.manifest.id },
                            {
                              onSuccess: (p) => {
                                if (p) setReview({ kind: 'install', preview: p });
                              },
                              onError: fail,
                            },
                          )
                        }
                      >
                        检查更新
                      </button>
                      <button
                        type="button"
                        disabled={busy || !plugin.previous}
                        onClick={() => setReview({ kind: 'rollback', plugin })}
                      >
                        回退
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setReview({ kind: 'uninstall', plugin })}
                      >
                        卸载
                      </button>
                      <button
                        type="button"
                        disabled={busy || !query.data}
                        onClick={() => {
                          if (query.data)
                            action.mutate(
                              {
                                operation: 'configure',
                                id: plugin.manifest.id,
                                digest: plugin.digest,
                                enabled: false,
                                grants: [],
                                revision: query.data.revision,
                                consent: false,
                              },
                              { onError: fail },
                            );
                        }}
                      >
                        撤销全部权限
                      </button>
                    </div>
                    {plugin.quarantined && (
                      <p role="status">
                        此插件多次执行失败，已阻止继续运行。检查后可重新授权启用。
                      </p>
                    )}
                  </article>
                ))}
            </div>
            {query.data?.items.length === 0 && query.data.builtins.length === 0 && (
              <section className="plugin-empty glass">
                <h2>还没有安装插件</h2>
                <p>支持 TypeScript、C# 和 Rust 编写的标准插件包。先核对发布者，再授予所需能力。</p>
              </section>
            )}
          </>
        )}
        <p className="plugin-secondary">
          原生扩展与任意自定义网页尚未开放；插件不能直接调用系统命令、修改注册表或加载主程序 DLL。
        </p>
        {review && query.data && (
          <PluginReview
            key={
              review.kind === 'install'
                ? review.preview.digest
                : review.kind === 'safe'
                  ? String(review.enabled)
                  : review.plugin.digest + review.kind
            }
            review={review}
            revision={query.data.revision}
            onClose={close}
            onDone={() => {
              setReview(null);
              workspace.notify('插件配置已保存');
            }}
          />
        )}
      </main>
    </WorkspaceLayout>
  );
}
