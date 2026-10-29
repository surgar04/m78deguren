import {
  faGaugeHigh,
  faGamepad,
  faShieldHalved,
  faNetworkWired,
  faSliders,
  faChevronRight,
  faMicrochip,
  faWandMagicSparkles,
  faHardDrive,
  faTableCellsLarge,
  faVolumeHigh,
} from '@fortawesome/free-solid-svg-icons';
import {
  faFileLines,
  faWindowMaximize,
  faWindowRestore,
} from '@fortawesome/free-regular-svg-icons';
import { Icon } from '@/features/home/components/Icon';
import { FeatureIcon } from '@/features/home/components/FeatureIcon';
import { currentLabel } from './model';
import type {
  OptimizationCategory,
  OptimizationIcon,
  OptimizationSetting,
  OptimizationTone,
  OptimizationRow,
} from './types';

/** 图标映射只导入实际使用项；不复制整包图标，也不用栅格截图代替UI。 */
const ICONS = {
  display: faWindowMaximize,
  gamepad: faGamepad,
  bolt: faGaugeHigh,
  lock: faShieldHalved,
  wifi: faNetworkWired,
  gear: faSliders,
  file: faFileLines,
  window: faWindowRestore,
  gpu: faMicrochip,
  ai: faWandMagicSparkles,
  disk: faHardDrive,
  apps: faTableCellsLarge,
  audio: faVolumeHigh,
} satisfies Record<OptimizationIcon, typeof faGaugeHigh>;

export function OptimizationSymbol({
  icon,
  tone,
}: {
  icon: OptimizationIcon;
  tone: OptimizationTone;
}) {
  return (
    <FeatureIcon
      icon={ICONS[icon]}
      tone={tone}
      className={`optimization-symbol optimization-tone-${tone}`}
    />
  );
}

export function OptimizationCategoryCard({
  category,
  onOpen,
}: {
  category: OptimizationCategory;
  onOpen: (id: OptimizationCategory['id']) => void;
}) {
  return (
    <article className="optimization-category glass">
      <button
        type="button"
        aria-label={`查看${category.name}优化设置`}
        title={category.description}
        onClick={() => onOpen(category.id)}
      >
        <OptimizationSymbol icon={category.icon} tone={category.tone} />
        <span className="optimization-category-copy">
          <span className="optimization-category-name">
            {category.name}
            <small className="optimization-count">{category.count}</small>
          </span>
          <span className="optimization-category-description">{category.description}</span>
        </span>
        <span className="optimization-arrow" aria-hidden="true">
          <Icon icon={faChevronRight} />
        </span>
      </button>
    </article>
  );
}

export function OptimizationCommonCard({
  setting,
  onOpen,
  row,
}: {
  setting: OptimizationSetting;
  onOpen: (id: string) => void;
  row?: OptimizationRow;
}) {
  return (
    <article className="optimization-common-item">
      <OptimizationSymbol icon={setting.icon} tone={setting.tone} />
      <div className="optimization-common-info">
        <h3>{setting.name}</h3>
        <p>{setting.featuredDescription ?? setting.description}</p>
        <div className="optimization-setting-footer">
          <span>
            当前：<strong>{currentLabel(setting, row)}</strong>
          </span>
          <button
            type="button"
            aria-label={`查看${setting.name}设置`}
            onClick={() => onOpen(setting.id)}
          >
            查看设置
            <Icon icon={faChevronRight} />
          </button>
        </div>
      </div>
    </article>
  );
}
