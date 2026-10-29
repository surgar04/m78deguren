import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { z } from 'zod';

export const NAV_IDS = [
  'home',
  'library',
  'hardware',
  'tools',
  'optimization',
  'settings',
] as const;
export const CARD_IDS = [
  'statistics',
  'announcement',
  'quote',
  'launcher',
  'hardware',
  'win-key',
  'game-mode',
  'search',
  'feedback',
  'community',
  'docs',
  'remote',
  'random-image',
  'mood',
] as const;
export const localeSchema = z.enum(['system', 'zh-CN', 'zh-TW', 'en', 'ja', 'de', 'fr']);
const hex = z.string().regex(/^#[a-f0-9]{6}$/iu);
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const navIds = z
  .array(z.enum(NAV_IDS))
  .length(6)
  .refine((rows) => new Set(rows).size === 6);
export const uiSettingsSchema = z
  .object({
    language: localeSchema,
    theme: z.enum(['light', 'dark', 'system']),
    customAccent: hex.nullable(),
    font: z.union([
      z.enum(['MiSans', 'system', 'serif', 'mono']),
      z.string().regex(/^font:[a-f0-9]{64}$/u),
    ]),
    glassEnabled: z.boolean(),
    glassMode: z.enum(['frosted', 'liquid', 'transparent']),
    glassBlur: z.number().int().min(0).max(40),
    backgroundBlur: z.number().int().min(0).max(24),
    islandGlassEnabled: z.boolean(),
    islandGlassMode: z.enum(['frosted', 'liquid']),
    elasticAnimation: z.boolean(),
    backgroundMode: z.enum(['legacy', 'preset', 'image', 'video', 'mr', 'none']),
    preset: z.enum(['island', 'sky', 'mint', 'night']),
    backgroundAsset: digest.nullable(),
    carousel: z.boolean(),
    carouselSeconds: z.number().int().min(5).max(3600),
    mrColorMode: z.enum(['theme', 'custom']),
    mrColor: hex,
    username: z
      .string()
      .max(40)
      .refine((value) => !/[\p{Cc}]/u.test(value)),
    splashEnabled: z.boolean(),
    splashLogo: digest.nullable(),
    navPosition: z.enum(['side', 'top']),
    navLabels: z.boolean(),
    navOrder: navIds,
    navVisible: z
      .array(z.enum(NAV_IDS))
      .min(2)
      .max(6)
      .refine(
        (rows) =>
          new Set(rows).size === rows.length && rows.includes('home') && rows.includes('settings'),
      ),
    cards: z
      .array(z.enum(CARD_IDS))
      .max(14)
      .refine((rows) => new Set(rows).size === rows.length),
  })
  .strict();
export type UiSettings = z.infer<typeof uiSettingsSchema>;
export const DEFAULT_UI_SETTINGS: UiSettings = {
  language: 'system',
  theme: 'light',
  customAccent: null,
  font: 'MiSans',
  glassEnabled: true,
  glassMode: 'frosted',
  glassBlur: 22,
  backgroundBlur: 0,
  islandGlassEnabled: true,
  islandGlassMode: 'frosted',
  elasticAnimation: false,
  backgroundMode: 'legacy',
  preset: 'island',
  backgroundAsset: null,
  carousel: false,
  carouselSeconds: 30,
  mrColorMode: 'theme',
  mrColor: '#7de1cf',
  username: '',
  splashEnabled: true,
  splashLogo: null,
  navPosition: 'side',
  navLabels: true,
  navOrder: [...NAV_IDS],
  navVisible: [...NAV_IDS],
  cards: [...CARD_IDS],
};
interface UiPreferences extends UiSettings {
  patch: (value: unknown) => void;
  resetAppearance: () => void;
}
/** UI 选择只有一个 Zustand 来源；原生策略和检测结果不复制到此处。 */
export const useSettingsUi = create<UiPreferences>()(
  persist(
    (set) => ({
      ...DEFAULT_UI_SETTINGS,
      patch: (value) => {
        const parsed = uiSettingsSchema.partial().strict().safeParse(value);
        if (parsed.success)
          set((current) => {
            const next = uiSettingsSchema.safeParse({
              ...Object.fromEntries(
                Object.keys(uiSettingsSchema.shape).map((key) => [key, Reflect.get(current, key)]),
              ),
              ...parsed.data,
            });
            return next.success ? next.data : current;
          });
      },
      resetAppearance: () =>
        set({
          theme: 'light',
          customAccent: null,
          font: 'MiSans',
          glassEnabled: true,
          glassMode: 'frosted',
          glassBlur: 22,
          backgroundBlur: 0,
          islandGlassEnabled: true,
          islandGlassMode: 'frosted',
          elasticAnimation: false,
          backgroundMode: 'preset',
          preset: 'island',
          backgroundAsset: null,
          carousel: false,
          carouselSeconds: 30,
          mrColorMode: 'theme',
          mrColor: '#7de1cf',
        }),
    }),
    {
      name: 'zhenjing.settings.ui',
      version: 1,
      partialize: (state) =>
        uiSettingsSchema.parse(
          Object.fromEntries(
            Object.keys(uiSettingsSchema.shape).map((key) => [key, Reflect.get(state, key)]),
          ),
        ),
      merge: (persisted, current) => {
        const input = z.record(z.string(), z.unknown()).catch({}).parse(persisted);
        const recovered: Record<string, unknown> = { ...DEFAULT_UI_SETTINGS };
        // 逐字段恢复；单个损坏值不会抹掉其他有效偏好，动作字段永远不从存储恢复。
        for (const [key, schema] of Object.entries(uiSettingsSchema.shape)) {
          const parsed = schema.safeParse(input[key]);
          if (parsed.success) recovered[key] = parsed.data;
        }
        return { ...current, ...uiSettingsSchema.parse(recovered) };
      },
    },
  ),
);
