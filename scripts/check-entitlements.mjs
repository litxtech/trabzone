/**
 * Derleme öncesi entitlement kontrolü.
 *
 * App Store imzalama, `com.apple.developer.applesignin` yetkisini provisioning
 * profile'da istemiyorsa arşiv adımı başarısız olur:
 *   "Provisioning Profile ... does not support the Sign In with Apple capability"
 *
 * Bu betik `expo config --type introspect` çıktısını okuyup Apple ile giriş
 * yetkisinin yalnızca sosyal giriş açıkken üretildiğini doğrular. EAS build
 * loglarında sürpriz imzalama hatası yerine burada erken uyarı verir.
 *
 * Kullanım: npm run check:entitlements
 */
import { execFileSync } from 'node:child_process';

const socialAuthEnabled = process.env.EXPO_PUBLIC_ENABLE_SOCIAL_AUTH === 'true';
/**
 * Apple girişi varsayılan olarak tarayıcı (PKCE) akışıyla yapılır ve yetki
 * gerektirmez. Native akış yalnızca bu bayrak açıkken beklenir.
 */
const appleNativeEnabled =
  socialAuthEnabled && process.env.EXPO_PUBLIC_ENABLE_APPLE_NATIVE_LOGIN === 'true';

/** Expo CLI bazı ortamlarda JSON'un önüne/sonuna uyarı yazabilir; güvenli ayrıştır. */
function parseJsonOutput(output) {
  const start = output.indexOf('{');
  const end = output.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new Error('expo config çıktısında JSON bulunamadı');
  }
  return JSON.parse(output.slice(start, end + 1));
}

let raw;
try {
  raw = execFileSync('npx', ['expo', 'config', '--type', 'introspect', '--json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });
} catch (cause) {
  console.error('expo config okunamadı:', cause instanceof Error ? cause.message : cause);
  process.exit(1);
}

const config = parseJsonOutput(raw);
const entitlements = config?.mods?.ios?.entitlements ?? config?._internal?.modResults?.ios?.entitlements ?? {};
const hasAppleSignIn = Object.prototype.hasOwnProperty.call(entitlements, 'com.apple.developer.applesignin');

if (hasAppleSignIn && !appleNativeEnabled) {
  console.error(
    'HATA: Apple ile giriş yetkisi (com.apple.developer.applesignin) üretilmiş ama ' +
      'native Apple girişi kapalı. Bu durumda Ad Hoc/App Store profili yetkiyi ' +
      'içermediği için iOS arşivi başarısız olur.',
  );
  console.error(
    'Çözüm: app.config.ts içinde plugin yalnızca APPLE_NATIVE_SIGNIN_ENABLED iken ' +
      'eklenmeli; native akış isteniyorsa EXPO_PUBLIC_ENABLE_APPLE_NATIVE_LOGIN=true ' +
      'yapıp App ID\'de "Sign in with Apple" capability açılmalı ve profil yenilenmeli.',
  );
  process.exit(1);
}

if (appleNativeEnabled && !hasAppleSignIn) {
  console.error(
    'HATA: EXPO_PUBLIC_ENABLE_APPLE_NATIVE_LOGIN açık ama Apple ile giriş yetkisi ' +
      'üretilmemiş. Native Apple girişi çalışmaz; package.json > expo.autolinking.ios.exclude ' +
      'listesinden expo-apple-authentication çıkarılmalı ve profil yeniden üretilmeli.',
  );
  process.exit(1);
}

/**
 * Push (APNs) yetkisi. `aps-environment` yoksa uygulama derlenir ama hiçbir
 * bildirim cihaza ulaşmaz; bunu arşiv sonrası fark etmek yerine burada
 * durduruyoruz. Değer, expo-notifications config plugin `mode` seçeneğinden
 * gelir (development = sandbox, production = TestFlight/App Store).
 */
const apsEnvironment = entitlements['aps-environment'];
if (!apsEnvironment) {
  console.error(
    'HATA: iOS push yetkisi (aps-environment) üretilmemiş. expo-notifications config plugin ' +
      'app.config.ts içinde etkin olmalı ve Expo/EAS projesinde APNs anahtarı yüklü olmalı.',
  );
  process.exit(1);
}

const profile = process.env.EAS_BUILD_PROFILE ?? '';
if ((profile === 'production' || profile === 'preview') && apsEnvironment !== 'production') {
  console.error(
    `HATA: ${profile} profili için aps-environment "${apsEnvironment}" üretilmiş; ` +
      'TestFlight/App Store dağıtımı "production" bekler. app.config.ts içindeki mode seçeneğini kontrol edin.',
  );
  process.exit(1);
}

console.log(
  hasAppleSignIn
    ? 'OK: Apple ile giriş yetkisi üretildi (native akış açık). Profilin yetkiyi içerdiğinden emin olun.'
    : 'OK: Apple ile giriş yetkisi üretilmedi (tarayıcı PKCE akışı) — mevcut imzalama profiliyle uyumlu.',
);
console.log(`OK: push yetkisi üretildi (aps-environment: ${apsEnvironment}).`);
