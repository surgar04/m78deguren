import { CrosshairPanel } from './CrosshairPanel';
import { ScreenPanel } from './ScreenTools';
import { RecordingsPanel } from './RecordingsPanel';
import { DownloadsPanel } from './DownloadsPanel';
import { SpeedPanel, TimePanel } from './NetworkPanels';
import { RuntimePanel, ExternalPanel } from './MaintenancePanels';
import { CrashPanel } from './CrashPanel';
import './native-tools.css';
import { AutoClickerPanel } from './AutoClickerPanel';
import { AppsPanel } from './AppsPanel';
import { GpuRenamePanel } from './GpuRenamePanel';
import { VirtualizationPanel } from './VirtualizationPanel';
import { DiskHealthPanel } from './DiskHealthPanel';
import { ContextMenuPanel } from './ContextMenuPanel';
import { VacRepairPanel } from './VacRepairPanel';
import { NvidiaPanel } from './NvidiaPanel';
import { FeaturesPanel } from './FeaturesPanel';
import { ResolutionPanel } from './ResolutionPanel';
import { DriverHistoryPanel } from './DriverHistoryPanel';
import { AudioPanel } from './AudioPanel';
import { OverlayPanel } from './OverlayPanel';
import { FilterPanel } from './FilterPanel';

/** 仅按目录白名单分发界面，未识别ID显式失败，不退回说明性假工具。 */
export default function NativeToolPanel({ id }: { id: string }) {
  switch (id) {
    case 'display-filter':
      return <FilterPanel />;
    case 'overlay-panel':
      return <OverlayPanel />;
    case 'autoclicker':
      return <AutoClickerPanel />;
    case 'app-manager':
      return <AppsPanel />;
    case 'gpu-rename':
      return <GpuRenamePanel />;
    case 'vtx-virtualization':
      return <VirtualizationPanel />;
    case 'disk-health':
      return <DiskHealthPanel />;
    case 'context-menu':
      return <ContextMenuPanel />;
    case 'vac-repair':
      return <VacRepairPanel />;
    case 'nvidia-driver':
      return <NvidiaPanel />;
    case 'dlss-preset':
      return <NvidiaPanel dlss />;
    case 'hidden-features':
      return <FeaturesPanel />;
    case 'resolution-converter':
      return <ResolutionPanel />;
    case 'nvidia-driver-download':
      return <DriverHistoryPanel />;
    case 'audio-eq':
      return <AudioPanel />;
    case 'crosshair':
      return <CrosshairPanel />;
    case 'screen-test':
      return <ScreenPanel />;
    case 'recordings':
      return <RecordingsPanel />;
    case 'downloads':
      return <DownloadsPanel />;
    case 'speed-test':
      return <SpeedPanel />;
    case 'time-sync':
      return <TimePanel />;
    case 'runtimes':
      return <RuntimePanel />;
    case 'crash-logs':
      return <CrashPanel />;
    case 'external-tools':
      return <ExternalPanel />;
    default:
      return <p role="alert">未知工具，请重新加载目录。</p>;
  }
}
