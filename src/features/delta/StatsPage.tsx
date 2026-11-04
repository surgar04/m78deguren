import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { deltaRecordSchema, deltaStatsSchema } from '@/lib/game-room-contracts';
import { isDesktop } from '@/lib/desktop';
import { useDeltaQuery, useDeltaAction, useGameRoom } from './repository';
import { CopyButton, DeltaEmpty, DeltaFeedback, DeltaImage } from './components';
import {
  analyze,
  battleRows,
  collectionKind,
  firstNumber,
  format,
  number,
  record,
  rows,
  seasonStats,
  string,
  inSeason,
} from './stats-model';

const tabs = [
  ['personal', '个人详情'],
  ['battles', '对局战绩'],
  ['analysis', '战绩分析'],
  ['loot', '出货统计'],
  ['collections', '我的藏品'],
] as const;
const labels: Record<string, string> = {
  killCnt: '击杀',
  death: '死亡',
  gameTime: '游戏时长（秒）',
  gainedPrice: '带出价值',
  ProfitLoss: '净收益',
  gameResult: '撤离结果',
  isWinner: '胜利状态',
  mapId: '地图 ID',
  armedForceId: '干员 ID',
  roomId: '对局 ID',
  startTime: '开局时间',
  score: '得分',
  playerName: '玩家',
  rank: '排名',
  total: '场次',
  win: '成功场次',
  kill: '击杀',
  total_value: '总价值',
  total_game_time: '游戏时长',
  total_fight: '总对局',
  total_kill: '击杀',
  total_death: '死亡',
};
/** 所有已返回的字段可展开查看，赛季新增字段不会被固定卡片悄悄丢弃。 */
function DataFields({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (depth > 5) return <span>深层数据请在官方战绩页查看</span>;
  if (value == null) return <span>暂无数据</span>;
  if (Array.isArray(value))
    return (
      <div>
        {z
          .array(z.unknown())
          .parse(value)
          .slice(0, 120)
          .map((item, index) => (
            <details key={index}>
              <summary>条目 {index + 1}</summary>
              <DataFields value={item} depth={depth + 1} />
            </details>
          ))}
      </div>
    );
  if (typeof value !== 'object')
    return (
      <span>{string(value) || (typeof value === 'boolean' ? (value ? '是' : '否') : '—')}</span>
    );
  return (
    <dl className="delta-fields">
      {Object.entries(record(value))
        .slice(0, 150)
        .map(([key, item]) => (
          <div key={key}>
            <dt>{labels[key] || key}</dt>
            <dd>
              {item && typeof item === 'object' ? (
                <details>
                  <summary>展开</summary>
                  <DataFields value={item} depth={depth + 1} />
                </details>
              ) : (
                <DataFields value={item} depth={depth + 1} />
              )}
            </dd>
          </div>
        ))}
    </dl>
  );
}
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="delta-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
export default function StatsPage() {
  const query = useDeltaQuery({ operation: 'stats' }, deltaStatsSchema);
  const room = useGameRoom();
  const cache = useQueryClient();
  const sourceRevision = room.data?.account.updatedAt;
  const cachedRevision = query.data?.updatedAt;
  // 大型藏品/对局缓存只在原生采集版本变化时读取，授权等待只轮询少量角色状态。
  useEffect(() => {
    if (sourceRevision !== undefined && sourceRevision !== cachedRevision)
      void cache.invalidateQueries({ queryKey: ['delta', { operation: 'stats' }] });
  }, [cache, sourceRevision, cachedRevision]);
  const dictionaries = useDeltaQuery({ operation: 'dictionaries' }, deltaRecordSchema);
  const action = useDeltaAction();
  const [tab, setTab] = useState('personal');
  const [mode, setMode] = useState<'sol' | 'tdm'>('sol');
  const [sid, setSid] = useState('0');
  const [filterAgent, setFilterAgent] = useState('');
  const [filterMap, setFilterMap] = useState('');
  const [page, setPage] = useState(1);
  const [category, setCategory] = useState('all');
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const data = query.data?.data ?? {};
  const account = query.data?.account;
  const report =
    string(data[`report_${mode}_sid`] ?? '0') === sid ? data[`report_${mode}`] : undefined;
  // 地图统计也有独立赛季身份；某个端点失败时不能误展示上一次成功的其他赛季。
  const mapStats =
    string(data[`maps_${mode}_sid`]) === sid && !record(data['errors'])[`maps_${mode}`]
      ? record(data[`maps_${mode}`])
      : {};
  const stats = seasonStats(report, mode);
  const duration = firstNumber(
    stats,
    'total_game_time',
    mode === 'sol' ? 'solDuration' : 'tdmDuration',
  );
  const seasons = rows(record(data['seasons'])['items']);
  const records = inSeason(
    battleRows(data, mode),
    seasons.find((row) => string(row['season_id']) === sid),
    sid,
  );
  const agents = rows(record(dictionaries.data?.['agents'])['data']);
  const maps = rows(record(dictionaries.data?.['maps'])['mapDetail']);
  const skinsRaw = record(dictionaries.data?.['skins']);
  const jData = record(skinsRaw['jData']);
  const skins = rows(
    record(record(jData['data'])['data'])['list'] ?? record(jData['data'])['list'],
  );
  const agentName = (id: unknown) =>
    string(agents.find((row) => string(row['id']) === string(id))?.['name']) ||
    `干员 ${string(id) || '未知'}`;
  const mapName = (id: unknown) =>
    string(maps.find((row) => string(row['id']) === string(id))?.['name']) ||
    `地图 ${string(id) || '未知'}`;
  const filtered = records
    .filter(
      (row) =>
        (!filterAgent || string(row['armedForceId']) === filterAgent) &&
        (!filterMap || string(row['mapId']) === filterMap),
    )
    .reverse();
  const pages = Math.max(1, Math.ceil(filtered.length / 10));
  const safePage = Math.min(page, pages);
  const analysis = analyze(records, report, mode);
  const collected: Record<string, unknown>[] = [
    ...rows(record(data['collectibles'])['collectibles']),
    ...rows(record(data['collectibles'])['opers']).map((item) => ({
      ...item,
      secondClass: item['secondClass'] ?? 'operator',
    })),
  ];
  const chooseSeason = (value: string, queue: 'sol' | 'tdm') => {
    setSid(value);
    setMode(queue);
    setPage(1);
    setDetail(null);
    action.mutate({ operation: 'season', sid: value, queue });
  };
  return (
    <>
      <div className="delta-section-heading">
        <h2>WeGame 战绩统计</h2>
        <button
          disabled={!isDesktop() || action.isPending}
          onClick={() => action.mutate({ operation: 'auth-open' })}
        >
          {account?.phase === 'connected' ? '重新授权' : 'QQ / 微信扫码授权'}
        </button>
        <button
          disabled={!isDesktop() || action.isPending}
          onClick={() => action.mutate({ operation: 'refresh' })}
        >
          {action.isPending ? '正在请求官方数据…' : '刷新数据'}
        </button>
        <button
          disabled={!isDesktop() || action.isPending}
          onClick={() => {
            if (window.confirm('退出 WeGame 数据源并清除本机角色和战绩缓存？不会删除云端账号。'))
              action.mutate({ operation: 'logout', consent: true });
          }}
        >
          退出登录
        </button>
      </div>
      <p className="delta-caption">
        {account?.phase === 'connected'
          ? '已验证官方会话'
          : account?.phase === 'authorizing'
            ? '正在等待官方窗口完成扫码'
            : '尚未验证会话，已有数据仅作为本机缓存'}{' '}
        ·{' '}
        {query.data?.updatedAt
          ? `采集时间 ${new Date(query.data.updatedAt).toLocaleString()}`
          : '尚未采集'}
        。仅支持已绑定的三角洲国服角色，国际服没有此 WeGame 数据源。
      </p>
      <DeltaFeedback
        error={
          query.error ??
          action.error ??
          (account?.phase === 'error' ? new Error(account.message) : undefined)
        }
        notice={account?.phase === 'error' ? '' : account?.message}
      />
      {account?.phase === 'authorizing' && (
        <button
          disabled={action.isPending}
          onClick={() => action.mutate({ operation: 'auth-cancel' })}
        >
          取消本次授权
        </button>
      )}
      <div className="delta-filters">
        <select
          aria-label="战绩模式"
          value={mode}
          disabled={action.isPending}
          onChange={(event) => chooseSeason(sid, z.enum(['sol', 'tdm']).parse(event.target.value))}
        >
          <option value="sol">烽火地带</option>
          <option value="tdm">全面战场</option>
        </select>
        <select
          aria-label="战绩赛季"
          value={sid}
          disabled={action.isPending}
          onChange={(event) => chooseSeason(event.target.value, mode)}
        >
          <option value="0">赛季总览</option>
          {seasons
            .filter((row) => string(row['season_id']) !== '0')
            .map((row) => (
              <option key={string(row['season_id'])} value={string(row['season_id'])}>
                {string(row['season_name']) || `S${string(row['season_id'])}`}
              </option>
            ))}
        </select>
      </div>
      <nav className="delta-tabs" aria-label="战绩栏目">
        {tabs.map(([id, label]) => (
          <button className={tab === id ? 'active' : ''} key={id} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </nav>
      {Object.keys(record(data['errors'])).length > 0 && (
        <details className="delta-error">
          <summary>部分数据源未返回，展开查看</summary>
          <DataFields value={data['errors']} />
        </details>
      )}
      {tab === 'personal' && (
        <>
          <div className="delta-stat-grid">
            <Stat
              label="对局"
              value={format(
                firstNumber(
                  stats,
                  'total_fight',
                  mode === 'sol' ? 'solTotalFight' : 'tdmTotalFight',
                ),
              )}
            />
            <Stat
              label={mode === 'sol' ? '撤离率' : '胜率'}
              value={format(
                firstNumber(
                  stats,
                  mode === 'sol' ? 'escape_ratio' : 'win_ratio',
                  mode === 'sol' ? 'solEscaperatio' : 'tdmSuccessRatio',
                ),
                2,
                '%',
              )}
            />
            <Stat
              label="KD"
              value={format(
                firstNumber(
                  stats,
                  'kill_death_ratio',
                  mode === 'sol' ? 'solKdratio' : 'tdmKdRatio',
                ),
                2,
              )}
            />
            <Stat
              label="总击杀"
              value={format(
                firstNumber(stats, 'total_kill', mode === 'sol' ? 'solTotalKill' : 'tdmTotalKill'),
              )}
            />
            <Stat
              label="战斗时长"
              value={duration === null ? '—' : format(duration / 3600, 1, ' 小时')}
            />
            <Stat label="角色等级" value={account?.level || '—'} />
          </div>
          <details>
            <summary>全部角色与赛季字段</summary>
            <DataFields value={{ role: data['role'], season: report }} />
          </details>
        </>
      )}
      {tab === 'battles' && (
        <>
          <div className="delta-filters">
            <select
              aria-label="干员筛选"
              value={filterAgent}
              onChange={(event) => {
                setFilterAgent(event.target.value);
                setPage(1);
              }}
            >
              <option value="">全部干员</option>
              {[...new Set(records.map((row) => string(row['armedForceId'])))]
                .filter(Boolean)
                .map((id) => (
                  <option key={id} value={id}>
                    {agentName(id)}
                  </option>
                ))}
            </select>
            <select
              aria-label="地图筛选"
              value={filterMap}
              onChange={(event) => {
                setFilterMap(event.target.value);
                setPage(1);
              }}
            >
              <option value="">全部地图</option>
              {[...new Set(records.map((row) => string(row['mapId'])))]
                .filter(Boolean)
                .map((id) => (
                  <option key={id} value={id}>
                    {mapName(id)}
                  </option>
                ))}
            </select>
          </div>
          <div className="delta-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>时间 / 地图</th>
                  <th>干员</th>
                  <th>结果</th>
                  <th>击杀 / 死亡</th>
                  <th>战损比</th>
                  <th>收益</th>
                  <th>详情</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice((safePage - 1) * 10, safePage * 10).map((row, index) => (
                  <tr key={string(row['roomId']) || index}>
                    <td>
                      {string(row['startTime']) &&
                        new Date(Number(row['startTime']) * 1000).toLocaleString()}
                      <br />
                      {mapName(row['mapId'])}
                    </td>
                    <td>{agentName(row['armedForceId'])}</td>
                    <td>
                      {mode === 'sol'
                        ? Number(row['gameResult']) === 0
                          ? '撤离'
                          : '未撤离'
                        : Number(row['isWinner']) === 1
                          ? '胜利'
                          : '失利'}
                    </td>
                    <td>
                      {format(row['killCnt'])} / {format(row['death'])}
                    </td>
                    <td>{format(row['ProfitLoss'])}</td>
                    <td>
                      <button
                        disabled={action.isPending}
                        onClick={() => {
                          setDetail(row);
                          action.mutate({
                            operation: 'detail',
                            room_id: string(row['roomId']),
                            start_time: string(row['startTime']),
                            queue: mode,
                          });
                        }}
                      >
                        查看
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!filtered.length && (
            <DeltaEmpty>
              暂无已采集对局；请扫码并刷新。列表仅覆盖官方接口实际返回的历史。
            </DeltaEmpty>
          )}
          <div className="delta-pagination">
            <button disabled={safePage <= 1} onClick={() => setPage((value) => value - 1)}>
              上一页
            </button>
            {safePage} / {pages}
            <button disabled={safePage >= pages} onClick={() => setPage((value) => value + 1)}>
              下一页
            </button>
          </div>
          {detail && (
            <section className="delta-detail">
              <div className="delta-section-heading">
                <h3>对局详情</h3>
                <button onClick={() => setDetail(null)}>收起</button>
                <CopyButton value={JSON.stringify(detail, null, 2)} label="复制对局摘要" />
              </div>
              {action.isPending ? (
                <p role="status">正在请求详情…</p>
              ) : (
                <DataFields value={{ summary: detail, official: data['detail'] }} />
              )}
            </section>
          )}
        </>
      )}
      {tab === 'analysis' &&
        (analysis ? (
          <>
            <p className="delta-warning">
              以下 PPS、MMR、MES 和压力分布为客户端根据已采集的 {analysis.count}{' '}
              场对局计算的参考指标，不是官方隐藏匹配分，不是未来对局保证。
            </p>
            <div className="delta-stat-grid">
              <Stat label="PPS 表现参考分 / 2000" value={format(analysis.pps)} />
              <Stat label="MMR 实力参考分 / 3000" value={format(analysis.mmr)} />
              <Stat label="MES 波动压力分 / 1000" value={format(analysis.mes)} />
              <Stat label="样本 KD" value={format(analysis.kd, 2)} />
              <Stat label="成功率" value={format(analysis.winRate * 100, 1, '%')} />
              <Stat label="平均净收益" value={format(analysis.profit)} />
            </div>
            <h3>未来对局压力参考</h3>
            {['较低', '常规', '较高', '很高'].map((label, index) => (
              <div className="delta-pressure" key={label}>
                <span>{label}</span>
                <progress value={analysis.pressure[index] ?? 0} max={100} />
                <b>{analysis.pressure[index]}%</b>
              </div>
            ))}
            <details>
              <summary>计算范围与局限</summary>
              <p>
                沿用 NexBox
                的公开评分因子：每分钟带出价值、KD、撤离/胜率、平均盈亏和最近十场波动；修正百分率单位和负分下界。当前赛季官方战报优先，缺项才使用已采集对局。历史样本范围受官方分页限制，不代表完整账号历史。
              </p>
            </details>
          </>
        ) : (
          <DeltaEmpty>至少需要一场真实对局，才能生成客户端参考分析。</DeltaEmpty>
        ))}
      {tab === 'loot' && (
        <>
          <h3>地图收益与撤离</h3>
          <div className="delta-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>地图</th>
                  <th>场次 / 成功</th>
                  <th>撤离 / 胜率</th>
                  <th>击杀 / 死亡</th>
                  <th>总价值 / 场均</th>
                </tr>
              </thead>
              <tbody>
                {rows(mapStats['maps']).map((row, index) => (
                  <tr key={index}>
                    <td>{mapName(row['mapid'])}</td>
                    <td>
                      {format(row['total'])} / {format(row['win'])}
                    </td>
                    <td>
                      {Number(row['total']) > 0
                        ? format((Number(row['win']) / Number(row['total'])) * 100, 1, '%')
                        : '—'}
                    </td>
                    <td>
                      {format(row['kill'])} / {format(row['death'])}
                    </td>
                    <td>
                      {Number(row['death']) > 0 && number(row['kill']) !== null
                        ? format(Number(row['kill']) / Number(row['death']), 2)
                        : '—'}
                    </td>
                    <td>
                      {format(row['total_value'])} /{' '}
                      {Number(row['total']) > 0
                        ? format(Number(row['total_value']) / Number(row['total']))
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="delta-caption">
            切换赛季会读取官方地图统计，不把本页有限对局样本当成完整赛季收益。
          </p>
          <details>
            <summary>每日出货与全部统计字段</summary>
            <DataFields value={data['daily']} />
          </details>
        </>
      )}
      {tab === 'collections' && (
        <>
          <div className="delta-filters">
            <select
              aria-label="藏品分类"
              value={category}
              onChange={(event) => {
                setCategory(event.target.value);
                setPage(1);
              }}
            >
              {[
                ['all', '全部藏品'],
                ['weapon', '武器 / 近战'],
                ['operator', '干员'],
                ['vehicle', '载具'],
                ['pendant', '挂饰'],
                ['collection', '典藏'],
                ['other', '其他'],
              ].map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="delta-collections">
            {collected
              .filter(
                (item) =>
                  category === 'all' ||
                  collectionKind(
                    item,
                    skins.find(
                      (skin) => string(skin['objectID']) === string(item['id'] ?? item['gid']),
                    ) ?? {},
                  ) === category,
              )
              .slice(0, page * 60)
              .map((item, index) => {
                const dictionary: Record<string, unknown> =
                  skins.find(
                    (skin) => string(skin['objectID']) === string(item['id'] ?? item['gid']),
                  ) ??
                  (() => {
                    const agent = agents.find(
                      (row) => string(row['id']) === string(item['id'] ?? item['gid']),
                    );
                    return agent
                      ? { ...agent, objectName: agent['name'], pic: agent['avatar'] }
                      : {};
                  })();
                return (
                  <article key={`${string(item['id'] ?? item['gid'])}-${index}`}>
                    <DeltaImage
                      src={string(dictionary['pic'] ?? item['pic'])}
                      alt={string(dictionary['objectName'] ?? item['name']) || '藏品'}
                    />
                    <strong>
                      {string(dictionary['objectName'] ?? item['name']) ||
                        `藏品 ${string(item['id'] ?? item['gid'])}`}
                    </strong>
                    <details>
                      <summary>详情</summary>
                      <DataFields value={item} />
                    </details>
                  </article>
                );
              })}
          </div>
          {!collected.length && <DeltaEmpty>暂无官方藏品数据，请先连接角色并刷新。</DeltaEmpty>}
          {collected.length > page * 60 && (
            <button onClick={() => setPage((value) => value + 1)}>加载更多藏品</button>
          )}
        </>
      )}
      <DeltaFeedback error={dictionaries.error} />
    </>
  );
}
