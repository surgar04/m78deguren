import {
  maps,
  isClassifiedDifficulty,
  isNormalDifficulty,
  NORMAL_LOADOUT_LIMITS,
} from './data/maps';
import { weapons, isPistol } from './data/weapons';
import { operators } from './data/operators';
import { helmets } from './data/helmets';
import { armors } from './data/armors';
import { tasks } from './data/tasks';

export type EquipmentOptions = {
  classified: boolean;
  noPistol: boolean;
  specialTask: boolean;
  skipAnimation: boolean;
};
/** 有界、均匀抽样；普通难度的装备池和显示结果使用相同规则，不会抽到被排除的六级套/高等级弹。 */
function pick<T>(items: readonly T[]): T {
  if (!items.length) throw new Error('当前筛选没有可用装备，请调整选项');
  const maximum = 0x100000000 - (0x100000000 % items.length);
  let value: number;
  do {
    const random = new Uint32Array(1);
    crypto.getRandomValues(random);
    value = random[0] ?? 0;
  } while (value >= maximum);
  const item = items[value % items.length];
  if (item === undefined) throw new Error('随机装备目录异常');
  return item;
}
export function drawEquipment(options: EquipmentOptions) {
  const map = pick(
    maps.filter((row) => !options.classified || isClassifiedDifficulty(row.difficulty)),
  );
  const normal = isNormalDifficulty(map.difficulty);
  return {
    map,
    operator: pick(operators),
    weapon: pick(
      weapons.filter(
        (row) =>
          (!options.noPistol || !isPistol(row)) &&
          (!normal || row.selectedAmmoGrade <= NORMAL_LOADOUT_LIMITS.maxAmmoGrade),
      ),
    ),
    helmet: pick(
      helmets.filter((row) => !normal || row.protectLevel <= NORMAL_LOADOUT_LIMITS.maxProtectLevel),
    ),
    armor: pick(
      armors.filter((row) => !normal || row.protectLevel <= NORMAL_LOADOUT_LIMITS.maxProtectLevel),
    ),
    task: options.specialTask ? pick(tasks) : null,
  };
}
