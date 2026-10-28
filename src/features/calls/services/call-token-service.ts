import { env } from '@/config/env';
import { appError } from '@/services/errors';
import { supabase } from '@/services/supabase/client';
import { fail, ok, type Result } from '@/utils/result';

/**
 * LiveKit erişim anahtarı.
 *
 * Anahtar istemcide üretilmez: API secret'ı paket içine giremeyeceği için
 * `livekit-token` edge function'ı, çağıranın o aramanın tarafı olduğunu
 * doğruladıktan sonra imzalar.
 */
export type CallAccessToken = {
  token: string;
  url: string;
  room: string;
  identity: string;
  kind: 'audio' | 'video';
  expiresIn: number;
};

type TokenResponse = Partial<CallAccessToken> & { error?: string };

const MESSAGES: Record<string, string> = {
  unauthorized: 'Oturum bulunamadı. Tekrar giriş yap.',
  invalid_call_id: 'Arama bilgisi geçersiz.',
  invalid_body: 'Arama bilgisi geçersiz.',
  call_not_found: 'Bu aramaya erişimin yok.',
  call_not_active: 'Arama artık etkin değil.',
  livekit_not_configured: 'Görüşme sunucusu yapılandırılmamış.',
};

function statusOf(error: unknown): number {
  const context = (error as { context?: { status?: number } } | null)?.context;
  return typeof context?.status === 'number' ? context.status : 0;
}

/** Arama kimliği için katılım anahtarı ister. */
export async function fetchCallAccessToken(callId: string): Promise<Result<CallAccessToken>> {
  const fallbackUrl = env.livekitUrl;
  if (!fallbackUrl) {
    return fail(appError('unknown', 'Görüşme sunucusu yapılandırılmamış.'));
  }

  let response: { data: TokenResponse | null; error: unknown };
  try {
    response = await supabase.functions.invoke<TokenResponse>('livekit-token', {
      body: { call_id: callId },
    });
  } catch {
    return fail(appError('network'));
  }

  const { data, error } = response;
  if (error || !data?.token) {
    const status = statusOf(error);
    if (status === 401) {
      return fail(appError('session_missing'));
    }
    if (status === 403) {
      return fail(appError('forbidden', 'Bu aramaya erişimin yok.'));
    }
    if (status === 409) {
      return fail(appError('invalid_input', 'Arama artık etkin değil.'));
    }
    if (status === 503) {
      return fail(appError('unknown', 'Görüşme sunucusu yapılandırılmamış.'));
    }
    if (status === 0) {
      return fail(appError('network'));
    }
    const message = data?.error ? MESSAGES[data.error] : undefined;
    return fail(appError('unknown', message ?? 'Görüşmeye bağlanılamadı. Tekrar dene.'));
  }

  return ok({
    token: data.token,
    url: data.url ?? fallbackUrl,
    room: data.room ?? '',
    identity: data.identity ?? '',
    kind: data.kind ?? 'audio',
    expiresIn: typeof data.expiresIn === 'number' ? data.expiresIn : 3600,
  });
}
