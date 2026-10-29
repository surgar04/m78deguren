import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { z } from 'zod';
const steamId = /^steam:[1-9]\d{0,9}$/u;
const stored = z
  .object({
    favorites: z.array(z.string()).max(2000).catch([]),
    wallpaperDim: z.boolean().catch(false),
  })
  .catch({ favorites: [], wallpaperDim: false });
function normalize(value: unknown) {
  const parsed = stored.parse(value);
  return {
    favorites: [...new Set(parsed.favorites.filter((id) => steamId.test(id)))],
    wallpaperDim: parsed.wallpaperDim,
  };
}
interface Preferences {
  favorites: string[];
  wallpaperDim: boolean;
  toggleFavorite: (id: string) => void;
  setWallpaperDim: (value: boolean) => void;
}
/** 只保留界面偏好；旧演示收藏及“假开关”在迁移时移除，原生控制只来自 Home Query。 */
export const useHomePreferences = create<Preferences>()(
  persist(
    (set) => ({
      favorites: [],
      wallpaperDim: false,
      toggleFavorite: (id) => {
        if (steamId.test(id))
          set((state) => ({
            favorites: state.favorites.includes(id)
              ? state.favorites.filter((value) => value !== id)
              : [...state.favorites, id],
          }));
      },
      setWallpaperDim: (wallpaperDim) => set({ wallpaperDim }),
    }),
    {
      name: 'zhenjing.home.preferences',
      version: 2,
      partialize: ({ favorites, wallpaperDim }) => ({ favorites, wallpaperDim }),
      migrate: normalize,
      merge: (persisted, current) => ({ ...current, ...normalize(persisted) }),
    },
  ),
);
