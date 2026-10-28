import { z } from 'zod';

/**
 * Expo inlines `process.env.EXPO_PUBLIC_*` at build time, so every variable is
 * read through a static property access (never a dynamic key).
 */
const rawEnv = {
  EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  EXPO_PUBLIC_APP_URL: process.env.EXPO_PUBLIC_APP_URL,
  EXPO_PUBLIC_LIVEKIT_URL: process.env.EXPO_PUBLIC_LIVEKIT_URL,
  EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN: process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN,
  EXPO_PUBLIC_ENABLE_SOCIAL_AUTH: process.env.EXPO_PUBLIC_ENABLE_SOCIAL_AUTH,
  EXPO_PUBLIC_MAX_UPLOAD_MB: process.env.EXPO_PUBLIC_MAX_UPLOAD_MB,
  EXPO_PUBLIC_R2_PUBLIC_URL: process.env.EXPO_PUBLIC_R2_PUBLIC_URL,
};

const booleanFlag = z
  .string()
  .optional()
  .transform((value) => value === 'true');

const envSchema = z.object({
  EXPO_PUBLIC_SUPABASE_URL: z.string().url('EXPO_PUBLIC_SUPABASE_URL geçerli bir URL olmalı'),
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z
    .string()
    .min(20, 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY eksik veya geçersiz'),
  EXPO_PUBLIC_APP_URL: z.string().url().default('https://trabzone.app'),
  EXPO_PUBLIC_LIVEKIT_URL: z.string().optional(),
  EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN: z.string().optional(),
  EXPO_PUBLIC_ENABLE_SOCIAL_AUTH: booleanFlag,
  /**
   * Depo tarafındaki tek dosya sınırı (MB). Supabase Free planında 50'dir;
   * plan yükseltildiğinde yalnızca ortam değişkeni güncellenir.
   */
  EXPO_PUBLIC_MAX_UPLOAD_MB: z
    .string()
    .optional()
    .transform((value) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 50;
    }),
  /**
   * Cloudflare R2 public taban adresi (örn. `https://media.trabzone.app`).
   * Tanımlıysa herkese açık kovalardaki bütün fotoğraf ve videolar R2'ye
   * yüklenir ve bu adresten sunulur. Boş bırakılırsa medya yüklemesi çalışmaz;
   * Supabase Storage'a yalnızca gizli sohbet medyası yazılır.
   */
  EXPO_PUBLIC_R2_PUBLIC_URL: z
    .string()
    .optional()
    .transform((value) => (value && value.trim().length > 0 ? value.trim() : undefined))
    .pipe(z.string().url().optional()),
});

const parsed = envSchema.safeParse(rawEnv);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `- ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  throw new Error(`Ortam değişkenleri eksik veya hatalı:\n${details}`);
}

export const env = {
  supabaseUrl: parsed.data.EXPO_PUBLIC_SUPABASE_URL,
  supabasePublishableKey: parsed.data.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  appUrl: parsed.data.EXPO_PUBLIC_APP_URL,
  livekitUrl: parsed.data.EXPO_PUBLIC_LIVEKIT_URL ?? null,
  mapboxToken: parsed.data.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN ?? null,
  enableSocialAuth: parsed.data.EXPO_PUBLIC_ENABLE_SOCIAL_AUTH,
  /**
   * Depo tarafındaki tek dosya sınırı. Ürün tarafında sınır yoktur; bu değer
   * yalnızca yüklemenin reddedilmemesi için videonun otomatik sığdırılmasında
   * kullanılır.
   */
  maxUploadBytes: Math.round(parsed.data.EXPO_PUBLIC_MAX_UPLOAD_MB * 1024 * 1024),
  /** R2 public taban adresi; tanımlıysa büyük videolar R2'ye gider. */
  r2PublicUrl: parsed.data.EXPO_PUBLIC_R2_PUBLIC_URL ?? null,
  isDev: __DEV__,
} as const;
