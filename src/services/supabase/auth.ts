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
const APPLE_NOT_CONFIGURED_MESSAGE =
  'Apple ile giriş henüz Apple Developer tarafında hazır değil. Services ID ve dönüş adresi tanımlandığında otomatik etkinleşir. E-posta ile devam edebilirsin.';

/**
 * Supabase PKCE akışının uygulamaya döneceği adres.
 *
 * `app.config.ts` içindeki `scheme` ile birebir aynı olmalı ve Supabase'in
 * yönlendirme izin listesinde (`trabzone://auth/callback`) bulunmalıdır.
 * `Linking.createURL` geliştirme derlemelerinde sunucu adresini araya
 * ekleyebildiği için sabit şema kullanılır.
 */
const AUTH_REDIRECT_URL = 'trabzone://auth/callback';

type AppleAuthenticationModule = typeof import('expo-apple-authentication');
type CryptoModule = typeof import('expo-crypto');
type GoogleSigninModule = typeof import('@react-native-google-signin/google-signin');
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

/**
 * Yönlendirme adresinden parametre okur.
 *
 * React Native'in `URL` polyfill'i her sürümde `searchParams` sunmadığı için
 * basit bir regex kullanılır; değer hem sorgu hem parça (hash) kısmından gelir.
 */
function readUrlParam(url: string, key: string): string | null {
  const match = new RegExp(`[?&#]${key}=([^&#]*)`).exec(url);
  const value = match?.[1];
  if (value === undefined) {
    return null;
  }
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return null;
  }
}

/**
 * Tarayıcı tabanlı (PKCE) OAuth oturumu açar ve dönen adresi verir.
 *
 * iOS'ta `ASWebAuthenticationSession`, Android'de Custom Tabs kullanılır;
 * uygulama içi gömülü tarayıcı olmadığı için Google/Apple politikalarına
 * uygundur.
 */
async function openOAuthBrowser(url: string): Promise<Result<string>> {
  const WebBrowser = await loadNativeModule<WebBrowserModule>(() => import('expo-web-browser'));
  if (!WebBrowser) {
    return fail(appError('oauth_unavailable', SOCIAL_CLIENT_STALE_MESSAGE));
  }

  try {
    const result = await WebBrowser.openAuthSessionAsync(url, AUTH_REDIRECT_URL);
    if (result.type !== 'success') {
      return fail(appError('oauth_cancelled'));
    }
    return ok(result.url);
  } catch {
    return fail(appError('oauth_unavailable', OAUTH_SESSION_MESSAGE));
  }
}

/**
 * Tarayıcıdan dönen yetki kodunu oturuma çevirir.
 *
 * `flowId`, `signInWithOAuth`/`linkIdentity` çağrısının ürettiği PKCE akışını
 * gösterir; aynı anda başka bir akış (ör. şifre sıfırlama) açılmışsa doğru
 * doğrulayıcının kullanılmasını sağlar.
 */
async function completeOAuthCallback(
  callbackUrl: string,
  flowId?: string | null,
): Promise<Result<Session>> {
  const providerError =
    readUrlParam(callbackUrl, 'error_description') ?? readUrlParam(callbackUrl, 'error');
  if (providerError) {
    // Sağlayıcının gerçek mesajı (ör. Apple'ın "invalid_client") kullanıcıya
    // gösterilmez ama geliştirmede loglanır; aksi halde yapılandırma hatası
    // "tekrar dene" mesajının arkasında kayboluyordu.
    if (__DEV__) {
      console.warn('[auth] saglayici hatasi:', providerError, callbackUrl);
    }
    const code =
      readUrlParam(callbackUrl, 'error_code') ?? readUrlParam(callbackUrl, 'error');
    // Supabase, Apple'ın kimlik bilgisi hatasını `error=server_error` +
    // `error_code=unexpected_failure` olarak sarar ve gerçek nedeni yalnızca
    // `error_description` içinde ("Unable to exchange external code") taşır.
    // Bu yüzden açıklama da kontrol edilir.
    if (
      code === 'invalid_client' ||
      code === 'invalid_grant' ||
      /invalid_client|exchange external code/i.test(providerError)
    ) {
      return fail(appError('oauth_unavailable', APPLE_NOT_CONFIGURED_MESSAGE));
    }
    return fail(appError('oauth_unavailable', OAUTH_SESSION_MESSAGE));
  }

  const code = readUrlParam(callbackUrl, 'code');
  if (!code) {
    if (__DEV__) {
      console.warn('[auth] callback adresinde kod yok:', callbackUrl);
    }
    return fail(appError('oauth_unavailable', OAUTH_SESSION_MESSAGE));
  }

  const { data, error } = await supabase.auth.exchangeCodeForSession(
    code,
    flowId ? { flowId } : undefined,
  );
  if (error) {
    if (__DEV__) {
      console.warn('[auth] kod degisimi basarisiz:', error.message, error.status);
    }
    return providerFailure(error);
  }
  if (!data.session) {
    return fail(appError('oauth_unavailable', OAUTH_SESSION_MESSAGE));
  }
  return ok(data.session);
}

/**
 * Tarayıcı tabanlı sosyal giriş.
 *
 * Android'de Apple SDK'sı yoktur; Google için platform istemci kimliği
 * tanımlanmadığında da tek çalışan yol budur. Kimlik anahtarı yerine PKCE
 * yetki kodu kullanıldığı için nonce doğrulaması gerekmez.
 */
async function signInWithOAuthBrowser(provider: SocialProvider): Promise<Result<Session>> {
  const redirectTo = AUTH_REDIRECT_URL;

  // NOT: Buraya bir "sağlayıcı hazır mı" ön isteği konmaz. O istek
  // `/auth/v1/authorize` ucunu çağırıp Apple'ın giriş sayfasını da indirdiği
  // için Apple sayfası açılmadan yarım saniyeden fazla gecikme ekliyordu.
  // Sağlayıcı yapılandırması eksikse hata `completeOAuthCallback` içinde
  // `error_description` olarak geri döner ve aşağıda anlaşılır mesaja çevrilir.

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo,
      ...(provider === 'google' ? { queryParams: { prompt: 'select_account' } } : {}),
    },
  });
  if (error) {
    return providerFailure(error);
  }
  if (!data.url) {
    return fail(appError('oauth_unavailable', OAUTH_SESSION_MESSAGE));
  }

  const opened = await openOAuthBrowser(data.url);
  if (!opened.ok) {
    return opened;
  }
  if (__DEV__) {
    // Donusu adresini logla: saglayici hatasi (error=...), kod eksikligi ya da
    // yanlis sema burada tek bakista gorulur.
    console.warn('[auth] ' + provider + ' donusu:', opened.data);
  }
  return completeOAuthCallback(opened.data, data.flowId);
}

/**
 * Mevcut hesaba tarayıcı (PKCE) akışıyla sosyal kimlik bağlar.
 *
 * `linkIdentity` sağlayıcı adresini sunucudan alır; Apple/Google yapılandırması
 * eksikse hata tarayıcı açılmadan döner.
 */
async function linkWithOAuthBrowser(provider: SocialProvider): Promise<Result<null>> {
  const { data, error } = await supabase.auth.linkIdentity({
    provider,
    options: { redirectTo: AUTH_REDIRECT_URL },
  });
  if (error) {
    return linkingFailure(error);
  }
  if (!data?.url) {
    return fail(appError('oauth_unavailable', OAUTH_SESSION_MESSAGE));
  }

  const opened = await openOAuthBrowser(data.url);
  if (!opened.ok) {
    return fail<null>(opened.error);
  }
  const completed = await completeOAuthCallback(opened.data, data.flowId);
  return completed.ok ? ok(null) : fail<null>(completed.error);
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
 * iOS'un native Apple oturum modülünün **bu derlemede** gerçekten kullanılıp
 * kullanılamayacağını söyler.
 *
 * İki koşul birden gerekir:
 *  1. `EXPO_PUBLIC_ENABLE_APPLE_NATIVE_LOGIN=true` (yani derleme
 *     `com.apple.developer.applesignin` yetkisiyle ve yetkiyi içeren bir
 *     provisioning profile ile imzalanmış olmalı),
 *  2. `ExpoAppleAuthentication` native modülü ikili dosyada bulunmalı.
 *
 * `expo-apple-authentication` bağımlılıkta olsa bile native modül
 * `autolinking` listesinden çıkarılmış ya da config plugin hiç eklenmemiş bir
 * derlemede yer almaz. Bu durumda paket hata fırlatmaz: sahte bir modül
 * döndürür ve `isAvailableAsync()` sessizce `false` olur (bkz.
 * expo-apple-authentication/ExpoAppleAuthentication). Bu `false` değeri "cihaz
 * desteklemiyor" demek değildir; yalnızca modülün ikili dosyada olmadığını
 * gösterir. Çağıranlar bu ayrımı kullanarak tarayıcı (PKCE) akışına düşer.
 */
async function isAppleNativeAvailable(): Promise<boolean> {
  // Native akış kapalıyken (varsayılan) Apple girişi tarayıcı akışındadır:
  // bu derlemede `com.apple.developer.applesignin` yetkisi yok, bu yüzden
  // `signInAsync` çağrılırsa hata verir. Doğrudan false dönülür.
  if (Platform.OS !== 'ios' || !env.enableNativeAppleLogin) {
    return false;
  }
  const AppleAuthentication = await loadNativeModule<AppleAuthenticationModule>(() =>
    import('expo-apple-authentication'),
  );
  if (!AppleAuthentication) {
    return false;
  }
  return AppleAuthentication.isAvailableAsync().catch(() => false);
}

/**
 * iOS'un native Apple oturumunu açar.
 *
 * Apple kimlik anahtarı (identity token) nonce ile Supabase tarafında
 * doğrulanır; arada tarayıcı ya da web görünümü yoktur. Apple, Android için
 * native bir SDK sunmadığı için bu yöntem yalnızca iOS'ta çalışır.
 *
 * Çağırmadan önce `isAppleNativeAvailable()` ile modülün derlemede olduğu
 * doğrulanmalıdır.
 */
async function requestAppleCredential(): Promise<Result<AppleCredential>> {
  if (Platform.OS !== 'ios') {
    return fail(appError('oauth_unavailable', SOCIAL_CLIENT_STALE_MESSAGE));
  }

  const AppleAuthentication = await loadNativeModule<AppleAuthenticationModule>(() =>
    import('expo-apple-authentication'),
  );
  const Crypto = await loadNativeModule<CryptoModule>(() => import('expo-crypto'));
  if (!AppleAuthentication || !Crypto) {
    return fail(appError('oauth_unavailable', SOCIAL_CLIENT_STALE_MESSAGE));
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

/**
 * Apple ile giriş.
 *
 * iOS'ta sistemin native oturum sayfası kullanılır. Apple, Android için native
 * bir SDK sunmadığı için Android'de aynı yetkilendirme tarayıcıda PKCE akışıyla
 * yürütülür; sunucuda Apple web yapılandırması (Services ID + anahtar) hazır
 * olduğunda ek derleme gerekmeden etkinleşir.
 *
 * Native modül eski bir derlemede yer almıyorsa (`isAppleNativeAvailable`
 * false) iOS'ta da tarayıcı akışı kullanılır. Bu sayede kullanıcı, yeni derleme
 * yüklemek zorunda kalmadan Apple ile giriş yapabilir.
 */
export async function signInWithApple(): Promise<Result<Session>> {
  if (!env.enableSocialAuth) {
    return fail(appError('oauth_unavailable', SOCIAL_DISABLED_MESSAGE));
  }

  if (!(await isAppleNativeAvailable())) {
    return signInWithOAuthBrowser('apple');
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

/** Google kimlik anahtarını Supabase oturumuna çevirir (native akış). */
async function signInWithNativeGoogle(): Promise<Result<Session>> {
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

/**
 * Google ile giriş.
 *
 * Varsayılan yol tarayıcıdır (PKCE): Android'de imzalama parmak izine bağlı
 * bir OAuth istemcisi, iOS'ta da ayrı bir istemci kimliği gerektirmez. Native
 * hesap seçici yalnızca `EXPO_PUBLIC_GOOGLE_NATIVE_LOGIN=true` iken ve platform
 * istemci kimlikleri tanımlıyken denenir; yapılandırma hatasında tarayıcıya
 * düşülür.
 */
export async function signInWithGoogle(): Promise<Result<Session>> {
  if (!env.enableSocialAuth) {
    return fail(appError('oauth_unavailable', SOCIAL_DISABLED_MESSAGE));
  }

  if (env.enableNativeGoogleLogin && env.googleWebClientId) {
    const native = await signInWithNativeGoogle();
    // İptal dışındaki yapılandırma hatalarında tarayıcı akışı kullanılır.
    if (native.ok || native.error.code !== 'oauth_unavailable') {
      return native;
    }
  }

  return signInWithOAuthBrowser('google');
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
 * iOS'ta Apple native oturumla, Android'de ise her iki sağlayıcı tarayıcı
 * (PKCE) akışıyla bağlanır. Native Apple modülü derlemede yoksa girişte olduğu
 * gibi tarayıcı akışına düşülür. Başka bir hesabın kimliği dönerse Supabase
 * isteği reddeder.
 */
export async function linkSocialIdentity(provider: SocialProvider): Promise<Result<null>> {
  if (!env.enableSocialAuth) {
    return fail(appError('oauth_unavailable', SOCIAL_DISABLED_MESSAGE));
  }

  if (provider === 'apple') {
    if (!(await isAppleNativeAvailable())) {
      return linkWithOAuthBrowser('apple');
    }
    const credential = await requestAppleCredential();
    if (!credential.ok) {
      return fail<null>(credential.error);
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

  if (env.enableNativeGoogleLogin && env.googleWebClientId) {
    const token = await requestGoogleIdToken();
    if (token.ok) {
      const { error } = await supabase.auth.linkIdentity({
        provider: 'google',
        token: token.data,
      });
      if (!error) {
        return ok(null);
      }
      if (error.code !== 'provider_disabled' && !/nonce/i.test(error.message)) {
        return linkingFailure(error);
      }
    }
  }

  return linkWithOAuthBrowser('google');
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
  // Yerel oturum okunur: `/auth/v1/user` isteği, giriş sonrası yönlendirmeyi
  // gereksiz bir gidiş-dönüş kadar geciktiriyordu. Metadata zaten oturum
  // jetonuyla birlikte gelir.
  let metadata: Record<string, unknown> = {};
  const { data: sessionData } = await supabase.auth.getSession();
  const localUser = sessionData.session?.user;
  if (localUser) {
    metadata = (localUser.user_metadata ?? {}) as Record<string, unknown>;
  } else {
    const { data, error } = await supabase.auth.getUser();
    if (!error && data.user?.user_metadata) {
      metadata = data.user.user_metadata as Record<string, unknown>;
    }
  }

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
