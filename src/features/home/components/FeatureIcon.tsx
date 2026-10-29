import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { Icon } from './Icon';

/** 功能卡共用的图标容器；统一光学尺寸、留白和低饱和配色，图形仍使用显式导入的 Font Awesome。 */
export function FeatureIcon({
  icon,
  tone,
  className = '',
}: {
  icon: IconDefinition;
  tone: 'mint' | 'blue' | 'violet' | 'orange' | 'rose';
  className?: string;
}) {
  return (
    <span className={`feature-icon feature-icon-${tone} ${className}`} aria-hidden="true">
      <Icon icon={icon} />
    </span>
  );
}
