import { Link } from 'react-router-dom';
import { usePlugins } from './repository';
import { PluginView } from './PluginView';
import './plugins.css';

/** 界面入口从已授权插件派生，不把插件目录复制到另一个状态仓库。 */
export function PluginContributions({
  kind,
  search = '',
}: {
  kind: 'tool' | 'widget' | 'command';
  search?: string;
}) {
  const query = usePlugins();
  if (query.data?.safeMode) return null;
  const entries =
    query.data?.items
      .filter((p) => p.enabled && !p.quarantined)
      .flatMap((plugin) =>
        plugin.manifest.contributions
          .filter(
            (c) =>
              c.kind === kind &&
              `${c.title} ${plugin.manifest.name}`
                .toLocaleLowerCase()
                .includes(search.toLocaleLowerCase()),
          )
          .map((contribution) => ({ plugin, contribution })),
      ) ?? [];
  if (!entries.length) return null;
  return (
    <section className="plugin-contributions" aria-label="插件扩展">
      <h2>插件扩展</h2>
      <div className="plugin-grid">
        {entries.map(({ plugin, contribution }) => (
          <div key={`${plugin.manifest.id}:${contribution.id}`}>
            {kind === 'widget' ? (
              <PluginView plugin={plugin} command={contribution.command} />
            ) : (
              <Link
                to={`/plugins/${plugin.manifest.id}?command=${encodeURIComponent(contribution.command)}`}
              >
                <strong>{contribution.title}</strong>
                <small className="plugin-secondary">{plugin.manifest.name}</small>
              </Link>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
