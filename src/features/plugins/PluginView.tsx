import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { executePlugins, errorMessage } from '@/lib/desktop';
import {
  pluginFileTicketSchema,
  pluginViewSchema,
  type PluginNode,
  type PluginRecord,
} from '@/lib/plugin-contracts';
import { usePluginAction } from './repository';

/** 只渲染受控组件；不接受插件提供的 HTML、CSS、外部 URL、事件处理器或 React 代码。 */
export function PluginView({
  plugin,
  command = 'render',
}: {
  plugin: PluginRecord;
  command?: string;
}) {
  const client = useQueryClient();
  const [notice, setNotice] = useState('');
  const [picking, setPicking] = useState(false);
  const key = ['plugins', 'view', plugin.manifest.id, plugin.digest, command];
  const view = useQuery({
    queryKey: key,
    queryFn: () =>
      executePlugins(
        { operation: 'invoke', id: plugin.manifest.id, command, input: null },
        pluginViewSchema,
      ),
    enabled: plugin.enabled && !plugin.quarantined,
    retry: false,
    staleTime: 10000,
  });
  const action = usePluginAction(z.unknown());
  function render(node: PluginNode, index: number): React.ReactNode {
    switch (node.type) {
      case 'stack':
      case 'grid':
        return (
          <div key={index} className={`plugin-view-${node.type}`}>
            {node.children?.map(render)}
          </div>
        );
      case 'heading':
        return <h3 key={index}>{node.text}</h3>;
      case 'text':
        return <p key={index}>{node.text}</p>;
      case 'notice':
        return (
          <p key={index} className="plugin-message" role="status">
            {node.text}
          </p>
        );
      case 'metric':
        return (
          <dl key={index} className="plugin-metric">
            <dt>{node.text}</dt>
            <dd>{node.value}</dd>
          </dl>
        );
      case 'button':
      case 'file':
        return (
          <button
            key={index}
            type="button"
            className="mint-button"
            disabled={action.isPending || picking}
            onClick={() => {
              const command = node.command;
              if (!command || !plugin.manifest.contributions.some((c) => c.command === command)) {
                setNotice('插件引用了未声明操作');
                return;
              }
              if (node.type === 'file' && node.mode) {
                // 选择器属于可信宿主。插件尚未运行，因此等待用户选择不会耗尽插件调用时限。
                setPicking(true);
                void executePlugins(
                  { operation: 'pick-file', id: plugin.manifest.id, mode: node.mode },
                  pluginFileTicketSchema.nullable(),
                )
                  .then(async (file) => {
                    if (!file) return;
                    await action.mutateAsync({
                      operation: 'invoke',
                      id: plugin.manifest.id,
                      command,
                      input: { file },
                    });
                    await client.invalidateQueries({ queryKey: key });
                    setNotice('文件操作已完成');
                  })
                  .catch((cause: unknown) => setNotice(errorMessage(cause)))
                  .finally(() => setPicking(false));
                return;
              }
              action.mutate(
                { operation: 'invoke', id: plugin.manifest.id, command, input: null },
                {
                  onSuccess: () => {
                    void client.invalidateQueries({ queryKey: key });
                    setNotice('操作已完成');
                  },
                  onError: (e) => setNotice(errorMessage(e)),
                },
              );
            }}
          >
            {node.text}
          </button>
        );
    }
  }
  if (view.isError)
    return (
      <p role="alert" className="plugin-message">
        {errorMessage(view.error)}{' '}
        <button
          type="button"
          onClick={() => {
            void view.refetch();
          }}
        >
          重试
        </button>
      </p>
    );
  return (
    <section aria-label={`${plugin.manifest.name}插件界面`} className="plugin-view">
      {view.data ? render(view.data, 0) : <p role="status">正在加载插件…</p>}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}

/** 命令必须由用户按下按钮才执行，导航/轮询/重新聚焦不会隐式重放有副作用的操作。 */
export function PluginCommand({
  plugin,
  command,
  title,
}: {
  plugin: PluginRecord;
  command: string;
  title: string;
}) {
  const action = usePluginAction(z.unknown());
  return (
    <section className="plugin-view" aria-label={title}>
      <h3>{title}</h3>
      <button
        type="button"
        className="mint-button"
        disabled={action.isPending}
        onClick={() =>
          action.mutate({ operation: 'invoke', id: plugin.manifest.id, command, input: null })
        }
      >
        {action.isPending ? '正在执行…' : '执行命令'}
      </button>
      {action.isSuccess && <p role="status">命令已完成</p>}
      {action.error && <p role="alert">{errorMessage(action.error)}</p>}
    </section>
  );
}
