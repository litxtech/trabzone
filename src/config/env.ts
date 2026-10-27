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
  isDev: __DEV__,
} as const;
