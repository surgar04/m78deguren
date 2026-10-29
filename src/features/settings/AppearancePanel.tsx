import { bytes } from './format';
import { z } from 'zod';
import { assetSchema } from '@/lib/settings-contracts';
import { ACCENTS, usePreferences } from '@/stores/preferences';
import { useHomePreferences } from '@/features/home/store';
import { useSettingsAction, useSettingsSnapshot } from './repository';
import { SettingRow, SettingSelect, SettingToggle, Failure } from './controls';
import { useSettingsUi } from './ui-store';
import { useText } from './i18n';
import { Background } from './Background';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faImage, faVideo, faRotateLeft, faSpinner } from '@fortawesome/free-solid-svg-icons';

/** 素材由 Rust 校验并复制到本地目录；偏好只引用摘要 ID，不保存本机文件路径。 */
export function AppearancePanel() {
  const ui = useSettingsUi();
  const { t } = useText();
  const base = usePreferences();
  const home = useHomePreferences();
  const snapshot = useSettingsSnapshot();
  const importer = useSettingsAction(assetSchema.nullable());
  const remover = useSettingsAction(z.null());
  const assets = snapshot.data?.assets ?? [];
  const importAsset = (kind: 'image' | 'video' | 'font') =>
    importer.mutate(
      { operation: 'asset-import', kind },
      {
        onSuccess: (asset) => {
          if (!asset) return;
          if (kind === 'font') ui.patch({ font: `font:${asset.id}` });
          // 导入后直接预览该素材，避免现有轮播把新上传的背景立即切走。
          else ui.patch({ backgroundMode: kind, backgroundAsset: asset.id, carousel: false });
        },
      },
    );
  return (
    <>
      <h2>{t('外观与体验')}</h2>
      <section
        className="settings-wallpaper-preview"
        aria-label={t('软件背景')}
        aria-busy={importer.isPending}
      >
        <div className="settings-wallpaper-heading">
          <div>
            <h3>{t('软件背景')}</h3>
            <p>{t('图片或短视频，打造你的专属背景。')}</p>
          </div>
          <span className="settings-wallpaper-badge">
            {t(ui.backgroundMode === 'video' ? '静音循环' : '壁纸')}
          </span>
        </div>
        <div className="settings-wallpaper-frame">
          <Background
            preview
            accent={
              ui.customAccent ?? ACCENTS.find((row) => row.id === base.accent)?.color ?? '#7de1cf'
            }
          />
        </div>
        <div className="settings-actions">
          <button type="button" disabled={importer.isPending} onClick={() => importAsset('image')}>
            <FontAwesomeIcon icon={faImage} />
            {t('导入图片')}
          </button>
          <button type="button" disabled={importer.isPending} onClick={() => importAsset('video')}>
            <FontAwesomeIcon icon={faVideo} />
            {t('导入视频')}
          </button>
          <button
            type="button"
            disabled={importer.isPending}
            onClick={() =>
              ui.patch({
                backgroundMode: 'preset',
                preset: 'island',
                backgroundAsset: null,
                carousel: false,
              })
            }
          >
            <FontAwesomeIcon icon={faRotateLeft} />
            {t('恢复默认背景')}
          </button>
        </div>
        <p className="settings-wallpaper-hint">{t('图片：PNG / JPG / WebP，最大 20 MiB。')}</p>
        <p className="settings-wallpaper-hint">
          {t('视频：MP4 / WebM，最长 15 秒，最大 512 MiB；静音循环播放。')}
        </p>
        <p className="settings-wallpaper-status" role="status" aria-live="polite">
          {importer.isPending ? (
            <>
              <FontAwesomeIcon icon={faSpinner} spin /> {t('正在选择或检查素材…')}
            </>
          ) : (
            assets.find((asset) => asset.id === ui.backgroundAsset)?.name
          )}
        </p>
      </section>
      <Failure error={importer.error ?? remover.error} />
      <SettingSelect
        label={t('主题')}
        value={ui.theme}
        options={(['light', 'dark', 'system'] as const).map((value, index) => ({
          value,
          label: [t('浅色'), t('深色'), t('跟随系统')][index] ?? value,
        }))}
        onChange={(theme) => ui.patch({ theme })}
      />
      <SettingRow label={t('强调色')}>
        <div className="settings-swatches">
          {ACCENTS.map((accent) => (
            <button
              type="button"
              key={accent.id}
              aria-label={accent.label}
              aria-pressed={!ui.customAccent && base.accent === accent.id}
              style={{ background: accent.surface }}
              onClick={() => {
                base.setAccent(accent.id);
                ui.patch({ customAccent: null });
              }}
            >
              {!ui.customAccent && base.accent === accent.id ? '✓' : ''}
            </button>
          ))}
          <input
            aria-label={t('自定义')}
            type="color"
            value={ui.customAccent ?? '#7de1cf'}
            onChange={(event) => ui.patch({ customAccent: event.target.value })}
          />
        </div>
      </SettingRow>
      <SettingSelect
        label={t('字体')}
        value={ui.font}
        options={[
          { value: 'MiSans', label: 'MiSans' },
          { value: 'system', label: t('跟随系统') },
          { value: 'serif', label: 'Serif' },
          { value: 'mono', label: 'Monospace' },
          ...assets
            .filter((asset) => asset.kind === 'font')
            .map((asset) => ({ value: `font:${asset.id}`, label: asset.name })),
        ]}
        onChange={(font) => ui.patch({ font })}
      />
      <div className="settings-actions">
        <button type="button" disabled={importer.isPending} onClick={() => importAsset('font')}>
          {t('导入字体')} · TTF / OTF
        </button>
      </div>
      <SettingSelect
        label={t('壁纸')}
        value={ui.backgroundMode}
        options={[
          { value: 'legacy', label: t('默认') },
          { value: 'preset', label: t('预设壁纸') },
          { value: 'image', label: t('图片') },
          { value: 'video', label: t('视频') },
          { value: 'mr', label: 'MR' },
          { value: 'none', label: t('无背景') },
        ]}
        onChange={(backgroundMode) => ui.patch({ backgroundMode })}
      />
      {ui.backgroundMode === 'preset' && (
        <SettingSelect
          label={t('预设壁纸')}
          value={ui.preset}
          options={[
            { value: 'island', label: t('默认') },
            { value: 'sky', label: t('晴空') },
            { value: 'mint', label: t('薄荷') },
            { value: 'night', label: t('星夜') },
          ]}
          onChange={(preset) => ui.patch({ preset })}
        />
      )}
      {(ui.backgroundMode === 'image' || ui.backgroundMode === 'video') && (
        <SettingSelect
          label={t('壁纸')}
          value={ui.backgroundAsset ?? ''}
          options={[
            { value: '', label: '—' },
            ...assets
              .filter((asset) => asset.kind === ui.backgroundMode)
              .map((asset) => ({ value: asset.id, label: asset.name })),
          ]}
          onChange={(backgroundAsset) => ui.patch({ backgroundAsset: backgroundAsset || null })}
        />
      )}
      {ui.backgroundMode === 'mr' && (
        <>
          <SettingSelect
            label="MR"
            value={ui.mrColorMode}
            options={[
              { value: 'theme', label: t('强调色') },
              { value: 'custom', label: t('自定义') },
            ]}
            onChange={(mrColorMode) => ui.patch({ mrColorMode })}
          />
          {ui.mrColorMode === 'custom' && (
            <SettingRow label={t('强调色')}>
              <input
                type="color"
                aria-label="MR"
                value={ui.mrColor}
                onChange={(event) => ui.patch({ mrColor: event.target.value })}
              />
            </SettingRow>
          )}
        </>
      )}
      {['legacy', 'preset', 'image'].includes(ui.backgroundMode) && (
        <SettingToggle
          label={t('轮播')}
          checked={ui.carousel}
          onChange={(carousel) => ui.patch({ carousel })}
        />
      )}
      {ui.carousel && ['legacy', 'preset', 'image'].includes(ui.backgroundMode) && (
        <SettingRow label={t('轮播间隔（秒）')}>
          <input
            type="number"
            min={5}
            max={3600}
            aria-label={t('轮播间隔（秒）')}
            value={ui.carouselSeconds}
            onChange={(event) => ui.patch({ carouselSeconds: event.target.valueAsNumber })}
          />
        </SettingRow>
      )}
      <SettingRow label={t('背景模糊')}>
        <input
          aria-label={t('背景模糊')}
          type="range"
          min={0}
          max={24}
          value={ui.backgroundBlur}
          onChange={(event) => ui.patch({ backgroundBlur: event.target.valueAsNumber })}
        />
        <output>{ui.backgroundBlur}px</output>
      </SettingRow>
      <SettingToggle
        label={t('柔化背景')}
        checked={home.wallpaperDim}
        onChange={home.setWallpaperDim}
      />
      <SettingToggle
        label={t('玻璃效果')}
        checked={ui.glassEnabled}
        onChange={(glassEnabled) => ui.patch({ glassEnabled })}
      />
      <SettingSelect
        label={t('玻璃效果')}
        value={ui.glassMode}
        options={[
          { value: 'frosted', label: t('毛玻璃') },
          { value: 'liquid', label: t('液态玻璃') },
          { value: 'transparent', label: t('透明') },
        ]}
        onChange={(glassMode) => ui.patch({ glassMode })}
      />
      <SettingRow label={t('模糊程度')}>
        <input
          aria-label={t('模糊程度')}
          type="range"
          min={0}
          max={40}
          value={ui.glassBlur}
          onChange={(event) => ui.patch({ glassBlur: event.target.valueAsNumber })}
        />
        <output>{ui.glassBlur}px</output>
      </SettingRow>
      <SettingToggle
        label={t('弹性动画')}
        checked={ui.elasticAnimation}
        onChange={(elasticAnimation) => ui.patch({ elasticAnimation })}
      />
      <SettingToggle
        label={t('紧凑布局')}
        checked={base.compact}
        onChange={() => base.toggleCompact()}
      />
      <SettingSelect
        label={t('减少动态效果')}
        value={base.motion}
        options={[
          { value: 'system', label: t('跟随系统') },
          { value: 'reduce', label: t('始终减少') },
        ]}
        onChange={base.setMotion}
      />
      {assets.length > 0 && (
        <details className="settings-assets">
          <summary>
            {t('删除')} · {assets.length}
          </summary>
          {assets.map((asset) => (
            <div key={asset.id}>
              <span>
                {asset.name} · {bytes(asset.bytes)}
              </span>
              <button
                type="button"
                disabled={remover.isPending}
                onClick={() =>
                  remover.mutate(
                    { operation: 'asset-remove', id: asset.id },
                    {
                      onSuccess: () => {
                        if (ui.backgroundAsset === asset.id)
                          ui.patch({ backgroundAsset: null, backgroundMode: 'preset' });
                        if (ui.font === `font:${asset.id}`) ui.patch({ font: 'MiSans' });
                        if (ui.splashLogo === asset.id) ui.patch({ splashLogo: null });
                      },
                    },
                  )
                }
              >
                {t('删除')}
              </button>
            </div>
          ))}
        </details>
      )}
    </>
  );
}
