import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { z } from 'zod';

const viewSchema = z.object({ view: z.enum(['grid', 'list']).catch('grid') });
interface CatalogView {
  view: 'grid' | 'list';
  setView: (view: 'grid' | 'list') => void;
}

/** 只保存视图偏好，不保存游戏、搜索结果或模拟业务字段。 */
export const useCatalogView = create<CatalogView>()(
  persist((set) => ({ view: 'grid', setView: (view) => set({ view }) }), {
    name: 'zhenjing.library.view',
    version: 1,
    partialize: ({ view }) => ({ view }),
    merge: (persisted, current) => ({
      ...current,
      ...viewSchema.catch({ view: 'grid' }).parse(persisted ?? {}),
    }),
  }),
);
