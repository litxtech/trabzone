import type { AuthError } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';

import { env } from '@/config/env';
import { mapAuthError, appError } from '@/services/errors';
import { supabase } from '@/services/supabase/client';
import { fail, ok, type Result } from '@/utils/result';

import type { SocialProvider } from '@/services/supabase/auth';

export type LinkedProvider = 'email' | 'apple' | 'google' | 'phone';

export type AccountOverview = {
  id: string;
  email: string | null;
  emailVerified: boolean;
  phone: string | null;
  providers: LinkedProvider[];
  createdAt: string | null;
  lastSignInAt: string | null;
};

const PROVIDER_LABELS: Record<string, string> = {
  email: 'E-posta ve şifre',
  apple: 'Apple',
  google: 'Google',
  phone: 'Telefon',
};

export function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
}

function readFailure(error: AuthError): Result<never> {
  return fail(mapAuthError(error));
}

export async function fetchAccountOverview(): Promise<Result<AccountOverview>> {
  const { data, error } = await supabase.auth.getUser();
  if (error) {
    return readFailure(error);
  }
  const user = data.user;
  if (!user) {
    return fail(appError('session_missing'));
  }

  const identities = await supabase.auth.getUserIdentities();
  const providers = (identities.data?.identities ?? [])
    .map((identity) => identity.provider as LinkedProvider)
    .filter(Boolean);
  // Email/şifre kimliği bazı sağlayıcılarda `email` olarak listelenmez.
  if (user.email && !providers.includes('email')) {
    providers.unshift('email');
  }

  return ok({
    id: user.id,
    email: user.email ?? null,
    emailVerified: Boolean(user.email_confirmed_at),
    phone: user.phone ?? null,
    providers: Array.from(new Set<LinkedProvider>(providers)),
    createdAt: user.created_at ?? null,
    lastSignInAt: user.last_sign_in_at ?? null,
  });
}

/** Oturumdaki kullanıcı için yeni şifre belirler (mevcut oturum doğrulama yerine geçer). */
export async function changePassword(password: string): Promise<Result<null>> {
  if (password.length < 8) {
    return fail(appError('invalid_input', 'Şifre en az 8 karakter olmalı.'));
  }
  const { error } = await supabase.auth.updateUser({ password });
  return error ? readFailure(error) : ok(null);
}

/**
 * E-posta değişimi Supabase tarafında doğrulama gerektirir: yeni adrese onay
 * bağlantısı gider, onaylanana kadar eski adres geçerli kalır.
 */
export async function requestEmailChange(email: string): Promise<Result<null>> {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return fail(appError('invalid_input', 'Geçerli bir e-posta adresi gir.'));
  }
  const { error } = await supabase.auth.updateUser({ email: normalized });
  return error ? readFailure(error) : ok(null);
}

export async function resendEmailVerification(): Promise<Result<null>> {
  const { data } = await supabase.auth.getUser();
  const email = data.user?.email;
  if (!email) {
    return fail(appError('session_missing'));
  }
  const { error } = await supabase.auth.resend({ type: 'signup', email });
  return error ? readFailure(error) : ok(null);
}

export async function unlinkProvider(provider: LinkedProvider): Promise<Result<null>> {
  if (provider === 'email') {
    return fail(
      appError('invalid_input', 'E-posta girişi kaldırılamaz. Bunun yerine yeni bir e-posta ekleyebilirsin.'),
    );
  }

  const identities = await supabase.auth.getUserIdentities();
  const identity = identities.data?.identities?.find((item) => item.provider === provider);
  if (!identity) {
    return fail(appError('not_found', 'Bu sağlayıcı hesabına bağlı değil.'));
  }
  if ((identities.data?.identities?.length ?? 0) <= 1) {
    return fail(
      appError('invalid_input', 'Tek giriş yöntemini kaldıramazsın. Önce başka bir yöntem bağla.'),
    );
  }

  const { error } = await supabase.auth.unlinkIdentity(identity);
  if (error) {
    if (error.message.toLowerCase().includes('manual linking')) {
      return fail(
        appError('forbidden', 'Hesap bağlama, proje ayarlarında etkin değil. Destek ile iletişime geç.'),
      );
    }
    return readFailure(error);
  }
  return ok(null);
}

type WebBrowserModule = typeof import('expo-web-browser');

async function loadWebBrowser(): Promise<WebBrowserModule | null> {
  try {
    return await import('expo-web-browser');
  } catch {
    return null;
  }
}

function readUrlParam(url: string, key: string): string | null {
  const pattern = new RegExp(`[?#&]${key}=([^&]*)`);
  const match = pattern.exec(url);
  if (!match?.[1]) {
    return null;
  }
  try {
    return decodeURIComponent(match[1].replace(/\+/g, ' '));
  } catch {
    return match[1];
  }
}

/**
 * Mevcut hesaba yeni bir sosyal giriş bağlar. Akış sonunda dönen oturumun
 * aynı kullanıcıya ait olduğu doğrulanır; farklı bir hesap açılmışsa oturum
 * kapatılır ve kullanıcıya hata gösterilir.
 */
export async function linkProvider(provider: SocialProvider): Promise<Result<null>> {
  if (!env.enableSocialAuth) {
    return fail(appError('oauth_unavailable', 'Sosyal giriş şu anda kullanılamıyor.'));
  }
  if (Platform.OS === 'web') {
    return fail(appError('oauth_unavailable', 'Hesap bağlama mobil uygulamada yapılabilir.'));
  }

  const WebBrowser = await loadWebBrowser();
  if (!WebBrowser) {
    return fail(appError('oauth_unavailable', 'Hesap bağlamak için uygulamanın güncel sürümü gerekli.'));
  }

  const current = await supabase.auth.getUser();
  const previousUserId = current.data.user?.id;
  if (!previousUserId) {
    return fail(appError('session_missing'));
  }

  const redirectTo = Linking.createURL('auth/callback');
  const { data, error } = await supabase.auth.linkIdentity({
    provider,
    options: { redirectTo, skipBrowserRedirect: true },
  });

  if (error) {
    return readFailure(error);
  }
  if (!data?.url) {
    return fail(appError('oauth_unavailable', 'Sağlayıcı bağlantısı açılamadı.'));
  }

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo, {
    showInRecents: false,
  });

  if (result.type !== 'success' || !result.url) {
    return fail(appError('oauth_cancelled'));
  }

  const providerError = readUrlParam(result.url, 'error_description') ?? readUrlParam(result.url, 'error');
  if (providerError) {
    return fail(appError('oauth_unavailable', providerError));
  }

  const code = readUrlParam(result.url, 'code');
  if (!code) {
    return fail(appError('oauth_unavailable', 'Bağlama tamamlanamadı. Tekrar dene.'));
  }

  const exchanged = await supabase.auth.exchangeCodeForSession(code);
  if (exchanged.error) {
    return readFailure(exchanged.error);
  }

  if (exchanged.data.session?.user.id && exchanged.data.session.user.id !== previousUserId) {
    // Güvenlik: başka bir hesabın oturumu açıldıysa geri al.
    await supabase.auth.signOut();
    return fail(appError('forbidden', 'Farklı bir hesap açıldı. Bağlantı iptal edildi.'));
  }

  return ok(null);
}
