import { useState } from 'react';
import type { z } from 'zod';
import { crashesSchema } from '@/lib/tool-contracts';
import { useToolAction, useToolQuery } from './hooks';
import { Feedback } from './Feedback';
import { bytes } from './format';

type Report = z.infer<typeof crashesSchema>;
const TABS = [
  ['overview', '总览'],
  ['crashes', '崩溃时间线'],
  ['findings', '分析建议'],
  ['events', '系统事件'],
  ['dumps', '转储文件'],
] as const;
type Tab = (typeof TABS)[number][0];
const date = (value: string) => new Date(value).toLocaleString('zh-CN');
const hex = (value: number | null) =>
  value === null ? '未记录' : `0x${value.toString(16).toUpperCase().padStart(8, '0')}`;

/** 所有页面共享同一份只读报告；相关事件按索引引用，避免复制大段消息和产生不同状态源。 */
function Event({ event }: { event: Report['events'][number] }) {
  return (
    <details className="native-crash-event">
      <summary>
        {date(event.time)} · {event.provider} · 事件 {event.id}
      </summary>
      <pre>{event.message || '系统没有提供消息正文'}</pre>
      {Object.entries(event.data).map(([name, value]) => (
        <p key={name}>
          <strong>{name || '未命名字段'}</strong>：{value}
        </p>
      ))}
    </details>
  );
}
export function CrashPanel() {
  const query = useToolQuery('crash-scan', crashesSchema);
  const action = useToolAction();
  const [tab, setTab] = useState<Tab>('overview');
  const [search, setSearch] = useState('');
  const report = query.data;
  const related = (indices: number[]) =>
    indices.flatMap((index) => {
      const event = report?.events[index];
      return event ? [<Event key={index} event={event} />] : [];
    });
  return (
    <div className="native-tool-panel">
      <p className="native-tool-note">
        读取最近 30
        天系统事件、转储配置和可读取的转储头。异常断电、用户态崩溃与内核蓝屏分别展示；错误码释义与事件关联不等同于根因结论。此工具不执行
        WinDbg 符号或调用栈分析。
      </p>
      <div className="native-tool-actions">
        <button
          type="button"
          className="mint-button"
          disabled={query.isFetching}
          onClick={() => {
            void query.refetch();
          }}
        >
          刷新系统证据
        </button>
        <button
          type="button"
          className="native-button"
          disabled={action.isPending}
          onClick={() => action.mutate({ operation: 'crash-export' })}
        >
          导出完整报告到本地目录
        </button>
      </div>
      <Feedback
        pending={query.isFetching || action.isPending}
        error={query.error || action.error}
        success={
          action.isSuccess && typeof action.data === 'string' ? `已保存：${action.data}` : undefined
        }
      />
      <div className="native-tool-actions" aria-label="蓝屏分析栏目">
        {TABS.map(([id, label]) => (
          <button
            type="button"
            className={tab === id ? 'mint-button' : 'native-button'}
            key={id}
            aria-pressed={tab === id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {report && (
        <>
          {tab === 'overview' && (
            <>
              <div className="native-metrics">
                <div>
                  <strong>
                    {report.timeline.filter((item) => item.kind === 'bugcheck').length}
                  </strong>
                  <span>已记录 BugCheck</span>
                </div>
                <div>
                  <strong>{report.events.length}</strong>
                  <span>相关系统事件</span>
                </div>
                <div>
                  <strong>{report.dumps.length}</strong>
                  <span>发现的转储</span>
                </div>
              </div>
              <h3>系统与转储配置</h3>
              <dl className="native-detail-grid">
                <dt>操作系统</dt>
                <dd>
                  {report.system.name} · {report.system.version}
                </dd>
                <dt>最近启动</dt>
                <dd>{report.system.lastBoot ? date(report.system.lastBoot) : '无法读取'}</dd>
                <dt>转储类型</dt>
                <dd>
                  {report.system.dumpMode === null
                    ? '未配置'
                    : ({
                        0: '不写入',
                        1: '完整内存',
                        2: '内核内存',
                        3: '小内存',
                        7: '自动内存',
                        10: '活动内存',
                      }[report.system.dumpMode] ?? `类型 ${report.system.dumpMode}`)}
                </dd>
                <dt>自动重启</dt>
                <dd>
                  {report.system.autoReboot === null
                    ? '未配置'
                    : report.system.autoReboot
                      ? '启用'
                      : '关闭'}
                </dd>
                <dt>转储位置</dt>
                <dd>{report.system.dumpFile || '未配置'}</dd>
                <dt>小转储目录</dt>
                <dd>{report.system.minidumpDirectory || '未配置'}</dd>
                <dt>读取权限</dt>
                <dd>{report.admin ? '管理员' : '普通用户，部分证据可能不可读'}</dd>
              </dl>
              <p className="native-tool-note">
                采集时间：{new Date(report.capturedAt).toLocaleString('zh-CN')}
                。转储文件可能位于系统目录，仅进行只读访问；导出报告写入应用数据目录。
              </p>
            </>
          )}
          {tab === 'crashes' && (
            <>
              {report.timeline.length === 0 && (
                <p className="native-tool-empty">查询范围内没有符合条件的崩溃或异常关机事件。</p>
              )}
              {report.timeline.map((item, index) => (
                <details className="native-crash-event" key={`${item.time}-${index}`}>
                  <summary>
                    {date(item.time)} ·{' '}
                    {item.kind === 'bugcheck'
                      ? `${hex(item.code)} · ${item.name ?? ''}`
                      : '异常关机（未记录 BugCheck）'}
                  </summary>
                  <p>
                    来源：{item.source} · 事件 {item.eventId ?? '—'}
                  </p>
                  <p>发生时间前后 10 分钟的系统证据：</p>
                  {related(item.related)}
                </details>
              ))}
            </>
          )}
          {tab === 'findings' && (
            <>
              {report.findings.length === 0 && (
                <p className="native-tool-empty">
                  当前证据未命中诊断规则，不能据此排除硬件或驱动问题。
                </p>
              )}
              {report.findings.map((item, index) => (
                <section className="native-tool-confirm" key={index}>
                  <h3>{item.title}</h3>
                  <p>
                    {item.evidence} · 关联线索置信度：{item.confidence}
                  </p>
                  <p>{item.suggestion}</p>
                  {related(item.events)}
                </section>
              ))}
            </>
          )}
          {tab === 'events' && (
            <>
              <label className="native-tool-search">
                搜索事件
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="事件 ID、来源或消息"
                />
              </label>
              {report.events
                .filter((item) =>
                  `${item.id} ${item.provider} ${item.message}`
                    .toLocaleLowerCase()
                    .includes(search.toLocaleLowerCase()),
                )
                .map((event, index) => (
                  <Event key={`${event.time}-${index}`} event={event} />
                ))}
            </>
          )}
          {tab === 'dumps' && (
            <>
              {report.dumps.length === 0 && (
                <p className="native-tool-empty">没有发现可枚举的转储文件。</p>
              )}
              {report.dumps.map((dump) => (
                <details className="native-crash-event" key={dump.id}>
                  <summary>
                    {dump.name} · {bytes(dump.bytes)} · {date(dump.modified)}
                  </summary>
                  <p>{dump.path}</p>
                  <dl className="native-detail-grid">
                    <dt>格式</dt>
                    <dd>{dump.header.format}</dd>
                    <dt>记录类别</dt>
                    <dd>
                      {dump.header.codeKind === 'kernel-bugcheck'
                        ? '内核转储'
                        : dump.header.codeKind === 'user-exception'
                          ? '用户态异常'
                          : '无法解析'}
                    </dd>
                    <dt>错误码</dt>
                    <dd>{hex(dump.header.code)}</dd>
                    <dt>参数</dt>
                    <dd>{dump.header.parameters.join(' · ') || '未记录'}</dd>
                    <dt>异常地址</dt>
                    <dd>{dump.header.exceptionAddress ?? '未记录'}</dd>
                    <dt>架构与处理器</dt>
                    <dd>
                      {dump.header.architecture ?? '未知'} · {dump.header.processors ?? '未知'}{' '}
                      个逻辑处理器
                    </dd>
                    <dt>系统版本</dt>
                    <dd>{dump.header.osVersion ?? '未记录'}</dd>
                  </dl>
                  {dump.header.note && <p className="native-tool-note">{dump.header.note}</p>}
                  <button
                    type="button"
                    className="native-button"
                    disabled={action.isPending}
                    onClick={() => action.mutate({ operation: 'crash-reveal', id: dump.id })}
                  >
                    定位转储
                  </button>
                </details>
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}
