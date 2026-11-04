import { DeltaFeedback } from './components';
import { useDeltaAction } from './repository';
import { isDesktop } from '@/lib/desktop';
const platforms = [
  ['maqt', '码枪堂', '武器配置分享与筛选'],
  ['anxu', 'ANXU', '三角洲社区改枪码'],
  ['streamer-codes', '主播改枪码', '主播常用武器方案'],
  ['xiaotao', '小涛查', '武器方案与资料'],
] as const;
export default function OtherPlatforms() {
  const action = useDeltaAction();
  return (
    <>
      <h2>其他改枪码平台</h2>
      <p className="delta-caption">
        第三方平台在独立窗口打开。平台资料与登录由各站点自行提供，臻境不代为提交账号信息。
      </p>
      <DeltaFeedback error={action.error} />
      <div className="delta-platform-grid">
        {platforms.map(([key, title, description]) => (
          <button
            key={key}
            disabled={!isDesktop() || action.isPending}
            onClick={() => action.mutate({ operation: 'link', key })}
          >
            <strong>{title} ↗</strong>
            <span>{description}</span>
          </button>
        ))}
      </div>
    </>
  );
}
