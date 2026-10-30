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
  EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
  EXPO_PUBLIC_R2_PUBLIC_URL: process.env.EXPO_PUBLIC_R2_PUBLIC_URL,
  EXPO_PUBLIC_PLACE_SEARCH_URL: process.env.EXPO_PUBLIC_PLACE_SEARCH_URL,
};

const booleanFlag = z
  .string()
  .optional()
  .transform((value) => value === 'true');

/** Boş bırakılan istemci kimlikleri "tanımsız" sayılır; buton gizlenir. */
const optionalClientId = z
  .string()
  .optional()
  .transform((value) => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
  });

const envSchema = z.object({
  EXPO_PUBLIC_SUPABASE_URL: z.string().url('EXPO_PUBLIC_SUPABASE_URL geçerli bir URL olmalı'),
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z
    .string()
    .min(20, 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY eksik veya geçersiz'),
  EXPO_PUBLIC_APP_URL: z.string().url().default('https://www.trabzoneapp.com'),
  EXPO_PUBLIC_LIVEKIT_URL: z.string().optional(),
  EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN: z.string().optional(),
  EXPO_PUBLIC_ENABLE_SOCIAL_AUTH: booleanFlag,
  /**
   * Google ile native giriş için OAuth istemci kimlikleri.
   *
   * - `WEB`: Supabase'deki Google sağlayıcısına yazılan istemci; id token
   *   `aud` doğrulaması bu kimlikle yapılır (Android tarafı da bunu kullanır).
   * - `IOS`: iOS uygulamasının istemci kimliği; `app.config.ts` ters çevrilmiş
   *   URL şemasını Info.plist'e ekler.
   */
  EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: optionalClientId,
  EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: optionalClientId,
  /**
   * Cloudflare R2 public taban adresi (örn. `https://media.trabzoneapp.com`).
   * Tanımlıysa herkese açık kovalardaki bütün fotoğraf ve videolar R2'ye
   * yüklenir ve bu adresten sunulur. Boş bırakılırsa medya yüklemesi çalışmaz;
   * Supabase Storage'a yalnızca gizli sohbet medyası yazılır.
   */
  EXPO_PUBLIC_R2_PUBLIC_URL: z
    .string()
    .optional()
    .transform((value) => (value && value.trim().length > 0 ? value.trim() : undefined))
    .pipe(z.string().url().optional()),
  /**
   * Harici işletme araması uç noktası (Google + Apple haritaları).
   * Boş bırakılırsa `EXPO_PUBLIC_APP_URL/api/place-search` kullanılır.
   */
  EXPO_PUBLIC_PLACE_SEARCH_URL: z
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

const placeSearchUrl =
  parsed.data.EXPO_PUBLIC_PLACE_SEARCH_URL ??
  `${parsed.data.EXPO_PUBLIC_APP_URL.replace(/\/+$/, '')}/api/place-search`;

export const env = {
  supabaseUrl: parsed.data.EXPO_PUBLIC_SUPABASE_URL,
  supabasePublishableKey: parsed.data.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  appUrl: parsed.data.EXPO_PUBLIC_APP_URL,
  livekitUrl: parsed.data.EXPO_PUBLIC_LIVEKIT_URL ?? null,
  mapboxToken: parsed.data.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN ?? null,
  enableSocialAuth: parsed.data.EXPO_PUBLIC_ENABLE_SOCIAL_AUTH,
  /** Google native giriş istemci kimlikleri (tanımsızsa buton gizlenir). */
  googleWebClientId: parsed.data.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? null,
  googleIosClientId: parsed.data.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? null,
  /**
   * R2 public taban adresi. Tanımlıysa bütün medya R2'ye yüklenir ve herkese
   * açık kovalar bu adresten sunulur; gizli sohbet medyası private bucket'ta
   * kalır ve imzalı GET ile okunur.
   */
  r2PublicUrl: parsed.data.EXPO_PUBLIC_R2_PUBLIC_URL ?? null,
  /** Harici (Google/Apple) işletme araması uç noktası. */
  placeSearchUrl,
  /** Fotoğrafı olmayan işletmeler için Google fotoğrafı uç noktası (arama ucunun kardeşi). */
  placePhotoUrl: /\/place-search\/?$/.test(placeSearchUrl)
    ? placeSearchUrl.replace(/\/place-search\/?$/, '/place-photo')
    : `${parsed.data.EXPO_PUBLIC_APP_URL.replace(/\/+$/, '')}/api/place-photo`,
  isDev: __DEV__,
} as const;
