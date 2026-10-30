import type { AuthError, Session } from '@supabase/supabase-js';
import { Platform } from 'react-native';

import { env } from '@/config/env';
import { appError, mapAuthError, type AppError } from '@/services/errors';
import { fail, ok, type Result } from '@/utils/result';

import { supabase } from './client';
import { linkAppleIdentity } from './apple-identity';

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
  /** Kayıt formunda toplanan beyanlar; doğrulama sonrası uygulanır. */
  birthDate?: string | null;
  /**
   * Kayıt ekranındaki tek onay kutusu. `true` ise yayındaki tüm sözleşme ve
   * politikalar kabul edilmiş sayılır ve her belge için kabul kaydı yazılır.
   */
  acceptedTerms?: boolean;
  marketingOptIn?: boolean;
  analyticsOptIn?: boolean;
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
        ...(payload.birthDate ? { birth_date: payload.birthDate } : {}),
        ...(payload.acceptedTerms ? { accepted_terms: true } : {}),
        ...(payload.marketingOptIn ? { marketing_opt_in: true } : {}),
        ...(payload.analyticsOptIn ? { analytics_opt_in: true } : {}),
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
const GOOGLE_NOT_CONFIGURED_MESSAGE =
  'Google ile giriş henüz yapılandırılmadı. E-posta ile devam edebilirsin.';
const APPLE_IOS_ONLY_MESSAGE =
  'Apple ile giriş iPhone ve iPad uygulamasında kullanılabilir. E-posta ile devam edebilirsin.';

type AppleAuthenticationModule = typeof import('expo-apple-authentication');
type CryptoModule = typeof import('expo-crypto');
type GoogleSigninModule = typeof import('@react-native-google-signin/google-signin');

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

/**
 * Google ile giriş tarayıcıya çıkmadan, işletim sisteminin native Google
 * oturumuyla yapılır.
 *
 * `signInWithIdToken` akışı PKCE yönlendirmesi gerektirmez; bu sayede ne
 * Custom Tab ne de Safari açılır. Google tarafında `webClientId` (id token
 * audience) ve platforma özel istemci kimlikleri tanımlı olmalıdır.
 */
function googleClientIds(): { webClientId: string; iosClientId?: string } | null {
  if (!env.googleWebClientId) {
    return null;
  }
  return {
    webClientId: env.googleWebClientId,
    ...(env.googleIosClientId ? { iosClientId: env.googleIosClientId } : {}),
  };
}

/** Google oturumundaki iptal/hata kodunu tek yerden okur. */
function googleErrorCode(error: unknown): string | null {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : null;
  }
  return null;
}

function googleFailure(error: unknown): Result<never> {
  const code = googleErrorCode(error);
  if (code === 'SIGN_IN_CANCELLED' || code === '12501') {
    return fail(appError('oauth_cancelled'));
  }
  if (code === 'PLAY_SERVICES_NOT_AVAILABLE') {
    return fail(
      appError(
        'oauth_unavailable',
        'Google Play Hizmetleri güncel değil. Güncelleyip tekrar dene.',
      ),
    );
  }
  if (code === 'DEVELOPER_ERROR' || code === '10') {
    return fail(
      appError(
        'oauth_unavailable',
        'Google girişi bu derleme için yapılandırılmamış. E-posta ile devam edebilirsin.',
      ),
    );
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

type AppleCredential = {
  identityToken: string;
  nonce: string;
  /**
   * Apple yetki kodu. Yalnızca ilk yetkilendirmede gelir ve tek kullanımlıktır;
   * hesap silmede jetonu iptal edebilmek için yenileme jetonuna çevrilip
   * `apple-token` edge function'ında saklanır.
   */
  authorizationCode: string | null;
  firstName: string | null;
  lastName: string | null;
};

/**
 * iOS'un native Apple oturumunu açar.
 *
 * Apple kimlik anahtarı (identity token) nonce ile Supabase tarafında
 * doğrulanır; arada tarayıcı ya da web görünümü yoktur. Apple, Android için
 * native bir SDK sunmadığı için bu yöntem yalnızca iOS'ta çalışır.
 */
async function requestAppleCredential(): Promise<Result<AppleCredential>> {
  if (Platform.OS !== 'ios') {
    return fail(appError('oauth_unavailable', APPLE_IOS_ONLY_MESSAGE));
  }

  const AppleAuthentication = await loadNativeModule<AppleAuthenticationModule>(() =>
    import('expo-apple-authentication'),
  );
  const Crypto = await loadNativeModule<CryptoModule>(() => import('expo-crypto'));
  if (!AppleAuthentication || !Crypto) {
    return fail(appError('oauth_unavailable', SOCIAL_CLIENT_STALE_MESSAGE));
  }

  const available = await AppleAuthentication.isAvailableAsync().catch(() => false);
  if (!available) {
    return fail(appError('oauth_unavailable', APPLE_IOS_ONLY_MESSAGE));
  }

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

    return ok({
      identityToken: credential.identityToken,
      nonce: rawNonce,
      authorizationCode: credential.authorizationCode ?? null,
      firstName: credential.fullName?.givenName?.trim() || null,
      lastName: credential.fullName?.familyName?.trim() || null,
    });
  } catch (error) {
    return isAppleCancellation(error)
      ? fail(appError('oauth_cancelled'))
      : fail(appError('oauth_unavailable', OAUTH_SESSION_MESSAGE));
  }
}

/**
 * Google kimlik anahtarını native oturumdan alır.
 *
 * Google, gömülü web görünümlerinde OAuth'u reddeder; bu yüzden tarayıcı
 * yerine platformun Google oturum modülü kullanılır ve dönen id token
 * Supabase'e doğrudan iletilir.
 */
async function requestGoogleIdToken(): Promise<Result<string>> {
  if (Platform.OS === 'web') {
    return fail(
      appError(
        'oauth_unavailable',
        'Google ile giriş mobil uygulamada kullanılabilir. Tarayıcıda e-posta ile devam edebilirsin.',
      ),
    );
  }

  const clientIds = googleClientIds();
  if (!clientIds) {
    return fail(appError('oauth_unavailable', GOOGLE_NOT_CONFIGURED_MESSAGE));
  }

  const Google = await loadNativeModule<GoogleSigninModule>(() =>
    import('@react-native-google-signin/google-signin'),
  );
  if (!Google) {
    return fail(appError('oauth_unavailable', SOCIAL_CLIENT_STALE_MESSAGE));
  }

  try {
    Google.GoogleSignin.configure({
      webClientId: clientIds.webClientId,
      ...(clientIds.iosClientId ? { iosClientId: clientIds.iosClientId } : {}),
      offlineAccess: false,
    });

    if (Platform.OS === 'android') {
      await Google.GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    }

    const response = await Google.GoogleSignin.signIn();
    if (response.type !== 'success') {
      return fail(appError('oauth_cancelled'));
    }

    const idToken = response.data.idToken;
    if (!idToken) {
      return fail(appError('oauth_unavailable', OAUTH_SESSION_MESSAGE));
    }
    return ok(idToken);
  } catch (error) {
    return googleFailure(error);
  }
}

/** Apple yetki kodu varsa yenileme jetonunu arka planda saklar. */
function persistAppleToken(code: string | null): void {
  if (!code) {
    return;
  }
  // Giriş akışını yavaşlatmamak için beklenmez; hata oturumu etkilemez.
  void linkAppleIdentity(code);
}

/** Apple ile giriş; iOS'un native oturum sayfasında, uygulama içinde açılır. */
export async function signInWithApple(): Promise<Result<Session>> {
  if (!env.enableSocialAuth) {
    return fail(appError('oauth_unavailable', SOCIAL_DISABLED_MESSAGE));
  }

  const credential = await requestAppleCredential();
  if (!credential.ok) {
    return credential;
  }

  const { identityToken, nonce, authorizationCode, firstName, lastName } = credential.data;
  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: identityToken,
    nonce,
  });

  if (error) {
    return providerFailure(error);
  }
  if (!data.session) {
    return fail(appError('oauth_unavailable', OAUTH_SESSION_MESSAGE));
  }

  // Hesap silmede Apple jetonunu iptal edebilmek için yetki kodu saklanır.
  persistAppleToken(authorizationCode);

  // Apple ad-soyadi yalnizca ilk yetkilendirmede dondurur. Profil tamamlama
  // adiminda on doldurabilmek icin metadata'ya yazilir.
  if (firstName || lastName) {
    await supabase.auth.updateUser({
      data: {
        ...(firstName ? { first_name: firstName } : {}),
        ...(lastName ? { last_name: lastName } : {}),
      },
    });
  }

  return ok(data.session);
}

/** Google ile giriş; native hesap seçici ile, tarayıcı açılmadan. */
export async function signInWithGoogle(): Promise<Result<Session>> {
  if (!env.enableSocialAuth) {
    return fail(appError('oauth_unavailable', SOCIAL_DISABLED_MESSAGE));
  }

  const token = await requestGoogleIdToken();
  if (!token.ok) {
    return token;
  }

  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: 'google',
    token: token.data,
  });

  if (error) {
    return providerFailure(error);
  }
  if (!data.session) {
    return fail(appError('oauth_unavailable', OAUTH_SESSION_MESSAGE));
  }
  return ok(data.session);
}

/** Proje ayarinda hesap bağlama kapalıysa anlaşılır mesaj üretir. */
function linkingFailure(error: AuthError): Result<never> {
  if (error.message.toLowerCase().includes('manual linking')) {
    return fail(
      appError('forbidden', 'Hesap bağlama, proje ayarlarında etkin değil. Destek ile iletişime geç.'),
    );
  }
  return providerFailure(error);
}

/**
 * Mevcut hesaba sosyal kimlik bağlar.
 *
 * Oturum açma akışıyla aynı native modüller kullanılır; kullanıcı tarayıcıya
 * çıkmaz. Başka bir hesabın anahtarı dönerse Supabase isteği reddeder.
 */
export async function linkSocialIdentity(provider: SocialProvider): Promise<Result<null>> {
  if (!env.enableSocialAuth) {
    return fail(appError('oauth_unavailable', SOCIAL_DISABLED_MESSAGE));
  }

  if (provider === 'apple') {
    const credential = await requestAppleCredential();
    if (!credential.ok) {
      return credential;
    }
    const { error } = await supabase.auth.linkIdentity({
      provider: 'apple',
      token: credential.data.identityToken,
      nonce: credential.data.nonce,
    });
    if (error) {
      return linkingFailure(error);
    }
    persistAppleToken(credential.data.authorizationCode);
    return ok(null);
  }

  const token = await requestGoogleIdToken();
  if (!token.ok) {
    return token;
  }
  const { error } = await supabase.auth.linkIdentity({
    provider: 'google',
    token: token.data,
  });
  return error ? linkingFailure(error) : ok(null);
}

export async function getCurrentSession(): Promise<Session | null> {
  const readStored = async (): Promise<Session | null> => {
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) {
        return null;
      }
      return data.session;
    } catch {
      // Ağ hatası oturumu silmez: depodaki kayıt bir sonraki açılışta okunur.
      return null;
    }
  };

  const session = await readStored();
  if (!session) {
    return null;
  }

  // Süresi dolmuş/yakında dolacak oturumda yenileme anahtarı varsa sessizce
  // yenile. Kullanıcı uygulamayı kapatıp açtığında da oturum açık kalır;
  // yalnızca "Çıkış Yap" oturumu sonlandırır.
  const expiresAt = (session.expires_at ?? 0) * 1000;
  if (expiresAt > 0 && expiresAt - Date.now() < 120_000) {
    try {
      const { data } = await supabase.auth.refreshSession();
      if (data.session) {
        return data.session;
      }
    } catch {
      // Yenileme başarısızsa süresi dolmuş oturum yerine mevcut oturum döner;
      // AuthGate kullanıcıyı çıkışa zorlamaz, ilk istekte yeniden dener.
      return session;
    }
  }

  return session;
}

export type SignUpMetadata = {
  username: string | null;
  firstName: string | null;
  lastName: string | null;
};

/**
 * Registration metadata captured at sign-up. Apple only returns the name on the
 * first authorization, so it is read from the stored user metadata afterwards.
 *
 * Google/Apple sağlayıcıları adı `given_name`/`family_name` ya da tek parça
 * `full_name` olarak yazabildiği için bu anahtarlar da okunur; böylece ad-soyad
 * kullanıcıya ikinci kez sorulmaz.
 */
export async function getSignUpMetadata(): Promise<SignUpMetadata> {
  const { data, error } = await supabase.auth.getUser();
  const metadata = (!error && data.user?.user_metadata) || {};

  const read = (key: string): string | null => {
    const value = metadata[key];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  };

  const fullName = read('full_name') ?? read('name');
  const fullNameParts = fullName ? fullName.split(/\s+/) : [];
  const fallbackFirst = fullNameParts.length > 0 ? fullNameParts[0] : null;
  const fallbackLast = fullNameParts.length > 1 ? fullNameParts.slice(1).join(' ') : null;

  return {
    username: read('username')?.toLowerCase() ?? null,
    firstName: read('first_name') ?? read('given_name') ?? fallbackFirst ?? null,
    lastName: read('last_name') ?? read('family_name') ?? fallbackLast ?? null,
  };
}

export type { AppError };
