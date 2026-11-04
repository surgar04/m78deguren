import { z } from 'zod';

const text = z.string().max(16000);
export const gameRoomPreferencesSchema = z
  .object({ autoOpen: z.boolean(), alwaysOnTop: z.boolean(), blockStickyKeys: z.boolean() })
  .strict();
export const deltaAccountSchema = z
  .object({
    phase: z.enum(['disconnected', 'authorizing', 'connected', 'error']),
    message: text,
    nickname: text,
    avatar: text,
    level: text,
    updatedAt: z.number().nonnegative(),
  })
  .strict();
export const gameRoomSchema = z
  .object({
    protectionMessage: text,
    session: z
      .object({
        id: text,
        gameId: text,
        name: text,
        pid: z.number().int().nonnegative(),
        startedAt: z.number().nonnegative(),
        endedAt: z.number().nonnegative().nullable(),
        running: z.boolean(),
        message: text,
      })
      .strict(),
    preferences: gameRoomPreferencesSchema,
    account: deltaAccountSchema,
  })
  .strict();
export const deltaCategorySchema = z.object({
  id: z.number().int().positive(),
  name: text,
  loadout_count: z.number().nonnegative(),
});
export const deltaWeaponSchema = z.object({ weapon_name: text, count: z.number().nonnegative() });
export const deltaLoadoutSchema = z.object({
  id: z.number().int().positive(),
  category_id: z.number().int().positive(),
  weapon_name: text,
  code: text,
  description: text,
  cost: z.number().nonnegative(),
  author: text,
  likes: z.number().nonnegative(),
  status: text,
  created_at: text,
  category_name: text,
});
export const deltaLoadoutsSchema = z.object({
  data: z.array(deltaLoadoutSchema).max(200),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  totalPages: z.number().int().nonnegative(),
});
/** 官方战绩字段随赛季变化；先校验为有界 JSON 对象，再由纯函数逐字段读取，禁止断言 unknown 为业务结构。 */
export const deltaRecordSchema = z.record(z.string().max(200), z.unknown());
export const deltaStatsSchema = z
  .object({
    account: deltaAccountSchema,
    data: deltaRecordSchema,
    updatedAt: z.number().nonnegative(),
  })
  .strict();
const field = z.object({
  id: text,
  label: text,
  value: text.optional(),
  note: text.optional(),
  secondary: text.optional(),
  behavior: text.optional(),
});
export const deltaStreamerSchema = z.object({
  id: z.string().max(200),
  name: text,
  game: text,
  platform: text,
  avatar: z.string().max(6_000_000).optional(),
  tags: z.array(text).optional(),
  updated: text.optional(),
  deleted: z.boolean().optional(),
  profile: z
    .object({
      name: text,
      game: text,
      platform: text,
      homepage: text.optional(),
      liveUrl: text.optional(),
      updated: text.optional(),
      groups: z
        .array(z.object({ id: text, title: text, tab: text, fields: z.array(field).max(500) }))
        .max(200)
        .optional(),
      equipment: z
        .array(
          z.object({
            id: text,
            category: text,
            brand: text,
            model: text,
            imageUrl: text.optional(),
            officialUrl: text.optional(),
            dpi: text.optional(),
            pollingRate: text.optional(),
          }),
        )
        .max(100)
        .optional(),
    })
    .optional(),
});
export const deltaStreamersSchema = z
  .object({
    data: z.object({ entries: z.array(deltaStreamerSchema).max(3000) }),
    fetchedAt: z.number().positive(),
    cached: z.boolean(),
  })
  .strict();
export type DeltaStreamer = z.infer<typeof deltaStreamerSchema>;
export type GameRoomPreferences = z.infer<typeof gameRoomPreferencesSchema>;

export const gameRoomRequestSchema = z.discriminatedUnion('operation', [
  z
    .object({
      operation: z.enum([
        'snapshot',
        'open',
        'telemetry',
        'categories',
        'passwords',
        'stats',
        'auth-open',
        'auth-cancel',
        'refresh',
        'dictionaries',
      ]),
    })
    .strict(),
  z.object({ operation: z.literal('configure'), preferences: gameRoomPreferencesSchema }).strict(),
  z
    .object({ operation: z.literal('weapons'), category: z.number().int().positive().max(10000) })
    .strict(),
  z
    .object({
      operation: z.literal('loadouts'),
      category: z.number().int().positive().max(10000).nullable(),
      weapon: z.string().max(100),
      search: z.string().max(120),
      page: z.number().int().positive().max(10000),
    })
    .strict(),
  z.object({ operation: z.literal('like'), id: z.number().int().positive() }).strict(),
  z
    .object({
      operation: z.literal('report'),
      id: z.number().int().positive(),
      consent: z.literal(true),
    })
    .strict(),
  z
    .object({
      operation: z.literal('submit'),
      category: z.number().int().positive().max(10000),
      weapon: z.string().min(1).max(100),
      code: z.string().min(1).max(300),
      cost: z.number().int().positive().max(10_000_000_000),
      description: z.string().max(2000),
      author: z.string().max(80),
      consent: z.literal(true),
    })
    .strict(),
  z.object({ operation: z.literal('streamers'), refresh: z.boolean() }).strict(),
  z
    .object({
      operation: z.literal('link'),
      key: z.enum(['map', 'wallpaper', 'maqt', 'anxu', 'streamer-codes', 'xiaotao', 'wegame']),
    })
    .strict(),
  z.object({ operation: z.literal('asset'), url: z.string().max(6_000_000) }).strict(),
  z
    .object({
      operation: z.literal('season'),
      sid: z.string().regex(/^\d{1,20}$/u),
      queue: z.enum(['sol', 'tdm']),
    })
    .strict(),
  z
    .object({
      operation: z.literal('detail'),
      room_id: z.string().min(1).max(128),
      start_time: z.string().max(64),
      queue: z.enum(['sol', 'tdm']),
    })
    .strict(),
  z.object({ operation: z.literal('logout'), consent: z.literal(true) }).strict(),
  z.object({ operation: z.literal('sticky-restore'), consent: z.literal(true) }).strict(),
]);
export type GameRoomRequest = z.infer<typeof gameRoomRequestSchema>;
