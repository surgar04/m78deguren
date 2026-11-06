import { useEffect, useMemo, useState } from 'react';
import type { DuesLedger, DuesMember, RemoteFee } from '@/lib/dues-contracts';
import { Modal } from '@/features/home/components/Modal';
import { nameOf } from './model';
import {
  evaluationDay,
  dayInZone,
  feeRows,
  feeState,
  gameMoney,
  monthFees,
  statusNames,
  wholeAmount,
  type ApiStatus,
} from './remote-model';

function time(value: string | null, zone: string): string {
  if (!value) return '历史记录未提供';
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: zone,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  } catch {
    return value;
  }
}
/** 公网表格只读，金额与日期直接来自完整快照；本地备注和资料由原账本继续管理。 */
export default function RemoteDuesTable({
  ledger,
  busy,
  error,
  message = '',
  checkedAt = 0,
  onRefresh,
  onSyncMembers,
  onEdit,
  onLocal,
  avatar,
}: {
  ledger: DuesLedger;
  busy: boolean;
  error: string;
  message?: string;
  checkedAt?: number;
  onRefresh: () => void;
  onSyncMembers: () => void;
  onEdit: (member: DuesMember) => void;
  onLocal: () => void;
  avatar: (member: DuesMember) => React.ReactNode;
}) {
  const snapshot = ledger.remoteFees;
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30000);
    return () => window.clearInterval(timer);
  }, []);
  const [search, setSearch] = useState(''),
    [status, setStatus] = useState<ApiStatus | 'all'>('all');
  const [membership, setMembership] = useState('current'),
    [sort, setSort] = useState('expiry');
  const [minimum, setMinimum] = useState(''),
    [maximum, setMaximum] = useState('');
  const [month, setMonth] = useState(() =>
    (
      dayInZone(snapshot?.meta.timeZone ?? 'Asia/Shanghai') ?? new Date().toISOString().slice(0, 10)
    ).slice(0, 7),
  );
  const [page, setPage] = useState(1),
    [history, setHistory] = useState<string | null>(null);
  const day = snapshot ? evaluationDay(snapshot, now) : '';
  const rows = useMemo(() => feeRows(ledger), [ledger]);
  const invalidAmount =
    (minimum !== '' && wholeAmount(minimum) === null) ||
    (maximum !== '' && wholeAmount(maximum) === null) ||
    (minimum !== '' && maximum !== '' && Number(minimum) > Number(maximum));
  const filtered = rows
    .filter((row) => {
      const state = feeState(row.fees?.latestFee, day),
        amount = row.fees?.latestFee.amount ?? 0;
      const haystack = [
        row.member.wxid,
        nameOf(row.member),
        row.member.nickname,
        row.member.groupNickname,
        row.member.remark,
        row.fees?.member.nickname,
      ]
        .join(' ')
        .toLocaleLowerCase();
      return (
        (!search || haystack.includes(search.trim().toLocaleLowerCase())) &&
        (status === 'all' || state.status === status) &&
        (membership === 'all' ||
          (membership === 'current' && (row.member.active || !row.knownMembership)) ||
          (membership === 'departed' && row.knownMembership && !row.member.active)) &&
        (invalidAmount || minimum === '' || amount >= Number(minimum)) &&
        (invalidAmount || maximum === '' || amount <= Number(maximum))
      );
    })
    .sort((a, b) => {
      if (sort === 'amount')
        return (
          (b.fees?.latestFee.amount ?? 0) - (a.fees?.latestFee.amount ?? 0) ||
          a.member.wxid.localeCompare(b.member.wxid)
        );
      if (sort === 'total')
        return (
          (b.fees?.totalAmount ?? 0) - (a.fees?.totalAmount ?? 0) ||
          a.member.wxid.localeCompare(b.member.wxid)
        );
      if (sort === 'name') return nameOf(a.member).localeCompare(nameOf(b.member), 'zh-CN');
      return (
        (a.fees?.latestFee.expiresOn ?? '9999').localeCompare(
          b.fees?.latestFee.expiresOn ?? '9999',
        ) || a.member.wxid.localeCompare(b.member.wxid)
      );
    });
  const pages = Math.max(1, Math.ceil(filtered.length / 25)),
    currentPage = Math.min(page, pages);
  const visible = filtered.slice((currentPage - 1) * 25, currentPage * 25);
  const current = rows.filter((r) => r.knownMembership && r.member.active);
  const states = current.map((r) => feeState(r.fees?.latestFee, day).status);
  const stats = snapshot ? monthFees(snapshot, month) : null;
  const registered = current.filter((r) => stats?.people.has(r.member.wxid)).length;
  const effective = states.filter((s) => s === 'active' || s === 'due_today').length;
  const details = snapshot?.records.filter((f) => f.member.wxid === history) ?? [];
  const [historyPage, setHistoryPage] = useState(1);
  const historyPages = Math.max(1, Math.ceil(details.length / 25)),
    shownHistoryPage = Math.min(historyPage, historyPages);
  const reset = () => setPage(1);
  function record(fee: RemoteFee) {
    return (
      <tr key={fee.id}>
        <td>
          {fee.paymentDate}
          <small className="dues-help">缴费所属日期</small>
          <small className="dues-help">登记昵称：{fee.member.nickname || '—'}</small>
        </td>
        <td>
          {fee.planLabel}
          {fee.isBackPayment ? ' · 补缴' : ''}
          {fee.isLatest ? ' · 当前方案' : ''}
        </td>
        <td className="dues-number">
          {gameMoney(fee.amount)}
          <small className="dues-help">{fee.amountText}</small>
        </td>
        <td>
          {fee.expiresOn}
          <small className="dues-help">到期日当天仍有效</small>
        </td>
        <td>
          {time(fee.recordedAt, snapshot?.meta.timeZone ?? 'Asia/Shanghai')}
          <small className="dues-help">
            缴费时间：{time(fee.paidAt, snapshot?.meta.timeZone ?? 'Asia/Shanghai')}
          </small>
        </td>
        <td className="dues-wxid">
          {fee.operatorWxid}
          <small className="dues-help">记录 ID：{fee.id}</small>
        </td>
      </tr>
    );
  }
  return (
    <section className="dues-workspace" aria-label="API 会费智能表格">
      <header className="dues-heading">
        <div>
          <span className="dues-eyebrow">开发者内置插件 · 公网会费只读同步</span>
          <h2>{snapshot?.groupName ?? ledger.groupName}</h2>
          <p className="dues-help">
            按 wxid 精确匹配，自动填写最新会费、累计金额和到期日期。金额单位：PokeMMO 游戏币。
          </p>
        </div>
        <div className="plugin-actions">
          <button disabled={busy} onClick={onRefresh}>
            {busy ? '正在同步…' : '刷新会费'}
          </button>
          <button disabled={busy} onClick={onSyncMembers}>
            同步群成员
          </button>
          <button onClick={onLocal}>本地人民币账本</button>
        </div>
      </header>
      {message && (
        <p role="status" className="plugin-message">
          {message}
        </p>
      )}
      {checkedAt > 0 && snapshot && (
        <p className="dues-help">
          最近成功核验：{time(new Date(checkedAt).toISOString(), snapshot.meta.timeZone)} ·
          页面打开时自动同步，前台每分钟刷新
        </p>
      )}
      {error && (
        <p className="plugin-message" role="alert">
          {error}。当前保留上次完整快照，不清空已有记录。
        </p>
      )}
      {!snapshot ? (
        <p role="status">
          {busy ? '正在自动读取会费和完整流水…' : '尚未取得 API 会费数据，请点击刷新会费。'}
        </p>
      ) : (
        <>
          <p className="dues-sync-state">
            数据同步：{time(snapshot.syncedAt, snapshot.meta.timeZone)} · 源端更新：
            {snapshot.meta.updatedAt
              ? time(snapshot.meta.updatedAt, snapshot.meta.timeZone)
              : '未提供'}{' '}
            · 源端状态截至 {snapshot.meta.evaluatedOn} · 当前判断日 {day}（{snapshot.meta.timeZone}
            ） · {snapshot.summary.memberCount} 位有记录成员 / {snapshot.summary.recordCount} 笔 /
            累计 {gameMoney(snapshot.summary.totalAmount)}
          </p>
          {day !== snapshot.meta.evaluatedOn && (
            <p className="dues-warning">
              缓存已跨自然日：当前状态按服务端给出的到期日重新计算，正在等待最新 API 快照。
            </p>
          )}
          <div className="dues-metrics" aria-label="API 当前会费统计">
            {(['active', 'due_today', 'expired', 'no_record'] as const).map((s) => (
              <article key={s}>
                <span>{statusNames[s]}（当前在群）</span>
                <strong>{states.filter((v) => v === s).length}</strong>
                <button
                  onClick={() => {
                    setStatus(s);
                    reset();
                  }}
                >
                  筛选此状态 →
                </button>
              </article>
            ))}
          </div>
          <p className="dues-help">
            当前在群有效缴费率：
            {current.length
              ? `${Math.round((effective / current.length) * 1000) / 10}%`
              : '暂无完整群名单'}
            。今日到期计为有效；无 API
            记录不自动判为欠费。仅有会费资料的成员标为“群状态待同步”，不计入在群比率。
          </p>
          <div className="dues-month-row">
            <label>
              统计月份
              <input
                type="month"
                value={month}
                onChange={(e) => {
                  if (/^\d{4}-(0[1-9]|1[0-2])$/u.test(e.target.value)) setMonth(e.target.value);
                }}
              />
            </label>
            <span>
              {stats?.people.size ?? 0} 人登记 / {stats?.records.length ?? 0} 笔 /{' '}
              {gameMoney(stats?.amount ?? 0)}
            </span>
            <span>
              当前在群本月登记 {registered} 人，未登记 {current.length - registered} 人；登记比率{' '}
              {current.length ? `${Math.round((registered / current.length) * 1000) / 10}%` : '—'}
            </span>
          </div>
          <p className="dues-help">
            月份统计以缴费所属日期
            为准，补登按所属日期入账。年费不会在每个覆盖月重复计收入；本月未登记不等于欠费，当前资格请看最新方案与到期日。API
            不提供历史群成员快照。
          </p>
          <div className="dues-filters">
            <label>
              搜索成员
              <input
                value={search}
                placeholder="wxid、昵称、群昵称、本地备注"
                onChange={(e) => {
                  setSearch(e.target.value);
                  reset();
                }}
              />
            </label>
            <label>
              会费状态
              <select
                value={status}
                onChange={(e) => {
                  const value = e.target.value;
                  if (
                    value === 'all' ||
                    value === 'active' ||
                    value === 'due_today' ||
                    value === 'expired' ||
                    value === 'no_record'
                  ) {
                    setStatus(value);
                    reset();
                  }
                }}
              >
                <option value="all">全部状态</option>
                {Object.entries(statusNames).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              成员范围
              <select
                value={membership}
                onChange={(e) => {
                  setMembership(e.target.value);
                  reset();
                }}
              >
                <option value="current">在群及待同步成员</option>
                <option value="all">全部成员</option>
                <option value="departed">已归档成员</option>
              </select>
            </label>
            <label>
              排序
              <select
                value={sort}
                onChange={(e) => {
                  setSort(e.target.value);
                  reset();
                }}
              >
                <option value="expiry">到期日优先</option>
                <option value="amount">最近金额从高到低</option>
                <option value="total">累计金额从高到低</option>
                <option value="name">成员名称</option>
              </select>
            </label>
            <label>
              最低游戏币
              <input
                inputMode="numeric"
                value={minimum}
                onChange={(e) => {
                  setMinimum(e.target.value);
                  reset();
                }}
              />
            </label>
            <label>
              最高游戏币
              <input
                inputMode="numeric"
                value={maximum}
                onChange={(e) => {
                  setMaximum(e.target.value);
                  reset();
                }}
              />
            </label>
          </div>
          {invalidAmount && (
            <p role="alert">金额筛选只接受安全范围内的非负整数，且最低金额不能超过最高金额。</p>
          )}
          <div className="dues-table-scroll">
            <table className="dues-table" aria-label="API 成员会费表">
              <thead>
                <tr>
                  {[
                    '头像',
                    '成员 / wxid',
                    '当前状态',
                    '最新缴费 / 方案',
                    '最近缴纳金额',
                    '到期日 / 剩余天数',
                    '累计金额 / 笔数',
                    '本地备注',
                    '操作',
                  ].map((h) => (
                    <th scope="col" key={h}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => {
                  const fee = row.fees?.latestFee,
                    state = feeState(fee, day);
                  return (
                    <tr
                      key={row.member.wxid}
                      className={
                        state.status === 'expired'
                          ? 'dues-row-expired'
                          : state.status === 'due_today'
                            ? 'dues-row-unpaid'
                            : ''
                      }
                    >
                      <td>{avatar(row.member)}</td>
                      <th scope="row">
                        {nameOf(row.member)}
                        <small className="dues-help">
                          群昵称：{row.member.localGroupNickname ?? row.member.groupNickname ?? '—'}
                        </small>
                        <small className="dues-help">
                          昵称：{row.member.localNickname ?? row.member.nickname}
                        </small>
                        <small className="dues-help dues-wxid">{row.member.wxid}</small>
                        {!row.knownMembership && <small className="dues-help">群状态待同步</small>}
                      </th>
                      <td>
                        <span
                          className={`dues-badge ${state.status === 'expired' ? 'dues-expired' : state.status === 'active' ? 'dues-paid' : state.status === 'due_today' ? 'dues-unpaid' : 'dues-no-record'}`}
                        >
                          {statusNames[state.status]}
                        </span>
                      </td>
                      <td>
                        {fee ? (
                          <>
                            {fee.paymentDate}
                            <small className="dues-help">
                              {fee.planLabel}
                              {fee.isBackPayment ? ' · 月费补缴' : ''}
                            </small>
                            <small className="dues-help">
                              登记：{time(fee.recordedAt, snapshot.meta.timeZone)}
                            </small>
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="dues-number">
                        {fee ? gameMoney(fee.amount) : '—'}
                        {fee && <small className="dues-help">{fee.amountText}</small>}
                      </td>
                      <td>
                        {fee ? (
                          <>
                            {fee.expiresOn}
                            <small className="dues-help">
                              {state.days === 0
                                ? '今天到期，今日仍有效'
                                : state.days !== null && state.days < 0
                                  ? `已过期 ${-state.days} 天`
                                  : `剩余 ${state.days} 天`}
                            </small>
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>
                        {row.fees ? (
                          <>
                            <span className="dues-number">{gameMoney(row.fees.totalAmount)}</span>
                            <small className="dues-help">{row.fees.recordCount} 笔</small>
                            <small className="dues-help">
                              月费{' '}
                              <span className="dues-number">
                                {gameMoney(row.fees.monthlyTotalAmount)}
                              </span>
                            </small>
                            <small className="dues-help">
                              年费{' '}
                              <span className="dues-number">
                                {gameMoney(row.fees.yearlyTotalAmount)}
                              </span>
                            </small>
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="dues-note">{row.member.remark || '—'}</td>
                      <td>
                        <div className="dues-row-actions">
                          <button
                            disabled={!row.fees}
                            onClick={() => {
                              setHistory(row.member.wxid);
                              setHistoryPage(1);
                            }}
                          >
                            API 流水
                          </button>
                          <button
                            disabled={!row.knownMembership}
                            onClick={() => onEdit(row.member)}
                          >
                            编辑本地资料
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!visible.length && (
                  <tr>
                    <td colSpan={9} className="dues-empty">
                      没有符合条件的成员
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <nav className="dues-pagination" aria-label="API 表格分页">
            <span>
              {filtered.length} 位成员 · 第 {currentPage} / {pages} 页
            </span>
            <button disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>
              上一页
            </button>
            <button disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>
              下一页
            </button>
          </nav>
          <p className="dues-help">
            此 API
            只读。会费登记、更正及重置请在原登记系统操作；刷新后自动反映变化。人工人民币记录保留在“本地人民币账本”，不会混入游戏币统计。
          </p>
        </>
      )}
      {history && (
        <Modal
          title="API 缴费完整流水"
          onClose={() => setHistory(null)}
          className="dues-dialog dues-history-dialog"
        >
          <p className="dues-help">
            成员 wxid：{history}。按 API 写入顺序倒序；历史昵称按登记时资料显示。
          </p>
          <div className="dues-table-scroll">
            <table className="dues-table" aria-label="API 完整缴费流水">
              <thead>
                <tr>
                  {['缴费日期', '方案', '金额', '到期日', '真实登记时间', '操作人 / 记录 ID'].map(
                    (h) => (
                      <th key={h}>{h}</th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {details.slice((shownHistoryPage - 1) * 25, shownHistoryPage * 25).map(record)}
                {!details.length && (
                  <tr>
                    <td colSpan={6}>源端已重置或没有匹配流水</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <nav className="dues-pagination" aria-label="API 流水分页">
            <span>
              {details.length} 笔 · 第 {shownHistoryPage} / {historyPages} 页
            </span>
            <button
              disabled={shownHistoryPage === 1}
              onClick={() => setHistoryPage(shownHistoryPage - 1)}
            >
              上一页
            </button>
            <button
              disabled={shownHistoryPage === historyPages}
              onClick={() => setHistoryPage(shownHistoryPage + 1)}
            >
              下一页
            </button>
          </nav>
        </Modal>
      )}
    </section>
  );
}
