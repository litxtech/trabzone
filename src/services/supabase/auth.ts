import type { AuthError, Session } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';

import { env } from '@/config/env';
import { appError, mapAuthError, type AppError } from '@/services/errors';
import { fail, ok, type Result } from '@/utils/result';

import { supabase } from './client';

const normalizeEmail = (email: string) => email.trim().toLowerCase();

const toFailure = (error: AuthError): Result<never> => fail(mapAuthError(error));

export async function signInWithPassword(
  email: string,
  password: string,
): Promise<Result<Session>> {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: normalizeEmail(email),
    password,
  });

  if (error) {
    return toFailure(error);
  }
  if (!data.session) {
    return fail(appError('email_not_confirmed'));
  }
  return ok(data.session);
}

export type SignUpPayload = {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  username: string;
};

export async function signUpWithPassword(payload: SignUpPayload): Promise<Result<{ needsVerification: boolean }>> {
  const { data, error } = await supabase.auth.signUp({
    email: normalizeEmail(payload.email),
    password: payload.password,
    options: {
      data: {
        first_name: payload.firstName.trim(),
        last_name: payload.lastName.trim(),
        username: payload.username.trim().toLowerCase(),
      },
    },
  });

  if (error) {
    return toFailure(error);
  }

  // Supabase hides "email already registered" behind an empty identities array.
  if (data.user && data.user.identities?.length === 0) {
    return fail(appError('user_exists'));
  }

  return ok({ needsVerification: data.session === null });
}

export async function verifySignUpOtp(email: string, token: string): Promise<Result<Session>> {
  const { data, error } = await supabase.auth.verifyOtp({
    email: normalizeEmail(email),
    token,
    type: 'signup',
  });

  if (error) {
    return toFailure(error);
  }
  if (!data.session) {
    return fail(appError('otp_invalid'));
  }
  return ok(data.session);
}

export async function resendSignUpOtp(email: string): Promise<Result<null>> {
  const { error } = await supabase.auth.resend({ type: 'signup', email: normalizeEmail(email) });
  return error ? toFailure(error) : ok(null);
}

export async function requestPasswordReset(email: string): Promise<Result<null>> {
  const { error } = await supabase.auth.resetPasswordForEmail(normalizeEmail(email));
  return error ? toFailure(error) : ok(null);
}

export async function verifyRecoveryOtp(email: string, token: string): Promise<Result<Session>> {
  const { data, error } = await supabase.auth.verifyOtp({
    email: normalizeEmail(email),
    token,
    type: 'recovery',
  });

  if (error) {
    return toFailure(error);
  }
  if (!data.session) {
    return fail(appError('otp_invalid'));
  }
  return ok(data.session);
}

export async function updatePassword(password: string): Promise<Result<null>> {
  const { error } = await supabase.auth.updateUser({ password });
  return error ? toFailure(error) : ok(null);
}

export async function signOut(): Promise<Result<null>> {
  const { error } = await supabase.auth.signOut();
  return error ? toFailure(error) : ok(null);
}

export type SocialProvider = 'apple' | 'google';

const SOCIAL_DISABLED_MESSAGE =
  'Sosyal giriş şu anda kullanılamıyor. E-posta ile giriş yapabilir veya hesap oluşturabilirsin.';
const OAUTH_SESSION_MESSAGE =
  'Sosyal giriş tamamlanamadı. Bağlantını kontrol edip tekrar dene.';
const SOCIAL_CLIENT_STALE_MESSAGE =
  'Sosyal giriş için uygulamanın güncel sürümü gerekli. E-posta ile devam edebilirsin.';

type AppleAuthenticationModule = typeof import('expo-apple-authentication');
type CryptoModule = typeof import('expo-crypto');
type WebBrowserModule = typeof import('expo-web-browser');

/**
 * Sosyal giriş native modülleri yalnızca gerektiğinde yüklenir. Eski bir
 * dev-client derlemesinde modül bulunmasa bile uygulama açılmaya devam eder;
 * sosyal butonlar kontrollü bir mesajla devre dışı kalır.
 */
async function loadNativeModule<T>(loader: () => Promise<T>): Promise<T | null> {
  try {
    return await loader();
  } catch {
    return null;
  }
}

function providerFailure(error: AuthError): Result<never> {
  const message = error.message.toLowerCase();
  if (
    message.includes('provider is not enabled') ||
    message.includes('missing oauth secret') ||
    message.includes('unsupported provider') ||
    message.includes('oauth secret')
  ) {
    return fail(appError('oauth_unavailable', SOCIAL_DISABLED_MESSAGE));
  }
  return toFailure(error);
}

/** URLSearchParams, query ve hash parcaciklarindan tek bir deger okur. */
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

async function exchangeAuthCode(code: string): Promise<Result<Session>> {
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return providerFailure(error);
  }
  if (!data.session) {
    return fail(appError('oauth_unavailable', OAUTH_SESSION_MESSAGE));
  }
  return ok(data.session);
}

/**
 * Supabase OAuth'u sistem tarayicisinda acar (Google ve web uzerinden Apple).
 * PKCE akisinin code parametresi WebBrowser tarafindan yakalanir ve oturuma
 * cevrilir. Donen oturum Supabase'in kendi auth state dinleyicisine de duser;
 * boylece profil/RLS istekleri ayni kullaniciyla devam eder.
 */
async function signInWithOAuthBrowser(provider: SocialProvider): Promise<Result<Session>> {
  if (Platform.OS === 'web') {
    return fail(
      appError(
        'oauth_unavailable',
        'Sosyal giriş mobil uygulamada kullanılabilir. Tarayıcıda e-posta ile devam edebilirsin.',
      ),
    );
  }

  const redirectTo = Linking.createURL('auth/callback');
  const WebBrowser = await loadNativeModule<WebBrowserModule>(() => import('expo-web-browser'));
  if (!WebBrowser) {
    return fail(appError('oauth_unavailable', SOCIAL_CLIENT_STALE_MESSAGE));
  }

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo,
      skipBrowserRedirect: true,
    },
  });

  if (error) {
    return providerFailure(error);
  }
  if (!data?.url) {
    return fail(appError('oauth_unavailable', SOCIAL_DISABLED_MESSAGE));
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
  if (code) {
    return exchangeAuthCode(code);
  }

  // Bazi saglayicilar implicit akisla token dondurur; PKCE yedegi olarak kabul edilir.
  const accessToken = readUrlParam(result.url, 'access_token');
  const refreshToken = readUrlParam(result.url, 'refresh_token');
  if (accessToken && refreshToken) {
    const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (sessionError) {
      return providerFailure(sessionError);
    }
    return sessionData.session
      ? ok(sessionData.session)
      : fail(appError('oauth_unavailable', OAUTH_SESSION_MESSAGE));
  }

  return fail(appError('oauth_unavailable', OAUTH_SESSION_MESSAGE));
}

function isAppleCancellation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'ERR_REQUEST_CANCELED'
  );
}

/**
 * iOS'ta gercek native Apple oturumu acar; Android'de Apple'in web OAuth
 * akisina duser. Native kimlik anahtari Supabase tarafinda dogrulanir.
 */
export async function signInWithApple(): Promise<Result<Session>> {
  if (!env.enableSocialAuth) {
    return fail(appError('oauth_unavailable', SOCIAL_DISABLED_MESSAGE));
  }

  if (Platform.OS === 'ios') {
    const AppleAuthentication = await loadNativeModule<AppleAuthenticationModule>(() =>
      import('expo-apple-authentication'),
    );
    const Crypto = await loadNativeModule<CryptoModule>(() => import('expo-crypto'));
    if (!AppleAuthentication || !Crypto) {
      return fail(appError('oauth_unavailable', SOCIAL_CLIENT_STALE_MESSAGE));
    }

    const available = await AppleAuthentication.isAvailableAsync().catch(() => false);
    if (available) {
      try {
        const rawNonce = Crypto.randomUUID();
        const hashedNonce = await Crypto.digestStringAsync(
          Crypto.CryptoDigestAlgorithm.SHA256,
          rawNonce,
        );
        const credential = await AppleAuthentication.signInAsync({
          requestedScopes: [
            AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
            AppleAuthentication.AppleAuthenticationScope.EMAIL,
          ],
          nonce: hashedNonce,
        });

        if (!credential.identityToken) {
          return fail(appError('oauth_unavailable', OAUTH_SESSION_MESSAGE));
        }

        const { data, error } = await supabase.auth.signInWithIdToken({
          provider: 'apple',
          token: credential.identityToken,
          nonce: rawNonce,
        });

        if (error) {
          return providerFailure(error);
        }
        if (!data.session) {
          return fail(appError('oauth_unavailable', OAUTH_SESSION_MESSAGE));
        }

        // Apple ad-soyadi yalnizca ilk yetkilendirmede dondurur. Profil
        // tamamlama adiminda on doldurabilmek icin metadata'ya yazilir.
        const firstName = credential.fullName?.givenName?.trim();
        const lastName = credential.fullName?.familyName?.trim();
        if (firstName || lastName) {
          await supabase.auth.updateUser({
            data: {
              ...(firstName ? { first_name: firstName } : {}),
              ...(lastName ? { last_name: lastName } : {}),
            },
          });
        }

        return ok(data.session);
      } catch (error) {
        if (isAppleCancellation(error)) {
          return fail(appError('oauth_cancelled'));
        }
        return fail(appError('oauth_unavailable', OAUTH_SESSION_MESSAGE));
      }
    }
  }

  return signInWithOAuthBrowser('apple');
}

export async function signInWithGoogle(): Promise<Result<Session>> {
  if (!env.enableSocialAuth) {
    return fail(appError('oauth_unavailable', SOCIAL_DISABLED_MESSAGE));
  }
  return signInWithOAuthBrowser('google');
}

export async function getCurrentSession(): Promise<Session | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    return null;
  }
  return data.session;
}

export type SignUpMetadata = {
  username: string | null;
  firstName: string | null;
  lastName: string | null;
};

/**
 * Registration metadata captured at sign-up. Apple only returns the name on the
 * first authorization, so it is read from the stored user metadata afterwards.
 */
export async function getSignUpMetadata(): Promise<SignUpMetadata> {
  const { data, error } = await supabase.auth.getUser();
  const metadata = (!error && data.user?.user_metadata) || {};

  const read = (key: string): string | null => {
    const value = metadata[key];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  };

  return {
    username: read('username')?.toLowerCase() ?? null,
    firstName: read('first_name'),
    lastName: read('last_name'),
  };
}

export type { AppError };
