import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { z } from 'zod';

/** 固定的产品调色板是真实配置，不能随着演示数据源的移除而消失。 */
export const ACCENTS = [
  { id: 'mint', label: '薄荷', color: '#7de1cf', surface: '#a4efdf' },
  { id: 'sky', label: '晴空', color: '#a4d0ff', surface: '#c1ddff' },
  { id: 'lavender', label: '薰衣草', color: '#c8b9ff', surface: '#ded5ff' },
] as const;
export const accentSchema = z.enum(['mint', 'sky', 'lavender']);
export const motionSchema = z.enum(['system', 'reduce']);
const preferencesSchema = z.object({
  compact: z.boolean().catch(false),
  accent: accentSchema.catch('mint'),
  motion: motionSchema.catch('system'),
});
export const DEFAULT_PREFERENCES = preferencesSchema.parse({});

interface Preferences extends z.infer<typeof preferencesSchema> {
  toggleCompact: () => void;
  setAccent: (value: unknown) => void;
  setMotion: (value: unknown) => void;
  resetAppearance: () => void;
}

// localStorage 属于 WebView 数据目录，由 Rust 明确设置在应用数据目录。
export const usePreferences = create<Preferences>()(
  persist(
    (set) => ({
      ...DEFAULT_PREFERENCES,
      toggleCompact: () => set((state) => ({ compact: !state.compact })),
      setAccent: (value) => {
        const result = accentSchema.safeParse(value);
        if (result.success) set({ accent: result.data });
      },
      setMotion: (value) => {
        const result = motionSchema.safeParse(value);
        if (result.success) set({ motion: result.data });
      },
      resetAppearance: () => set(DEFAULT_PREFERENCES),
    }),
    {
      name: 'zhenjing.preferences',
      version: 1,
      partialize: ({ compact, accent, motion }) => ({ compact, accent, motion }),
      // 兼容原先只含compact的v1数据；不信任localStorage中的结构或动作字段。
      merge: (persisted, current) => ({
        ...current,
        ...preferencesSchema.catch(DEFAULT_PREFERENCES).parse(persisted ?? {}),
      }),
    },
  ),
);
