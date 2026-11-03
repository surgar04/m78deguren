import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { z } from 'zod';
import {
  musicBackgroundSchema,
  musicStyleSchema,
  musicThemeSchema,
  onlineMusicProviderSchema,
  musicProviderSchema,
} from '@/lib/music-contracts';

const schema = z.object({
  renderPolicy: z.enum(['auto', 'original', 'efficient']).default('auto'),
  provider: musicProviderSchema.default('netease'),
  matchProvider: onlineMusicProviderSchema.default('netease'),
  style: musicStyleSchema.default('classic'),
  background: musicBackgroundSchema.default('latent'),
  daylight: z.boolean().default(false),
  themeSource: z.enum(['default', 'cover', 'custom']).default('default'),
  customTheme: musicThemeSchema.nullable().default(null),
  volume: z.number().min(0).max(1).default(0.7),
  repeat: z.enum(['queue', 'one', 'off']).default('queue'),
  shuffle: z.boolean().default(false),
  quality: z.enum(['standard', 'high', 'lossless', 'hires']).default('high'),
  favorites: z.array(z.string().max(200)).max(20000).default([]),
});
type Preferences = z.infer<typeof schema>;
const initial = schema.parse({});
/** 仅迁移已撤下的平台选择与收藏，不因一个旧字段使音量、主题和其余平台偏好整体丢失。 */
export function migrateMusicPreferences(saved: unknown) {
  const record = z.record(z.string(), z.unknown()).safeParse(saved);
  if (!record.success) return initial;
  const value = record.data;
  const result = schema.safeParse({
    ...value,
    provider: value.provider === 'spotify' ? 'local' : value.provider,
    favorites: Array.isArray(value.favorites)
      ? value.favorites.filter(
          (key: unknown) => typeof key === 'string' && !key.startsWith('spotify:'),
        )
      : value.favorites,
  });
  return result.success ? result.data : initial;
}
export const useMusicPreferences = create<
  Preferences & { patch: (patch: Partial<Preferences>) => void }
>()(
  persist(
    (set) => ({
      ...initial,
      patch: (patch) => set((state) => schema.parse({ ...state, ...patch })),
    }),
    {
      name: 'zhenjing.music.preferences',
      version: 1,
      partialize: (state) => schema.parse(state),
      merge: (saved, current) => {
        return { ...current, ...migrateMusicPreferences(saved) };
      },
    },
  ),
);
export const MUSIC_STYLES = [
  ['classic', '流光'],
  ['cadenza', '心象'],
  ['partita', '云阶'],
  ['fume', '浮名'],
  ['cappella', '群唱'],
  ['tilt', '倾诉'],
  ['claddagh', '回环'],
  ['monet', '莫奈'],
  ['diorama', '镜台'],
  ['pendolo', '时计'],
  ['sonnet', '商籁'],
  ['tempera', '凝彩'],
  ['lumiere', '绘光'],
  ['nebbia', '雾笺'],
  ['hanabi', '花火'],
  ['machi', '町景'],
  ['still', '静止'],
] as const;
export const MUSIC_PROVIDERS = [
  ['netease', '网易云音乐'],
  ['qq', 'QQ 音乐'],
  ['ytm', 'YouTube Music'],
  ['local', '本地曲库'],
] as const;
export const ONLINE_MUSIC_PROVIDERS = MUSIC_PROVIDERS.filter((row) => row[0] !== 'local');
