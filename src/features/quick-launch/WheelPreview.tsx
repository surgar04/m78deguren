import { faCircleNotch } from '@fortawesome/free-solid-svg-icons';
import { Icon } from '@/features/home/components/Icon';
import type { LaunchTarget, QuickSnapshot } from '@/lib/launcher-contracts';
import { targetKey } from '@/lib/launcher-contracts';
import { LaunchTargetIcon } from './LaunchTargetIcon';
import { WHEEL_DIRECTIONS as DIRECTIONS } from './wheel-layout';

const CENTER = 200,
  OUTER = 188,
  INNER = 76,
  ICON_RADIUS = (OUTER + INNER) / 2;
const point = (radius: number, degrees: number) => {
  const angle = (degrees * Math.PI) / 180;
  return { x: CENTER + radius * Math.cos(angle), y: CENTER + radius * Math.sin(angle) };
};
/** 与原生轮盘一致：正上方为第一项，顺时针八等分，中心留作取消区域。 */
function sector(index: number) {
  const start = -112.5 + index * 45,
    end = start + 45;
  const a = point(OUTER, start),
    b = point(OUTER, end),
    c = point(INNER, end),
    d = point(INNER, start);
  return `M${a.x},${a.y} A${OUTER},${OUTER} 0 0 1 ${b.x},${b.y} L${c.x},${c.y} A${INNER},${INNER} 0 0 0 ${d.x},${d.y} Z`;
}
export function WheelPreview({
  slots,
  options,
  selected,
  onSelect,
  triggerKey,
}: {
  slots: (LaunchTarget | null)[];
  options: QuickSnapshot['options'];
  selected: number;
  onSelect: (index: number) => void;
  triggerKey: string;
}) {
  return (
    <div className="wheel-preview" role="group" aria-label="轮盘方向配置">
      <svg viewBox="0 0 400 400" className="wheel-preview-svg">
        {slots.map((target, index) => {
          const option = options.find((item) => targetKey(item.target) === targetKey(target));
          const center = point(ICON_RADIUS, -90 + index * 45);
          return (
            <g
              key={index}
              className={`wheel-sector ${selected === index ? 'selected' : ''}`}
              role="button"
              tabIndex={0}
              aria-label={`${DIRECTIONS[index]}方向`}
              aria-pressed={selected === index}
              onClick={() => onSelect(index)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelect(index);
                }
              }}
            >
              <title>{option?.label ?? `${DIRECTIONS[index]}方向 · 未配置`}</title>
              <path className="wheel-sector-shape" d={sector(index)} />
              <foreignObject
                x={center.x - 18}
                y={center.y - 18}
                width={36}
                height={36}
                pointerEvents="none"
              >
                <div className="wheel-sector-icon">
                  <LaunchTargetIcon option={option} />
                </div>
              </foreignObject>
              <text
                x={center.x}
                y={center.y + 33}
                textAnchor="middle"
                className="wheel-sector-label"
                pointerEvents="none"
              >
                {(option?.label ?? '未配置').length > 7
                  ? `${option?.label.slice(0, 6)}…`
                  : (option?.label ?? '未配置')}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="wheel-preview-center">
        <Icon icon={faCircleNotch} />
        <strong>快捷轮盘</strong>
        <small>长按 {triggerKey}</small>
      </div>
    </div>
  );
}
