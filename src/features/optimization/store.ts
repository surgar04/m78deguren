import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { z } from 'zod';
import type { OptimizationDraft } from './types';
import { optimizationSelectionSchema } from '@/lib/optimization-contracts';

const draftSchema = optimizationSelectionSchema;
const stateSchema = z.object({ drafts: z.array(draftSchema).max(201).catch([]) });
interface OptimizationPreferences {
  drafts: OptimizationDraft[];
  stage: (draft: OptimizationDraft) => void;
  replaceDrafts: (drafts: OptimizationDraft[]) => void;
  remove: (id: string) => void;
  clear: () => void;
}

/** 只持久化有限的用户目标值。这里校验存储结构，调用层另按目录白名单校验语义。 */
export const useOptimizationPreferences = create<OptimizationPreferences>()(
  persist(
    (set) => ({
      drafts: [],
      stage: (draft) => {
        const parsed = draftSchema.safeParse(draft);
        if (!parsed.success) return;
        set((state) => ({
          drafts: [
            ...state.drafts.filter((entry) => entry.id !== parsed.data.id),
            parsed.data,
          ].slice(-201),
        }));
      },
      remove: (id) => set((state) => ({ drafts: state.drafts.filter((entry) => entry.id !== id) })),
      replaceDrafts: (drafts) => {
        const parsed = z.array(draftSchema).max(201).safeParse(drafts);
        if (!parsed.success) return;
        set({ drafts: [...new Map(parsed.data.map((draft) => [draft.id, draft])).values()] });
      },
      clear: () => set({ drafts: [] }),
    }),
    {
      name: 'zhenjing.optimization.preferences',
      version: 2,
      migrate: () => ({ drafts: [] }),
      partialize: ({ drafts }) => ({ drafts }),
      merge: (persisted, current) => {
        const value = stateSchema.catch({ drafts: [] }).parse(persisted ?? {});
        const unique = new Map(value.drafts.map((draft) => [draft.id, draft]));
        return { ...current, drafts: [...unique.values()] };
      },
    },
  ),
);
