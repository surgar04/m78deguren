import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { Modal } from '@/features/home/components/Modal';
import { errorMessage } from '@/lib/desktop';
import type { DuesLedger, DuesMember, DuesPayment, DuesRequest } from '@/lib/dues-contracts';
import {
  addMonths,
  currentMonth,
  filterRows,
  money,
  nameOf,
  parseMoney,
  rowsFor,
  statistics,
  type TableFilter,
} from './model';
import { callDues, DUES_KEY, useDues, useDuesAction } from './repository';
import './dues.css';

type Editor =
  | { type: 'settings'; revision: number }
  | { type: 'member'; revision: number; member: DuesMember }
  | { type: 'pay'; revision: number; wxids: string[]; month: string }
  | { type: 'void'; revision: number; payment: DuesPayment };
const PAGE_SIZE = 25;

/** 头像由原生网关限源下载。前端仅接收受限 data URL，不直接连接 API 或第三方图片站。 */
function Avatar({ member }: { member: DuesMember }) {
  const [failed, setFailed] = useState(false);
  const avatar = useQuery({
    queryKey: [...DUES_KEY, 'avatar', member.wxid, member.avatarUrl],
    queryFn: () =>
      callDues(
        { action: 'avatar', wxid: member.wxid },
        z
          .string()
          .max(180000)
          .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/u)
          .nullable(),
      ),
    enabled: Boolean(member.avatarUrl),
    retry: false,
    staleTime: 600000,
  });
  return avatar.data && !failed ? (
    <img
      className="dues-avatar"
      src={avatar.data}
      alt=""
      width={36}
      height={36}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  ) : (
    <span className="dues-avatar dues-avatar-placeholder" aria-hidden="true">
      {Array.from(nameOf(member))[0] ?? '群'}
    </span>
  );
}

/** 复核窗口只保存草稿。revision 固定为打开时版本，提交不会覆盖其他窗口的新资料。 */
function DuesEditor({
  editor,
  ledger,
  busy,
  failure,
  onClose,
  onSubmit,
}: {
  editor: Editor;
  ledger: DuesLedger;
  busy: boolean;
  failure: string;
  onClose: () => void;
  onSubmit: (request: DuesRequest) => void;
}) {
  const person = editor.type === 'member' ? editor.member : null;
  const [nickname, setNickname] = useState(person?.localNickname ?? person?.nickname ?? '');
  const [groupNickname, setGroupNickname] = useState(
    person?.localGroupNickname ?? person?.groupNickname ?? '',
  );
  const [remark, setRemark] = useState(person?.remark ?? '');
  const [followSource, setFollowSource] = useState(false);
  const [monthly, setMonthly] = useState((ledger.settings.monthlyCents / 100).toFixed(2));
  const [annual, setAnnual] = useState((ledger.settings.annualCents / 100).toFixed(2));
  const [kind, setKind] = useState<DuesPayment['kind']>('monthly');
  const [amount, setAmount] = useState(
    ledger.settings.monthlyCents ? (ledger.settings.monthlyCents / 100).toFixed(2) : '',
  );
  const [confirmed, setConfirmed] = useState(false);
  const [validation, setValidation] = useState('');
  const title =
    editor.type === 'settings'
      ? '设置固定会费'
      : editor.type === 'member'
        ? '编辑成员资料'
        : editor.type === 'void'
          ? '撤销缴费记录'
          : `登记缴费 · ${editor.wxids.length} 人`;
  return (
    <Modal
      title={title}
      onClose={() => {
        if (!busy) onClose();
      }}
      className="dues-dialog"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setValidation('');
          if (busy) return;
          switch (editor.type) {
            case 'settings': {
              const monthlyCents = parseMoney(monthly),
                annualCents = parseMoney(annual);
              if (monthlyCents === null || annualCents === null) {
                setValidation('请输入 0–1,000,000 元，最多两位小数；0 表示尚未设置。');
                return;
              }
              onSubmit({
                action: 'settings',
                revision: editor.revision,
                monthlyCents,
                annualCents,
              });
              break;
            }
            case 'member':
              onSubmit({
                action: 'edit-member',
                revision: editor.revision,
                wxid: editor.member.wxid,
                nickname: followSource ? null : nickname,
                groupNickname: followSource ? null : groupNickname,
                remark,
              });
              break;
            case 'pay': {
              const amountCents = parseMoney(amount);
              if (!amountCents || !confirmed) {
                setValidation('请填写大于 0 的金额并确认缴费范围。');
                return;
              }
              onSubmit({
                action: 'pay',
                revision: editor.revision,
                wxids: editor.wxids,
                month: editor.month,
                kind,
                amountCents,
                remark,
              });
              break;
            }
            case 'void':
              if (!remark.trim() || !confirmed) {
                setValidation('请填写撤销原因，并确认对覆盖月份的影响。');
                return;
              }
              onSubmit({
                action: 'void',
                revision: editor.revision,
                id: editor.payment.id,
                reason: remark,
              });
              break;
          }
        }}
      >
        {editor.type === 'settings' && (
          <>
            <p>固定金额可在每次登记时调整；修改设置不会改写已保存的缴费流水。</p>
            <label>
              每月固定金额（元）
              <input
                inputMode="decimal"
                value={monthly}
                maxLength={10}
                onChange={(e) => setMonthly(e.target.value)}
              />
            </label>
            <label>
              每年固定金额（元）
              <input
                inputMode="decimal"
                value={annual}
                maxLength={10}
                onChange={(e) => setAnnual(e.target.value)}
              />
            </label>
          </>
        )}
        {editor.type === 'member' && (
          <>
            <p className="dues-help">wxid：{editor.member.wxid}（唯一标识，不可编辑）</p>
            <label>
              群昵称
              <input
                value={groupNickname}
                disabled={followSource}
                maxLength={128}
                onChange={(e) => setGroupNickname(e.target.value)}
              />
            </label>
            <label>
              昵称
              <input
                value={nickname}
                disabled={followSource}
                maxLength={128}
                onChange={(e) => setNickname(e.target.value)}
              />
            </label>
            <label className="dues-check">
              <input
                type="checkbox"
                checked={followSource}
                onChange={(e) => setFollowSource(e.target.checked)}
              />
              恢复使用 API 资料
            </label>
            <label>
              成员备注
              <textarea
                value={remark}
                maxLength={500}
                onChange={(e) => setRemark(e.target.value)}
              />
            </label>
            <p className="dues-help">本地编辑优先显示，成员同步不会覆盖；头像保持跟随 API。</p>
          </>
        )}
        {editor.type === 'pay' && (
          <>
            <p>
              缴费月份：<strong>{editor.month}</strong> · {editor.wxids.length} 位成员
            </p>
            <p className="dues-pay-names">
              {editor.wxids
                .map((id) => ledger.members.find((m) => m.wxid === id))
                .filter((m): m is DuesMember => Boolean(m))
                .map(nameOf)
                .join('、')}
            </p>
            <label>
              缴费类型
              <select
                value={kind}
                onChange={(e) => {
                  const result = z.enum(['monthly', 'annual', 'custom']).safeParse(e.target.value);
                  if (!result.success) return;
                  setKind(result.data);
                  const preset =
                    result.data === 'annual'
                      ? ledger.settings.annualCents
                      : result.data === 'monthly'
                        ? ledger.settings.monthlyCents
                        : 0;
                  setAmount(preset ? (preset / 100).toFixed(2) : '');
                  setConfirmed(false);
                }}
              >
                <option value="monthly">月费 · 固定金额</option>
                <option value="annual">年费 · 固定金额</option>
                <option value="custom">自定义金额 · 单月</option>
              </select>
            </label>
            <label>
              每人缴纳金额（元）
              <input
                inputMode="decimal"
                required
                value={amount}
                maxLength={10}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setConfirmed(false);
                }}
              />
            </label>
            <label>
              补充备注
              <textarea
                value={remark}
                maxLength={250}
                onChange={(e) => setRemark(e.target.value)}
              />
            </label>
            <p className="dues-summary">
              覆盖 {editor.month}
              {kind === 'annual'
                ? ` 至 ${addMonths(editor.month, 11)}，连续 12 个月`
                : '，共 1 个月'}
              。合计 ¥{money((parseMoney(amount) ?? 0) * editor.wxids.length)}。
            </p>
            <p className="dues-help">
              月份会自动写入缴费备注。年费收入在起始月记一次，之后各覆盖月显示已缴；已有缴费覆盖时整批拒绝保存。
            </p>
            <label className="dues-check">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              我已核对成员、金额和覆盖月份
            </label>
          </>
        )}
        {editor.type === 'void' && (
          <>
            <p className="dues-warning">
              将撤销 ¥{money(editor.payment.amountCents)}，覆盖 {editor.payment.month} 至{' '}
              {addMonths(editor.payment.month, editor.payment.months - 1)}
              。对应月份将恢复未缴，原流水保留。
            </p>
            <label>
              撤销原因
              <textarea
                required
                value={remark}
                maxLength={250}
                onChange={(e) => setRemark(e.target.value)}
              />
            </label>
            <label className="dues-check">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              确认撤销整笔缴费及其所有覆盖月份
            </label>
          </>
        )}
        {(validation || failure) && (
          <p role="alert" className="plugin-message">
            {validation || failure}
          </p>
        )}
        <div className="plugin-actions">
          <button type="button" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button
            type="submit"
            className="mint-button"
            disabled={busy || ((editor.type === 'pay' || editor.type === 'void') && !confirmed)}
          >
            {busy ? '正在保存…' : '确认保存'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function DuesTable() {
  const mounted = useRef(false);
  const query = useDues(),
    action = useDuesAction(),
    client = useQueryClient();
  const [month, setMonth] = useState(currentMonth);
  const [filter, setFilter] = useState<TableFilter>({
    search: '',
    status: 'all',
    membership: 'active',
    sort: 'unpaid',
    minAmount: null,
    maxAmount: null,
  });
  const [minimum, setMinimum] = useState(''),
    [maximum, setMaximum] = useState('');
  const [page, setPage] = useState(1),
    [tab, setTab] = useState<'members' | 'history'>('members');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editor, setEditor] = useState<Editor | null>(null),
    [notice, setNotice] = useState('');
  const ledger = query.data;
  const rows = useMemo(() => (ledger ? rowsFor(ledger, month) : []), [ledger, month]);
  const filtered = useMemo(() => filterRows(rows, filter), [rows, filter]);
  const stats = ledger ? statistics(rows, ledger, month) : null;
  const history =
    ledger?.payments
      .filter(
        (payment) => payment.month <= month && month < addMonths(payment.month, payment.months),
      )
      .filter((payment) => {
        const member = ledger.members.find((m) => m.wxid === payment.wxid);
        return (
          !filter.search.trim() ||
          `${member ? nameOf(member) : ''} ${payment.wxid} ${payment.remark}`
            .toLocaleLowerCase()
            .includes(filter.search.trim().toLocaleLowerCase())
        );
      })
      .slice()
      .reverse() ?? [];
  const count = tab === 'members' ? filtered.length : history.length;
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE)),
    currentPage = Math.min(page, pages);
  const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const pageUnpaid = visible.filter((row) => !row.payment);
  const allChecked =
    pageUnpaid.length > 0 && pageUnpaid.every((row) => selected.has(row.member.wxid));
  const moneyError =
    (minimum !== '' && parseMoney(minimum) === null) ||
    (maximum !== '' && parseMoney(maximum) === null) ||
    (filter.minAmount !== null && filter.maxAmount !== null && filter.minAmount > filter.maxAmount);
  // 内置页面卸载即销毁个人资料查询；认证失效或安全模式切换也会卸载该页面。
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // StrictMode 会立即重放 effect；延迟到微任务判断真实卸载，避免误删仍在展示的账本。
      queueMicrotask(() => {
        if (mounted.current) return;
        void client.cancelQueries({ queryKey: DUES_KEY });
        client.removeQueries({ queryKey: DUES_KEY });
      });
    };
  }, [client]);
  function changeFilter(change: Partial<TableFilter>) {
    setFilter((previous) => ({ ...previous, ...change }));
    setPage(1);
    setSelected(new Set());
  }
  function open(value: Editor) {
    action.reset();
    setNotice('');
    setEditor(value);
  }
  function submit(request: DuesRequest) {
    action.mutate(request, {
      onSuccess: () => {
        setEditor(null);
        setSelected(new Set());
        setNotice('账本已保存');
      },
      onError: (cause) => setNotice(errorMessage(cause)),
    });
  }
  if (!ledger || !stats)
    return (
      <section className="plugin-card" aria-label="会费智能表格">
        {query.error ? (
          <>
            <p role="alert">{errorMessage(query.error)}</p>
            <button
              type="button"
              onClick={() => {
                void query.refetch();
              }}
            >
              重试加载
            </button>
          </>
        ) : (
          <p role="status">正在读取会费账本…</p>
        )}
      </section>
    );
  return (
    <section className="dues-workspace" aria-label="会费智能表格">
      <header className="dues-heading">
        <div>
          <span className="dues-eyebrow">开发者内置插件 · 本地账本</span>
          <h2>{ledger.groupName}</h2>
          <p className="dues-help">按月掌握会费，保留每一笔记录。</p>
        </div>
        <div className="plugin-actions">
          <button
            type="button"
            disabled={action.isPending}
            onClick={() => open({ type: 'settings', revision: ledger.revision })}
          >
            会费设置
          </button>
          <button
            type="button"
            className="mint-button"
            disabled={action.isPending}
            onClick={() => {
              action.reset();
              setNotice('');
              action.mutate(
                { action: 'sync', revision: ledger.revision },
                {
                  onSuccess: () => {
                    setSelected(new Set());
                    setNotice('成员已同步，本地编辑与缴费记录已保留');
                  },
                  onError: (cause) => setNotice(errorMessage(cause)),
                },
              );
            }}
          >
            {action.isPending && action.variables.action === 'sync' ? '正在同步…' : '同步群成员'}
          </button>
        </div>
      </header>
      <div className="dues-month-row">
        <label>
          查看月份
          <input
            type="month"
            min="2000-01"
            max="2199-12"
            value={month}
            onChange={(e) => {
              if (!/^(20\d{2}|21\d{2})-(0[1-9]|1[0-2])$/u.test(e.target.value)) return;
              setMonth(e.target.value);
              setPage(1);
              setSelected(new Set());
            }}
          />
        </label>
        <button
          type="button"
          onClick={() => {
            setMonth(currentMonth());
            setSelected(new Set());
            setPage(1);
          }}
        >
          回到本月
        </button>
        <span className="dues-help">
          月费 ¥{money(ledger.settings.monthlyCents)} ／ 年费 ¥{money(ledger.settings.annualCents)}
        </span>
      </div>
      <div className="dues-metrics" aria-label="当月会费统计">
        <article>
          <span>已缴人数</span>
          <strong>
            {stats.paid}
            <small> / {stats.total}</small>
          </strong>
          <span className="dues-paid-text">{month} 已覆盖</span>
        </article>
        <article>
          <span>未缴人数</span>
          <strong className="dues-unpaid-text">{stats.unpaid}</strong>
          <button
            type="button"
            onClick={() => {
              changeFilter({ status: 'unpaid', membership: 'active' });
              setTab('members');
            }}
          >
            查看未缴人员 →
          </button>
        </article>
        <article>
          <span>缴纳比率</span>
          <strong>{stats.ratio}%</strong>
          <progress max={100} value={stats.ratio} aria-label="缴纳比率" />
        </article>
        <article>
          <span>起始月收款合计</span>
          <strong>¥{money(stats.receivedCents)}</strong>
          <span>年费计一次，含非在群成员</span>
        </article>
      </div>
      <p className="dues-help">
        人数与比率以当前在群成员为统计范围，不随筛选变化；API
        不提供历史入退群日期。年费覆盖月份计入已缴人数，收款合计按缴费起始月统计。
      </p>
      <div className="dues-sync-state" role="status">
        {ledger.syncedAt
          ? `最近同步：${new Date(ledger.syncedAt).toLocaleString('zh-CN')} · ${ledger.complete ? '名单完整' : '名单不完整，未将缺失成员标记为退群'}${ledger.failedProfiles ? ` · ${ledger.failedProfiles} 位资料获取失败` : ''}`
          : '首次使用请点击“同步群成员”。未同步前不会将空表当成完整群名单。'}
      </div>
      {notice && (
        <p role={action.isError ? 'alert' : 'status'} className="plugin-message">
          {notice}
        </p>
      )}
      <div className="dues-tabs" role="tablist" aria-label="会费视图">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'members'}
          aria-controls="dues-members-panel"
          id="dues-members-tab"
          onClick={() => {
            setTab('members');
            setPage(1);
          }}
        >
          成员表格
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'history'}
          aria-controls="dues-history-panel"
          id="dues-history-tab"
          onClick={() => {
            setTab('history');
            setPage(1);
          }}
        >
          缴费流水
        </button>
      </div>
      <div className="dues-filters">
        <label className="dues-search">
          搜索成员或备注
          <input
            type="search"
            placeholder="群昵称、昵称、wxid、备注"
            maxLength={128}
            value={filter.search}
            onChange={(e) => changeFilter({ search: e.target.value })}
          />
        </label>
        {tab === 'members' && (
          <>
            <label>
              缴费状态
              <select
                value={filter.status}
                onChange={(e) => {
                  const v = z.enum(['all', 'paid', 'unpaid']).parse(e.target.value);
                  changeFilter({ status: v });
                }}
              >
                <option value="all">全部状态</option>
                <option value="paid">所选月已缴</option>
                <option value="unpaid">所选月未缴</option>
              </select>
            </label>
            <label>
              成员范围
              <select
                value={filter.membership}
                onChange={(e) =>
                  changeFilter({
                    membership: z.enum(['active', 'all', 'inactive']).parse(e.target.value),
                  })
                }
              >
                <option value="active">当前在群</option>
                <option value="all">含历史成员</option>
                <option value="inactive">非在群成员</option>
              </select>
            </label>
            <label>
              排序
              <select
                value={filter.sort}
                onChange={(e) =>
                  changeFilter({ sort: z.enum(['unpaid', 'name', 'amount']).parse(e.target.value) })
                }
              >
                <option value="unpaid">未缴优先</option>
                <option value="name">姓名顺序</option>
                <option value="amount">金额从高到低</option>
              </select>
            </label>
            <label>
              最低金额（元）
              <input
                inputMode="decimal"
                value={minimum}
                maxLength={10}
                onChange={(e) => {
                  setMinimum(e.target.value);
                  changeFilter({
                    minAmount: e.target.value === '' ? null : parseMoney(e.target.value),
                  });
                }}
              />
            </label>
            <label>
              最高金额（元）
              <input
                inputMode="decimal"
                value={maximum}
                maxLength={10}
                onChange={(e) => {
                  setMaximum(e.target.value);
                  changeFilter({
                    maxAmount: e.target.value === '' ? null : parseMoney(e.target.value),
                  });
                }}
              />
            </label>
          </>
        )}
      </div>
      {moneyError && tab === 'members' && (
        <p role="alert" className="dues-warning">
          请填写有效金额范围，最低金额不能大于最高金额。
        </p>
      )}
      {tab === 'members' ? (
        <section role="tabpanel" id="dues-members-panel" aria-labelledby="dues-members-tab">
          <div className="dues-batch">
            <span>
              筛选结果 {filtered.length} 人{selected.size > 0 ? ` · 已选 ${selected.size} 人` : ''}
            </span>
            <button
              type="button"
              disabled={selected.size === 0 || action.isPending}
              onClick={() =>
                open({ type: 'pay', revision: ledger.revision, wxids: [...selected], month })
              }
            >
              批量登记已缴
            </button>
            {selected.size > 0 && (
              <button type="button" onClick={() => setSelected(new Set())}>
                清空选择
              </button>
            )}
          </div>
          <div
            className="dues-table-scroll"
            tabIndex={0}
            role="region"
            aria-label="可横向滚动的成员表格"
          >
            <table className="dues-table">
              <caption className="dues-sr-only">
                {month} 成员会费表，未缴成员以暖色及文字标记
              </caption>
              <thead>
                <tr>
                  <th scope="col">
                    <input
                      type="checkbox"
                      aria-label="选择本页所有未缴成员"
                      checked={allChecked}
                      disabled={!pageUnpaid.length || action.isPending}
                      onChange={(e) => {
                        const next = new Set(selected);
                        for (const row of pageUnpaid)
                          if (e.target.checked) next.add(row.member.wxid);
                          else next.delete(row.member.wxid);
                        setSelected(next);
                      }}
                    />
                  </th>
                  <th scope="col">头像</th>
                  <th scope="col">群昵称</th>
                  <th scope="col">昵称</th>
                  <th scope="col">wxid</th>
                  <th scope="col">{month} 状态</th>
                  <th scope="col">缴纳金额</th>
                  <th scope="col">备注</th>
                  <th scope="col">操作</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(({ member, payment }) => (
                  <tr key={member.wxid} className={!payment ? 'dues-row-unpaid' : ''}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`选择${nameOf(member)}`}
                        checked={selected.has(member.wxid)}
                        disabled={Boolean(payment) || action.isPending}
                        onChange={(e) => {
                          const next = new Set(selected);
                          if (e.target.checked) next.add(member.wxid);
                          else next.delete(member.wxid);
                          setSelected(next);
                        }}
                      />
                    </td>
                    <td>
                      <Avatar member={member} />
                    </td>
                    <th scope="row">
                      <span>{member.localGroupNickname ?? (member.groupNickname || '—')}</span>
                      {!member.active && <small className="dues-help">非在群</small>}
                    </th>
                    <td>{member.localNickname ?? (member.nickname || '—')}</td>
                    <td className="dues-wxid">{member.wxid}</td>
                    <td>
                      <span className={`dues-badge ${payment ? 'dues-paid' : 'dues-unpaid'}`}>
                        {payment ? '已缴' : '未缴'}
                      </span>
                      {payment?.kind === 'annual' && <small className="dues-help">年费覆盖</small>}
                    </td>
                    <td className="dues-number">
                      {payment ? `¥${money(payment.amountCents)}` : '—'}
                      {payment?.kind === 'annual' && <small className="dues-help">整笔年费</small>}
                    </td>
                    <td className="dues-note">
                      {payment?.remark && <span>{payment.remark}</span>}
                      {member.remark && <span>{member.remark}</span>}
                      {!payment?.remark && !member.remark && '—'}
                    </td>
                    <td>
                      <div className="dues-row-actions">
                        <button
                          type="button"
                          disabled={action.isPending}
                          onClick={() =>
                            open({ type: 'member', revision: ledger.revision, member })
                          }
                        >
                          编辑
                        </button>
                        {payment ? (
                          <button
                            type="button"
                            disabled={action.isPending}
                            onClick={() =>
                              open({ type: 'void', revision: ledger.revision, payment })
                            }
                          >
                            撤销缴费
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={action.isPending}
                            onClick={() =>
                              open({
                                type: 'pay',
                                revision: ledger.revision,
                                wxids: [member.wxid],
                                month,
                              })
                            }
                          >
                            登记已缴
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length === 0 && (
            <p className="dues-empty">
              {ledger.members.length === 0
                ? '尚无成员资料，请先同步群成员。'
                : '没有符合条件的成员，可调整筛选条件。'}
            </p>
          )}
        </section>
      ) : (
        <section role="tabpanel" id="dues-history-panel" aria-labelledby="dues-history-tab">
          <p className="dues-help">
            显示覆盖所选月份的全部流水，含已撤销记录。撤销年费会影响整段 12 个月。
          </p>
          <div
            className="dues-table-scroll"
            role="region"
            aria-label="可横向滚动的缴费流水"
            tabIndex={0}
          >
            <table className="dues-table">
              <caption className="dues-sr-only">缴费历史记录</caption>
              <thead>
                <tr>
                  <th scope="col">成员</th>
                  <th scope="col">类型</th>
                  <th scope="col">覆盖月份</th>
                  <th scope="col">金额</th>
                  <th scope="col">备注</th>
                  <th scope="col">登记时间</th>
                  <th scope="col">状态／操作</th>
                </tr>
              </thead>
              <tbody>
                {history
                  .slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
                  .map((payment) => {
                    const member = ledger.members.find((m) => m.wxid === payment.wxid);
                    return (
                      <tr key={payment.id}>
                        <th scope="row">{member ? nameOf(member) : payment.wxid}</th>
                        <td>
                          {payment.kind === 'annual'
                            ? '年费'
                            : payment.kind === 'monthly'
                              ? '月费'
                              : '自定义'}
                        </td>
                        <td>
                          {payment.month} — {addMonths(payment.month, payment.months - 1)}
                        </td>
                        <td className="dues-number">¥{money(payment.amountCents)}</td>
                        <td className="dues-note">
                          {payment.remark}
                          {payment.voidReason && <small>撤销原因：{payment.voidReason}</small>}
                        </td>
                        <td>{new Date(payment.recordedAt).toLocaleString('zh-CN')}</td>
                        <td>
                          {payment.voidedAt ? (
                            <span className="dues-help">
                              已撤销 · {new Date(payment.voidedAt).toLocaleString('zh-CN')}
                            </span>
                          ) : (
                            <button
                              type="button"
                              disabled={action.isPending}
                              onClick={() =>
                                open({ type: 'void', revision: ledger.revision, payment })
                              }
                            >
                              撤销缴费
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          {history.length === 0 && <p className="dues-empty">所选月份尚无缴费流水。</p>}
        </section>
      )}
      <nav className="dues-pagination" aria-label="表格分页">
        <span>
          共 {count} 条 · 每页 {PAGE_SIZE} 条
        </span>
        <button type="button" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>
          上一页
        </button>
        <span>
          {currentPage} / {pages}
        </span>
        <button
          type="button"
          disabled={currentPage >= pages}
          onClick={() => setPage(currentPage + 1)}
        >
          下一页
        </button>
      </nav>
      {editor && (
        <DuesEditor
          editor={editor}
          ledger={ledger}
          busy={action.isPending}
          failure={action.isError ? errorMessage(action.error) : ''}
          onClose={() => {
            setEditor(null);
            action.reset();
          }}
          onSubmit={submit}
        />
      )}
    </section>
  );
}
