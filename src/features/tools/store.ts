import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { z } from 'zod';

const idSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9-]+$/u);
const schema = z.object({
  favorites: z.array(idSchema).max(200).catch([]),
  recent: z.array(idSchema).max(50).catch([]),
});
interface ToolPreferences extends z.infer<typeof schema> {
  toggleFavorite: (id: string) => void;
  recordOpen: (id: string) => void;
}

/** 只保存用户选择的ID；目录、搜索结果和模拟文案仍由TanStack Query单独管理。 */
export const useToolPreferences = create<ToolPreferences>()(
  persist(
    (set) => ({
      favorites: [],
      recent: [],
      toggleFavorite: (id) => {
        if (!idSchema.safeParse(id).success) return;
        set((state) => ({
          favorites: state.favorites.includes(id)
            ? state.favorites.filter((value) => value !== id)
            : [...state.favorites, id].slice(-200),
        }));
      },
      // 最近使用记录的是打开详情，不伪造工具执行成功或安装状态。
      recordOpen: (id) => {
        if (!idSchema.safeParse(id).success) return;
        set((state) => ({
          recent: [id, ...state.recent.filter((value) => value !== id)].slice(0, 50),
        }));
      },
    }),
    {
      name: 'zhenjing.tools.preferences',
      version: 1,
      partialize: ({ favorites, recent }) => ({ favorites, recent }),
      merge: (persisted, current) => {
        const value = schema.catch({ favorites: [], recent: [] }).parse(persisted ?? {});
        return {
          ...current,
          favorites: [...new Set(value.favorites)],
          recent: [...new Set(value.recent)],
        };
      },
    },
  ),
);
