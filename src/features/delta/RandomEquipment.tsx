import { useEffect, useRef, useState } from 'react';
import { DeltaImage } from './components';
import { drawEquipment, type EquipmentOptions } from './random';
export default function RandomEquipment() {
  const [options, setOptions] = useState<EquipmentOptions>({
    classified: false,
    noPistol: true,
    specialTask: false,
    skipAnimation: false,
  });
  const [result, setResult] = useState<ReturnType<typeof drawEquipment> | null>(null);
  const [rolling, setRolling] = useState(false);
  const [error, setError] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const draw = () => {
    setError('');
    try {
      const value = drawEquipment(options);
      if (options.skipAnimation || matchMedia('(prefers-reduced-motion: reduce)').matches) {
        setResult(value);
        return;
      }
      setRolling(true);
      timer.current = setTimeout(() => {
        setResult(value);
        setRolling(false);
        timer.current = null;
      }, 650);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '随机装备失败');
    }
  };
  return (
    <>
      <div className="delta-section-heading">
        <h2>随机装备</h2>
        <button className="primary" disabled={rolling} onClick={draw}>
          {rolling ? '装备抽取中…' : '随机一套装备'}
        </button>
      </div>
      <p className="delta-caption">
        基础目录参考
        NexBox；仅提供娱乐装备建议，不读取或修改游戏装备。常规难度排除六级防具和五级及以上弹药。
      </p>
      <div className="delta-filters">
        {(
          [
            ['classified', '仅绝密 / 永夜'],
            ['noPistol', '不带手枪'],
            ['specialTask', '特殊任务'],
            ['skipAnimation', '跳过动画'],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            <input
              type="checkbox"
              checked={options[key]}
              onChange={(event) =>
                setOptions((current) => ({ ...current, [key]: event.target.checked }))
              }
            />
            {label}
          </label>
        ))}
      </div>
      {error && <p role="alert">{error}</p>}
      <div className={`delta-equipment ${rolling ? 'rolling' : ''}`}>
        {result ? (
          <>
            {[
              [result.map.map, result.map.difficulty, result.map.pic],
              [result.operator.name, '干员', result.operator.pic],
              [
                result.weapon.objectName,
                `${result.weapon.caliber} · ${result.weapon.selectedAmmoGrade} 级弹药`,
                result.weapon.pic,
              ],
              [result.helmet.objectName, `${result.helmet.protectLevel} 级头盔`, result.helmet.pic],
              [result.armor.objectName, `${result.armor.protectLevel} 级护甲`, result.armor.pic],
            ].map(([name, subtitle, image]) => (
              <article key={name}>
                <DeltaImage src={image} alt={name ?? '装备'} />
                <strong>{name}</strong>
                <span>{subtitle}</span>
              </article>
            ))}
            {result.task && <p className="delta-task">特殊任务：{result.task}</p>}
          </>
        ) : (
          <div className="delta-empty">设置选项后，生成你的下一局装备。</div>
        )}
      </div>
    </>
  );
}
