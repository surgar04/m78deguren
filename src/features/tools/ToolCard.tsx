import {
  faCrosshairs,
  faDisplay,
  faFilm,
  faDownload,
  faWifi,
  faCube,
  faChevronRight,
  faStar as faStarFilled,
  faPalette,
  faChartLine,
  faMicrochip,
  faHardDrive,
  faVolumeHigh,
  faComputerMouse,
  faShieldHalved,
  faSliders,
  faBars,
  faTableCells,
} from '@fortawesome/free-solid-svg-icons';
import { faClock, faFileLines, faStar } from '@fortawesome/free-regular-svg-icons';
import { faMicrosoft } from '@fortawesome/free-brands-svg-icons';
import { Icon } from '@/features/home/components/Icon';
import { FeatureIcon } from '@/features/home/components/FeatureIcon';
import type { ToolEntry, ToolIcon } from './types';

/** 显式导入准确使用的图标，不引入整包图标，也不以图片或CSS绘制功能图标。 */
const ICONS = {
  crosshair: faCrosshairs,
  display: faDisplay,
  film: faFilm,
  download: faDownload,
  wifi: faWifi,
  clock: faClock,
  runtime: faMicrosoft,
  log: faFileLines,
  box: faCube,
  palette: faPalette,
  chart: faChartLine,
  gpu: faMicrochip,
  drive: faHardDrive,
  audio: faVolumeHigh,
  mouse: faComputerMouse,
  shield: faShieldHalved,
  sliders: faSliders,
  menu: faBars,
  apps: faTableCells,
} satisfies Record<ToolIcon, typeof faDisplay>;

export function ToolSymbol({ tool }: { tool: ToolEntry }) {
  return (
    <FeatureIcon
      icon={ICONS[tool.icon]}
      tone={tool.tone}
      className={`tool-symbol tone-${tool.tone}`}
    />
  );
}

/** 主操作和收藏是两个独立按钮，避免嵌套按钮以及整卡点击抢占收藏事件。 */
export function ToolCard({
  tool,
  favorite,
  compact = false,
  managing,
  onOpen,
  onFavorite,
}: {
  tool: ToolEntry;
  favorite: boolean;
  compact?: boolean;
  managing: boolean;
  onOpen: (tool: ToolEntry) => void;
  onFavorite: (id: string) => void;
}) {
  return (
    <article className={`tool-card ${compact ? 'tool-compact' : 'glass'}`}>
      <button
        type="button"
        className="tool-open"
        aria-label={`查看${tool.name}详情`}
        title={tool.description}
        onClick={() => onOpen(tool)}
      >
        <ToolSymbol tool={tool} />
        <span className="tool-copy">
          <span className="tool-name">
            {tool.name}
            {tool.origin === 'third-party' && <span className="tool-third-party">第三方</span>}
          </span>
          <span className="tool-description">{tool.description}</span>
        </span>
        <span className="tool-arrow" aria-hidden="true">
          {compact && <span>{tool.origin === 'third-party' ? '浏览' : '查看详情'}</span>}
          <Icon icon={faChevronRight} />
        </span>
      </button>
      {(!compact || managing) && (
        <button
          type="button"
          className={`tool-favorite ${favorite ? 'is-favorite' : ''}`}
          aria-label={`${favorite ? '取消收藏' : '收藏'}${tool.name}`}
          aria-pressed={favorite}
          onClick={() => onFavorite(tool.id)}
        >
          <Icon icon={favorite ? faStarFilled : faStar} />
        </button>
      )}
    </article>
  );
}
