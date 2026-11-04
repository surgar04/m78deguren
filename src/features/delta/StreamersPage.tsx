import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { deltaStreamersSchema } from '@/lib/game-room-contracts';
import { useDeltaQuery, useDeltaAction } from './repository';
import { filledSetting } from './streamer-model';
import { CopyButton, DeltaEmpty, DeltaFeedback, DeltaImage } from './components';
const groups: Record<string, string> = {
  game: '游戏 / 灵敏度 / 战斗 / 音频',
  graphics: '画面设置',
  nvidia: 'NVIDIA 控制面板',
  'nvidia-app': 'NVIDIA App',
  monitor: '显示器',
  'gun-codes': '改枪码',
  steam: 'Steam 启动项',
  gear: '电脑外设',
  'audio-eq': '音频均衡器',
};
/** 资料是只读参考，不提供“将所有配置写入游戏”的误导按钮；未填写字段可统一隐藏。 */
export default function StreamersPage() {
  const { id } = useParams();
  const [search, setSearch] = useState('');
  const [hideEmpty, setHideEmpty] = useState(true);
  const [category, setCategory] = useState('all');
  const [limit, setLimit] = useState(24);
  const query = useDeltaQuery({ operation: 'streamers', refresh: false }, deltaStreamersSchema);
  const refresh = useDeltaAction();
  const entries = (query.data?.data.entries ?? []).filter(
    (row) => !row.deleted && /三角洲|delta/iu.test(row.game),
  );
  const selected = id ? entries.find((row) => row.id === id) : undefined;
  const filtered = entries.filter((row) =>
    `${row.name} ${row.platform} ${row.tags?.join(' ') ?? ''}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <>
      <div className="delta-section-heading">
        <h2>{id ? selected?.name || '主播档案' : '主播配置目录'}</h2>
        {id && <Link to="/delta-force/streamers">← 返回目录</Link>}
        <button
          disabled={query.isFetching || refresh.isPending}
          onClick={() => {
            refresh.mutate({ operation: 'streamers', refresh: true });
          }}
        >
          刷新资料
        </button>
      </div>
      <p className="delta-caption">
        资料来源 gjts.cn「冠军导航」{query.data?.cached ? ' · 网络不可用，显示离线缓存' : ''}
        {query.data?.fetchedAt
          ? ` · 本机获取于 ${new Date(query.data.fetchedAt).toLocaleDateString()}`
          : ''}
        。仅供参考，更新日期以各档案标注为准。
      </p>
      <DeltaFeedback error={query.error ?? refresh.error} />
      {query.isFetching && <p role="status">正在加载主播资料…</p>}
      {!id && (
        <>
          <input
            className="delta-wide-search"
            aria-label="搜索主播"
            value={search}
            maxLength={100}
            placeholder="搜索主播、平台或标签…"
            onChange={(event) => {
              setSearch(event.target.value);
              setLimit(24);
            }}
          />
          <div className="delta-streamer-grid">
            {filtered.slice(0, limit).map((row) => (
              <Link key={row.id} to={`/delta-force/streamers/${encodeURIComponent(row.id)}`}>
                <DeltaImage src={row.avatar} alt={row.name} />
                <div>
                  <strong>{row.name}</strong>
                  <p>
                    {row.platform} · {row.tags?.join(' / ') || '三角洲行动'}
                  </p>
                  <small>资料更新 {row.updated?.slice(0, 10) || '未标注'}</small>
                </div>
                <span>›</span>
              </Link>
            ))}
          </div>
          {!query.isFetching && !filtered.length && <DeltaEmpty>暂无匹配的主播资料。</DeltaEmpty>}
          {filtered.length > limit && (
            <button onClick={() => setLimit((value) => value + 24)}>
              加载更多 · {limit} / {filtered.length}
            </button>
          )}
        </>
      )}
      {id && selected && (
        <>
          <div className="delta-role">
            <DeltaImage src={selected.avatar} alt={selected.name} />
            <div>
              <h3>{selected.name}</h3>
              <p>
                {selected.platform} · {selected.game} · 更新时间{' '}
                {selected.profile?.updated || selected.updated?.slice(0, 10) || '未填写'}
              </p>
            </div>
          </div>
          <div className="delta-filters">
            <label>
              <input
                type="checkbox"
                checked={hideEmpty}
                onChange={(event) => setHideEmpty(event.target.checked)}
              />
              隐藏未填写项目
            </label>
            <select
              aria-label="主播配置栏目"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              <option value="all">全部配置</option>
              {Object.entries(groups).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          {selected.profile?.groups
            ?.filter((group) => category === 'all' || group.tab === category)
            .map((group) => {
              const fields = group.fields.filter(
                (field) =>
                  !hideEmpty ||
                  filledSetting(field.value, field.secondary, field.behavior, field.note),
              );
              return fields.length ? (
                <section className="delta-streamer-section" key={group.id}>
                  <h3>
                    {groups[group.tab] || group.tab} · {group.title}
                  </h3>
                  <dl className="delta-fields">
                    {fields.map((field) => (
                      <div key={field.id}>
                        <dt>{field.label}</dt>
                        <dd>
                          <span>
                            {field.value || field.secondary || '未填写'}
                            {field.behavior ? ` · ${field.behavior}` : ''}
                            {field.note && <small>{field.note}</small>}
                          </span>
                          {(field.value || field.secondary) && (
                            <CopyButton value={field.value || field.secondary || ''} />
                          )}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ) : null;
            })}
          {(category === 'all' || category === 'gear') && (
            <section>
              <h3>电脑与外设</h3>
              <div className="delta-gear-grid">
                {selected.profile?.equipment?.map((item) => (
                  <article key={item.id}>
                    <DeltaImage src={item.imageUrl} alt={`${item.brand} ${item.model}`} />
                    <strong>
                      {item.brand} {item.model}
                    </strong>
                    <p>
                      {item.category} {item.dpi ? `· DPI ${item.dpi}` : ''}{' '}
                      {item.pollingRate ? `· ${item.pollingRate}` : ''}
                    </p>
                    <CopyButton
                      value={`${item.brand} ${item.model}${item.dpi ? ` DPI ${item.dpi}` : ''}`}
                    />
                  </article>
                ))}
              </div>
            </section>
          )}
        </>
      )}
      {id && !selected && !query.isFetching && (
        <DeltaEmpty>该主播档案不存在、已移除或尚未获取，请返回目录重试。</DeltaEmpty>
      )}
    </>
  );
}
