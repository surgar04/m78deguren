import { z } from 'zod';

/** 平台身份属于歌曲主键的一部分，禁止不同平台的相同数字 ID 相互覆盖。 */
export const onlineMusicProviderSchema = z.enum(['qq', 'netease', 'ytm', 'spotify']);
export const musicProviderSchema = z.enum(['qq', 'netease', 'ytm', 'spotify', 'local']);
export type OnlineMusicProvider = z.infer<typeof onlineMusicProviderSchema>;
export type MusicProvider = z.infer<typeof musicProviderSchema>;
export const musicStyleSchema = z.enum([
  'classic',
  'cadenza',
  'partita',
  'fume',
  'cappella',
  'tilt',
  'claddagh',
  'monet',
  'diorama',
  'pendolo',
  'sonnet',
  'tempera',
  'lumiere',
  'nebbia',
  'hanabi',
  'machi',
  'still',
]);
export const musicBackgroundSchema = z.enum(['common', 'latent', 'monet', 'nomand', 'sora', 'url']);
export type MusicStyle = z.infer<typeof musicStyleSchema>;
export type MusicBackground = z.infer<typeof musicBackgroundSchema>;
const text = z.string().max(4096);
export const musicTrackSchema = z
  .object({
    key: z.string().min(3).max(200),
    id: z.string().min(1).max(128),
    provider: musicProviderSchema,
    title: text,
    artists: z.array(text).max(64),
    album: text,
    durationMs: z.number().finite().nonnegative().max(604_800_000),
    cover: z.string().max(16384).nullable(),
    matched: z.boolean().default(false),
    matchSource: z
      .object({ provider: onlineMusicProviderSchema, id: z.string().max(128) })
      .nullable()
      .optional(),
  })
  .strict();
export type MusicTrack = z.infer<typeof musicTrackSchema>;
/** 匹配候选必须保留平台身份和 0..100 的原始评分，不能把未知对象作为元数据覆盖层写入。 */
export const musicMatchSchema = z
  .array(z.object({ track: musicTrackSchema, score: z.number().finite().min(0).max(100) }))
  .max(1000);
export const musicPageSchema = z
  .object({
    items: z.array(musicTrackSchema).max(1000),
    hasMore: z.boolean(),
    nextOffset: z.number().int().nonnegative(),
  })
  .strict();
export const musicWordSchema = z
  .object({
    text,
    startTime: z.number().finite().nonnegative(),
    endTime: z.number().finite().nonnegative(),
  })
  .passthrough();
/** 保留上游逐字、和声、译文、分段等扩展；不用整句平均分词伪造逐字时间。 */
export const musicLineSchema = z
  .object({
    fullText: text,
    startTime: z.number().finite().nonnegative(),
    endTime: z.number().finite().nonnegative(),
    words: z.array(musicWordSchema).max(5000),
    translation: text.optional(),
    romanization: text.optional(),
  })
  .passthrough();
export const musicLyricsSchema = z
  .object({
    lines: z.array(musicLineSchema).max(50_000),
    source: text,
    wordTimed: z.boolean(),
    isPureMusic: z.boolean(),
  })
  .strict();
export type MusicLyrics = z.infer<typeof musicLyricsSchema>;
export const musicCollectionSchema = z
  .object({
    id: z.string().max(200),
    provider: onlineMusicProviderSchema,
    title: text,
    cover: z.string().max(16384).nullable(),
    count: z.number().int().nonnegative().nullable(),
  })
  .strict();
export type MusicCollection = z.infer<typeof musicCollectionSchema>;
export const musicAccountSchema = z
  .object({
    provider: onlineMusicProviderSchema,
    connected: z.boolean(),
    nickname: text,
    avatar: z.string().max(16384).nullable(),
    premium: z.boolean(),
  })
  .strict();
export const musicLoginSchema = z
  .object({
    key: z.string().max(1024),
    image: z.string().max(4_000_000),
    browser: z.boolean(),
  })
  .strict();
export const musicLoginStateSchema = z
  .object({
    state: z.enum(['waiting', 'scanned', 'confirmed', 'expired', 'error']),
    message: text,
    phase: z
      .enum([
        'idle',
        'opening',
        'browser',
        'reading',
        'verifying',
        'confirmed',
        'error',
        'cancelled',
      ])
      .optional(),
    code: z.string().max(64).optional(),
    diagnostics: z.string().max(8192).optional(),
  })
  .strict();
export const desktopLyricsConfigSchema = z
  .object({
    enabled: z.boolean(),
    locked: z.boolean(),
    fontSize: z.number().int().min(20).max(56),
    opacity: z.number().finite().min(0.3).max(1),
    x: z.number().int().min(-100000).max(100000).nullable(),
    y: z.number().int().min(-100000).max(100000).nullable(),
  })
  .strict();
export type DesktopLyricsConfig = z.infer<typeof desktopLyricsConfigSchema>;
/** 低频内容与高频时钟分离；歌词来自同一个播放器，不启动第二个音源或另做在线匹配。 */
export const desktopLyricsContentSchema = z
  .object({
    key: z.string().max(200),
    title: z.string().max(4096),
    artist: z.string().max(4096),
    lyrics: musicLyricsSchema,
  })
  .strict();
export type DesktopLyricsContent = z.infer<typeof desktopLyricsContentSchema>;
export const desktopLyricsClockSchema = z
  .object({
    positionMs: z.number().finite().nonnegative().max(604800000),
    paused: z.boolean(),
  })
  .strict();
export const desktopLyricsSnapshotSchema = z
  .object({
    config: desktopLyricsConfigSchema,
    content: desktopLyricsContentSchema.nullable(),
    clock: desktopLyricsClockSchema,
  })
  .strict();

const jsonValue: z.ZodType<unknown> = z.json();
const params = z.record(z.string().max(100), jsonValue);
/** 只开放音乐领域动作；原生端重新校验平台、端点、参数大小和窗口身份。 */
export const musicRequestSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('embed'), url: z.url().max(4096) }).strict(),
  z.object({ operation: z.literal('runtime') }).strict(),
  z
    .object({
      operation: z.literal('provider'),
      provider: onlineMusicProviderSchema,
      action: z.string().min(1).max(80),
      params,
    })
    .strict(),
  z
    .object({
      operation: z.literal('api'),
      provider: z.enum(['netease', 'qq']),
      path: z.string().regex(/^\/[a-zA-Z0-9/_-]{1,100}$/u),
      method: z.enum(['GET', 'POST']),
      params,
    })
    .strict(),
  z
    .object({
      operation: z.literal('relay'),
      url: z.url().max(16384),
      kind: z.enum(['text', 'image', 'audio']),
      method: z.enum(['GET', 'POST']).optional(),
      body: z.string().max(1048576).optional(),
    })
    .strict(),
  z.object({ operation: z.literal('local-list') }).strict(),
  z.object({ operation: z.literal('local-import'), folder: z.boolean() }).strict(),
  z.object({ operation: z.literal('local-audio'), id: z.uuid() }).strict(),
  z.object({ operation: z.literal('local-lyrics'), id: z.uuid(), choose: z.boolean() }).strict(),
  z.object({ operation: z.literal('local-remove'), id: z.uuid() }).strict(),
  z.object({ operation: z.literal('local-reveal'), id: z.uuid() }).strict(),
  z
    .object({
      operation: z.literal('local-match'),
      id: z.uuid(),
      track: musicTrackSchema.nullable(),
    })
    .strict(),
  z.object({ operation: z.literal('immersive'), enabled: z.boolean() }).strict(),
  z.object({ operation: z.literal('desktop-read') }).strict(),
  z
    .object({ operation: z.literal('desktop-configure'), config: desktopLyricsConfigSchema })
    .strict(),
  z
    .object({
      operation: z.literal('desktop-content'),
      content: desktopLyricsContentSchema.nullable(),
    })
    .strict(),
  z.object({ operation: z.literal('desktop-clock'), clock: desktopLyricsClockSchema }).strict(),
  z
    .object({
      operation: z.literal('desktop-control'),
      action: z.enum(['close', 'lock', 'unlock', 'drag', 'reset-position']),
    })
    .strict(),
]);
export type MusicRequest = z.infer<typeof musicRequestSchema>;
export const musicLocalLibrarySchema = z
  .object({
    tracks: z.array(musicTrackSchema),
    importing: z.boolean(),
    processed: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    message: text,
  })
  .strict();
export const musicAudioSchema = z
  .object({
    url: z.string().min(1).max(16384),
    preview: z.boolean(),
    quality: text,
    clipStartMs: z.number().finite().nonnegative().default(0),
  })
  .strict();
export type MusicAudio = z.infer<typeof musicAudioSchema>;
export const musicRawLyricSchema = z
  .object({
    text: z.string().max(8_000_000),
    format: z.string().max(16),
  })
  .strict();
export const musicThemeSchema = z
  .object({
    name: z.string().max(100),
    backgroundColor: z.string().max(128),
    primaryColor: z.string().max(128),
    accentColor: z.string().max(128),
    secondaryColor: z.string().max(128),
    fontStyle: z.enum(['sans', 'serif', 'mono']),
    animationIntensity: z.enum(['calm', 'normal', 'chaotic']),
    fontFamily: z.string().max(256).optional(),
    fontFamilyStack: z.array(z.string().max(256)).max(20).optional(),
    fontWeight: z.number().min(100).max(1000).optional(),
    wordColors: z
      .array(z.object({ word: z.string().max(500), color: z.string().max(128) }))
      .max(500)
      .optional(),
    lyricsIcons: z.array(z.string().max(128)).max(100).optional(),
  })
  .passthrough();
export type MusicTheme = z.infer<typeof musicThemeSchema>;
