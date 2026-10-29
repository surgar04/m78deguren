import {
  faBolt,
  faBookOpen,
  faComputerMouse,
  faCrosshairs,
  faGamepad,
  faGaugeHigh,
  faGear,
  faHouse,
  faDesktop,
  faPlay,
  faPlus,
  faSliders,
  faToolbox,
  faBackwardStep,
  faForwardStep,
  faWandMagicSparkles,
} from '@fortawesome/free-solid-svg-icons';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { Icon } from '@/features/home/components/Icon';
import type { QuickSnapshot } from '@/lib/launcher-contracts';
import { useLaunchIcon } from './repository';

// 导航和配置编辑器共享语义图标；游戏优先显示本机 EXE 的真实资源。
const PAGE_ICONS: Record<string, IconDefinition> = {
  home: faHouse,
  library: faBookOpen,
  'other-games': faGamepad,
  hardware: faDesktop,
  tools: faToolbox,
  optimization: faBolt,
  settings: faGear,
};
const TOOL_ICONS: Record<string, IconDefinition> = {
  crosshair: faCrosshairs,
  overlay: faGaugeHigh,
  filter: faWandMagicSparkles,
  clicker: faComputerMouse,
  'media-previous': faBackwardStep,
  'media-next': faForwardStep,
  'media-play-pause': faPlay,
};
export function LaunchTargetIcon({
  option,
}: {
  option: QuickSnapshot['options'][number] | undefined;
}) {
  const image = useLaunchIcon(option?.iconId ?? null);
  if (image.data) return <img className="quick-target-icon" src={image.data} alt="" />;
  const target = option?.target;
  const icon = !target
    ? faPlus
    : target.kind === 'shortcut' || target.kind === 'steam'
      ? faGamepad
      : target.kind === 'page'
        ? (PAGE_ICONS[target.id] ?? faSliders)
        : target.kind === 'tool'
          ? (TOOL_ICONS[target.id] ?? faSliders)
          : faToolbox;
  return <Icon icon={icon} />;
}
