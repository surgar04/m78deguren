import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';

/** 图标显式导入，避免整个 Font Awesome 图标集进入包体。 */
export function Icon({ icon, className = '' }: { icon: IconDefinition; className?: string }) {
  return <FontAwesomeIcon icon={icon} className={`ui-icon ${className}`} aria-hidden="true" />;
}
