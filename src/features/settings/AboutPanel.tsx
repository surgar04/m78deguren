import { bytes } from './format';
import { useState } from 'react';
import { z } from 'zod';
import { updateStatusSchema } from '@/lib/settings-contracts';
import { useSettingsSnapshot, useSettingsQuery, useSettingsAction } from './repository';
import { Failure, Review } from './controls';
import { useText } from './i18n';

export function AboutPanel() {
  const { t } = useText();
  const snapshot = useSettingsSnapshot();
  const status = useSettingsQuery({ operation: 'update-status' }, updateStatusSchema, 1_000);
  const action = useSettingsAction(updateStatusSchema);
  const apply = useSettingsAction(z.null());
  const [review, setReview] = useState(false);
  const data = status.data;
  return (
    <>
      <h2>{t('关于臻境')}</h2>
      <div className="preferences-about">
        <img src="/assets/home/brand.svg" alt="臻境" width="80" height="110" />
        <div>
          <h3>臻境 · Zhenjing</h3>
          <p>
            {t('版本')} {snapshot.data?.version ?? '…'}
          </p>
          <p>
            {t('作者')} {snapshot.data?.author ?? '…'}
          </p>
          <a href="https://github.com/surgar04/m78deguren" target="_blank" rel="noreferrer">
            surgar04 / m78deguren
          </a>
        </div>
      </div>
      <Failure error={snapshot.error ?? status.error ?? action.error ?? apply.error} />
      <div className="settings-actions">
        <button type="button" onClick={() => apply.mutate({ operation: 'update-open-release' })}>
          查看发布页面
        </button>
        <button
          type="button"
          disabled={action.isPending || data?.phase === 'downloading'}
          onClick={() => action.mutate({ operation: 'update-check' })}
        >
          {action.isPending && action.variables?.operation === 'update-check'
            ? '正在检查…'
            : t('检查更新')}
        </button>
        {data?.phase === 'available' && (
          <button
            type="button"
            disabled={action.isPending}
            onClick={() => action.mutate({ operation: 'update-download' })}
          >
            {t('下载更新')}
          </button>
        )}
        {data?.phase === 'ready' && (
          <button type="button" onClick={() => setReview(true)}>
            {t('重启并更新')}
          </button>
        )}
      </div>
      {data && (
        <div className="settings-update-status" role="status">
          <strong>
            {data.latestVersion ? `v${data.latestVersion} · ` : ''}
            {data.message}
          </strong>
          {data.phase === 'downloading' && (
            <>
              <progress value={data.downloaded} max={data.total ?? undefined} />
              <small>
                {bytes(data.downloaded)} / {data.total ? bytes(data.total) : '—'}
              </small>
            </>
          )}
          {data.checkedAt && <small>{new Date(data.checkedAt).toLocaleString()}</small>}
          {data.sha256 && <code className="settings-path">SHA256 {data.sha256}</code>}
        </div>
      )}
      {review && data?.token && (
        <Review
          title={t('重启并更新')}
          busy={apply.isPending}
          onCancel={() => setReview(false)}
          onConfirm={() => {
            if (data.token)
              apply.mutate({ operation: 'update-apply', token: data.token, consent: true });
          }}
        >
          <p>
            将安装 v{data.latestVersion}。发布清单已通过 Ed25519 验证，MSI 文件已校验哈希与长度。
            安装失败由 Windows Installer 回滚事务，启动异常会保留维护记录以便修复。
            请先结束工具会话与下载。
          </p>
        </Review>
      )}
      <h3>{t('更新日志')}</h3>
      {data?.changelog && <pre className="settings-changelog">{data.changelog}</pre>}
      <pre className="settings-changelog">{snapshot.data?.changelog}</pre>
      <p className="settings-note">
        更新源固定为本项目 GitHub Releases；没有已签名发布时如实显示未发布，不会使用 NexBox
        安装包。发布签名私钥不随应用分发。
      </p>
    </>
  );
}
