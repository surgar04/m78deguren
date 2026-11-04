import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import {
  deltaCategorySchema,
  deltaWeaponSchema,
  deltaLoadoutsSchema,
} from '@/lib/game-room-contracts';
import { isDesktop } from '@/lib/desktop';
import { useDeltaQuery, useDeltaAction } from './repository';
import { CopyButton, DeltaEmpty, DeltaFeedback } from './components';

const passwordsSchema = z.object({
  items: z.array(z.object({ name: z.string(), password: z.string().regex(/^\d{4}$/u) })).max(12),
  fetchedAt: z.number(),
  source: z.string(),
});
/** 分类、武器和页码共同构成查询键，快速切换筛选时不会串回上一次请求的结果。 */
export default function CommunityPage() {
  const [category, setCategory] = useState<number | null>(null);
  const [weapon, setWeapon] = useState('');
  const [keyword, setKeyword] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [submit, setSubmit] = useState(false);
  const [uploadCategory, setUploadCategory] = useState(1);
  const categories = useDeltaQuery(
    { operation: 'categories' },
    z.array(deltaCategorySchema).max(100),
  );
  const weapons = useDeltaQuery(
    { operation: 'weapons', category: category ?? 1 },
    z.array(deltaWeaponSchema).max(500),
  );
  const loadouts = useDeltaQuery(
    { operation: 'loadouts', category, weapon, search, page },
    deltaLoadoutsSchema,
  );
  const passwords = useDeltaQuery({ operation: 'passwords' }, passwordsSchema, 300_000);
  const uploadWeapons = useDeltaQuery(
    { operation: 'weapons', category: uploadCategory },
    z.array(deltaWeaponSchema).max(500),
  );
  const action = useDeltaAction();
  const publish = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const field = (key: string) => {
      const value = fields.get(key);
      return typeof value === 'string' ? value : '';
    };
    action.mutate(
      {
        operation: 'submit',
        category: Number(fields.get('category')),
        weapon: field('weapon'),
        code: field('code'),
        cost: Number(fields.get('cost')),
        description: field('description'),
        author: field('author'),
        consent: true,
      },
      { onSuccess: () => setSubmit(false) },
    );
  };
  return (
    <>
      <div className="delta-section-heading">
        <h2>每日密码</h2>
        <button
          disabled={!isDesktop() || passwords.isFetching}
          onClick={() => {
            void passwords.refetch();
          }}
        >
          刷新密码
        </button>
        <span>{passwords.data?.source || '社区数据，非官方接口'}</span>
      </div>
      <DeltaFeedback error={passwords.error} />
      <div className="delta-passwords">
        {passwords.data?.items.map((item) => (
          <div key={item.name}>
            <span>{item.name}</span>
            <strong>{item.password}</strong>
            <CopyButton value={item.password} />
          </div>
        ))}
      </div>
      <div className="delta-quick-links">
        <button
          disabled={!isDesktop()}
          onClick={() => action.mutate({ operation: 'link', key: 'map' })}
        >
          官方地图 ↗
        </button>
        <button
          disabled={!isDesktop()}
          onClick={() => action.mutate({ operation: 'link', key: 'wallpaper' })}
        >
          官方壁纸 ↗
        </button>
        <Link to="/delta-force/random-equipment">随机装备</Link>
        <Link to="/delta-force/streamers">主播设置参考</Link>
      </div>
      <div className="delta-section-heading">
        <h2>社区改枪码</h2>
        <span>NexBox 社区 · 审核后展示</span>
        <button
          className="primary"
          disabled={!isDesktop()}
          onClick={() => {
            action.reset();
            setUploadCategory(category ?? categories.data?.[0]?.id ?? 1);
            setSubmit((value) => !value);
          }}
        >
          提交改枪码
        </button>
      </div>
      <div className="delta-filters">
        <select
          aria-label="改枪码分类"
          value={category ?? ''}
          onChange={(event) => {
            setCategory(event.target.value ? Number(event.target.value) : null);
            setWeapon('');
            setPage(1);
          }}
        >
          <option value="">全部分类</option>
          {categories.data?.map((row) => (
            <option key={row.id} value={row.id}>
              {row.name} · {row.loadout_count}
            </option>
          ))}
        </select>
        <select
          aria-label="武器筛选"
          disabled={!category}
          value={weapon}
          onChange={(event) => {
            setWeapon(event.target.value);
            setPage(1);
          }}
        >
          <option value="">全部武器</option>
          {weapons.data?.map((row) => (
            <option key={row.weapon_name} value={row.weapon_name}>
              {row.weapon_name}
            </option>
          ))}
        </select>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setSearch(keyword.trim());
            setPage(1);
            if (keyword.trim() === search) void loadouts.refetch();
          }}
        >
          <input
            aria-label="搜索改枪码"
            value={keyword}
            maxLength={120}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="搜索武器、作者或说明…"
          />
          <button disabled={!isDesktop()}>搜索</button>
        </form>
      </div>
      <DeltaFeedback
        error={categories.error ?? weapons.error ?? loadouts.error ?? action.error}
        notice={action.notice}
      />
      {submit && (
        <form className="delta-submit" onSubmit={publish}>
          <h3>提交审核</h3>
          <p>提交至 NexBox 社区服务，由该社区管理员审核；请勿提交个人联系方式或无关资料。</p>
          <div className="delta-form-grid">
            <label>
              分类
              <select
                required
                name="category"
                value={uploadCategory}
                onChange={(event) => setUploadCategory(Number(event.target.value))}
              >
                {categories.data?.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              武器名称
              <select
                required
                name="weapon"
                key={uploadCategory}
                defaultValue=""
                disabled={uploadWeapons.isFetching}
              >
                <option value="">请选择武器</option>
                {uploadWeapons.data?.map((row) => (
                  <option key={row.weapon_name} value={row.weapon_name}>
                    {row.weapon_name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              改枪费用
              <input required name="cost" type="number" min="1" max="10000000000" step="1" />
            </label>
            <label>
              作者
              <input name="author" maxLength={80} placeholder="匿名" />
            </label>
            <label className="full">
              改枪码
              <input required name="code" maxLength={300} />
            </label>
            <label className="full">
              说明
              <textarea name="description" maxLength={2000} rows={3} />
            </label>
          </div>
          <label>
            <input type="checkbox" required /> 我确认内容可公开，并提交社区审核
          </label>
          <div>
            <button className="primary" disabled={action.isPending}>
              提交审核
            </button>
            <button type="button" onClick={() => setSubmit(false)}>
              取消
            </button>
          </div>
        </form>
      )}
      {loadouts.isFetching && <p role="status">正在读取社区改枪码…</p>}
      <div className="delta-loadouts">
        {loadouts.data?.data.map((row) => (
          <article key={row.id}>
            <div className="delta-section-heading">
              <h3>{row.weapon_name}</h3>
              <span>
                {row.category_name} · {row.cost.toLocaleString()} 哈夫币
              </span>
            </div>
            <code>{row.code}</code>
            <p>{row.description || '未填写说明'}</p>
            <footer>
              <span>
                {row.author || '匿名'} · {row.created_at.split(' ')[0]}
              </span>
              <CopyButton value={row.code} />
              <button
                disabled={action.isPending}
                onClick={() => action.mutate({ operation: 'like', id: row.id })}
              >
                ♡ {row.likes}
              </button>
              <button
                disabled={action.isPending}
                onClick={() => {
                  if (window.confirm('将此改枪码报告为不可用？请先在游戏内确认。'))
                    action.mutate({ operation: 'report', id: row.id, consent: true });
                }}
              >
                报告不可用
              </button>
            </footer>
          </article>
        ))}
      </div>
      {!loadouts.isFetching && !loadouts.data?.data.length && (
        <DeltaEmpty>
          {isDesktop()
            ? '没有匹配的改枪码，可调整分类或搜索条件。'
            : '在桌面应用内加载真实社区改枪码。'}
        </DeltaEmpty>
      )}
      <div className="delta-pagination">
        <button
          disabled={page <= 1 || loadouts.isFetching}
          onClick={() => setPage((value) => value - 1)}
        >
          上一页
        </button>
        <span>
          第 {page} / {Math.max(1, loadouts.data?.totalPages ?? 1)} 页 · 共{' '}
          {loadouts.data?.total ?? 0} 条
        </span>
        <button
          disabled={page >= (loadouts.data?.totalPages ?? 1) || loadouts.isFetching}
          onClick={() => setPage((value) => value + 1)}
        >
          下一页
        </button>
      </div>
    </>
  );
}
