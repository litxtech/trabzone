import type { ConfigContext, ExpoConfig } from 'expo/config';

const APP_SCHEME = 'trabzone';
const BUNDLE_ID = 'com.litxtech.trabzone';

/** Sosyal giriş ana anahtarı; kapalıyken hiçbir sağlayıcı butonu gösterilmez. */
const SOCIAL_AUTH_ENABLED = process.env.EXPO_PUBLIC_ENABLE_SOCIAL_AUTH === 'true';

/**
 * iOS'ta Apple girişinin native (tarayıcısız) akışı.
 *
 * `com.apple.developer.applesignin` yetkisi, Apple Developer portalındaki
 * App ID'de "Sign in with Apple" açılmadan ve provisioning profile yeniden
 * üretilmeden **imzalanamaz**; profile yetkiyi içermezse arşiv adımı
 * başarısız olur:
 *   "Provisioning profile ... doesn't include the Sign In with Apple capability"
 *
 * Bu yüzden varsayılan **kapalı**. Kapalıyken Apple girişi tarayıcı tabanlı
 * PKCE akışıyla yapılır (Apple Developer'da yalnızca Services ID + Return URL
 * gerekir) ve yetki/config plugin hiç eklenmez, böylece mevcut profille
 * derleme uyumlu kalır. Uygulama tarafındaki karşılığı:
 * src/config/env.ts > enableNativeAppleLogin.
 *
 * ÖNEMLİ: `expo-apple-authentication` paketi kurulu olduğu sürece Expo onun
 * config plugin'ini **otomatik** uygular ve yetkiyi koşulsuz ekler (bkz.
 * @expo/prebuild-config > withVersionedExpoSDKPlugins). Tek geçerli çıkış
 * paketi autolinking'den dışlamaktır; `shouldSkipAutoPlugin` hem native modülü
 * hem de otomatik plugin'i atlar (package.json > expo.autolinking.ios.exclude).
 *
 * Native akışa geçmek için üçü birlikte yapılır:
 *   1. App ID'de "Sign in with Apple" capability açılır,
 *   2. package.json > expo.autolinking.ios.exclude listesinden bu paket çıkarılır
 *      ve provisioning profile yenilenir,
 *   3. `EXPO_PUBLIC_ENABLE_APPLE_NATIVE_LOGIN=true` ile derleme alınır.
 */
const APPLE_NATIVE_SIGNIN_ENABLED =
  SOCIAL_AUTH_ENABLED && process.env.EXPO_PUBLIC_ENABLE_APPLE_NATIVE_LOGIN === 'true';

/**
 * Google ile native giriş iOS'ta ters çevrilmiş istemci kimliğini URL şeması
 * olarak Info.plist'e yazar. Kimlik tanımlı değilse config plugin hiç
 * eklenmez; Google girişi tarayıcı tabanlı PKCE akışıyla çalışmaya devam eder
 * (bkz. SocialAuthButtons / EXPO_PUBLIC_GOOGLE_NATIVE_LOGIN).
 */
const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim() ?? '';
const GOOGLE_IOS_URL_SCHEME = GOOGLE_IOS_CLIENT_ID
  ? GOOGLE_IOS_CLIENT_ID.startsWith('com.googleusercontent.apps.')
    ? GOOGLE_IOS_CLIENT_ID
    : `com.googleusercontent.apps.${GOOGLE_IOS_CLIENT_ID.replace(/\.apps\.googleusercontent\.com$/, '')}`
  : null;

/**
 * Paylaşılan https bağlantılarının doğrudan uygulamada açılması (universal
 * links / Android App Links).
 *
 * Varsayılan olarak **kapalı**: iOS'ta `associatedDomains` yetkisi App ID'de
 * açılmadan ve provisioning profile yenilenmeden arşiv imzalanamaz. Bu bayrak
 * açılmadan da paylaşım çalışır; paylaşım sayfası `trabzone://` şemasını dener
 * ve uygulama yüklüyse ilgili içeriği açar. Apple Developer portalında
 * "Associated Domains" yetkisi hazır olduğunda bu bayrağı true yapmak yeterli.
 */
const UNIVERSAL_LINKS_ENABLED = process.env.EXPO_PUBLIC_ENABLE_UNIVERSAL_LINKS === 'true';
const LINK_HOSTS = ['www.trabzoneapp.com', 'trabzoneapp.com'];

/**
 * APNs ortamı. TestFlight/App Store dağıtımı `production`, development build
 * ve simülatör `development` (sandbox) APNs kullanır. EAS build profilinden
 * türetilir; yerel derlemelerde sandbox kalır.
 */
const EAS_BUILD_PROFILE = process.env.EAS_BUILD_PROFILE ?? '';
const NOTIFICATIONS_MODE: 'development' | 'production' =
  EAS_BUILD_PROFILE === 'production' || EAS_BUILD_PROFILE === 'preview' ? 'production' : 'development';

/**
 * Firebase Android yapılandırması (FCM).
 *
 * Android'de `getExpoPushTokenAsync()` FirebaseApp üzerinden FCM token'ı ister;
 * `google-services.json` derlemeye girmezse `FirebaseApp` başlatılamaz ve token
 * alınamaz ("Default FirebaseApp is not initialized"). Token olmayınca sunucu
 * hiçbir push gönderemez — uygulama kapalıyken/arkada hiçbir bildirim gelmez.
 *
 * Dosya istemci tarafı yapılandırmadır (gizli anahtar taşımaz) ve APK'nın
 * içinde zaten bulunur; bu yüzden depoda tutulur ki EAS derleme arşivine
 * girebilsin (.gitignore: `!assets/google-services.json`). Yol
 * `GOOGLE_SERVICES_JSON` ile değiştirilebilir. Dosya yoksa prebuild hata verir;
 * bu, push'suz bir APK'yı sessizce yayınlamaktan iyidir.
 * `npm run push:doctor` eksiği ayrıntılı raporlar.
 */
const GOOGLE_SERVICES_FILE =
  process.env.GOOGLE_SERVICES_JSON?.trim() || './assets/google-services.json';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Trabzone',
  slug: 'trabzone',
  owner: 'trabzone',
  version: '1.0.0',
  orientation: 'portrait',
  scheme: APP_SCHEME,
  userInterfaceStyle: 'automatic',
  icon: './assets/brand/icons/icon.png',
  assetBundlePatterns: ['**/*'],
  ios: {
    bundleIdentifier: BUNDLE_ID,
    supportsTablet: false,
    usesAppleSignIn: APPLE_NATIVE_SIGNIN_ENABLED,
    // Yalnızca ilgili yetki hazır olduğunda eklenir (yukarıdaki nota bakın).
    ...(UNIVERSAL_LINKS_ENABLED
      ? { associatedDomains: LINK_HOSTS.map((host) => `applinks:${host}`) }
      : {}),
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      NSCameraUsageDescription:
        'Trabzone, profil fotoğrafı, gönderi ve görüntülü arama için kameranı kullanır.',
      NSMicrophoneUsageDescription:
        'Trabzone, sesli mesaj ve sesli/görüntülü arama için mikrofonunu kullanır.',
      NSPhotoLibraryUsageDescription:
        'Trabzone, paylaşmak istediğin fotoğraf ve videoları seçebilmen için galerine erişir.',
      NSPhotoLibraryAddUsageDescription:
        'Trabzone, indirdiğin medyayı galerine kaydedebilmek için izin ister.',
      NSLocationWhenInUseUsageDescription:
        'Trabzone, yakınındaki ilanları ve arkadaş keşfini gösterebilmek için konumunu kullanır.',
      NSContactsUsageDescription:
        'Trabzone, arkadaşlarını bulabilmen için rehberindeki kişileri eşleştirir.',
    },
  },
  android: {
    package: BUNDLE_ID,
    googleServicesFile: GOOGLE_SERVICES_FILE,
    predictiveBackGestureEnabled: true,
    // Paylaşım bağlantıları `/p/*` altında toplanır; diğer web sayfaları
    // tarayıcıda kalır. Etkinleştirmek için ortamda
    // EXPO_PUBLIC_ENABLE_UNIVERSAL_LINKS=true olmalı ve `assetlinks.json`
    // içinde imza parmak izi bulunmalıdır.
    ...(UNIVERSAL_LINKS_ENABLED
      ? {
          intentFilters: [
            {
              action: 'VIEW',
              autoVerify: true,
              data: LINK_HOSTS.flatMap((host) =>
                ['/p', '/eczaneler', '/nobetci-eczaneler', '/deprem'].map((pathPrefix) => ({
                  scheme: 'https',
                  host,
                  pathPrefix,
                })),
              ),
              category: ['BROWSABLE', 'DEFAULT'],
            },
          ],
        }
      : {}),
    adaptiveIcon: {
      foregroundImage: './assets/brand/icons/adaptive-foreground.png',
      backgroundColor: '#0B2A6B',
      monochromeImage: './assets/brand/icons/themed-monochrome.png',
    },
    permissions: [
      'android.permission.CAMERA',
      'android.permission.RECORD_AUDIO',
      'android.permission.ACCESS_COARSE_LOCATION',
      'android.permission.ACCESS_FINE_LOCATION',
    ],
  },
  web: {
    bundler: 'metro',
    output: 'single',
    favicon: './assets/brand/icons/favicon-32.png',
    name: 'Trabzone',
    shortName: 'Trabzone',
    lang: 'tr',
    themeColor: '#0B1220',
    backgroundColor: '#0B1020',
    description:
      "Trabzon'un sosyal keşif, marketplace, emlak, araç ve harita platformu.",
  },
  plugins: [
    'expo-router',
    // Görsel işlem hattı: disk önbelleği ve animated/cross-fade desteği için
    // config plugin gerekli (expo-image 58.0.18+).
    'expo-image',
    // Yetki (entitlement) eklediği için yalnızca native Apple girişi açıkken
    // eklenir; aksi halde arşiv imzalanamaz (bkz. yukarıdaki nota).
    ...(APPLE_NATIVE_SIGNIN_ENABLED ? ['expo-apple-authentication' as const] : []),
    // Google native giriş: tarayıcı yerine sistemin hesap seçicisi açılır.
    ...(SOCIAL_AUTH_ENABLED && GOOGLE_IOS_URL_SCHEME
      ? [
          [
            '@react-native-google-signin/google-signin',
            { iosUrlScheme: GOOGLE_IOS_URL_SCHEME },
          ] as [string, { iosUrlScheme: string }],
        ]
      : []),
    [
      'expo-splash-screen',
      {
        image: './assets/brand/splash/splash-logo.png',
        imageWidth: 168,
        resizeMode: 'contain',
        backgroundColor: '#F4F6FB',
        dark: {
          image: './assets/brand/splash/splash-logo.png',
          backgroundColor: '#0B1220',
        },
      },
    ],
    'expo-secure-store',
    // Standart push bildirimleri (Expo Push). Kritik uyarı yetkisi istenmez.
    // - defaultChannel: sunucudaki push-dispatch kanal kimlikleriyle eşleşmeli
    //   (social / messages / alerts; kaynak: push-registration.ts).
    // - mode: APNs ortamı (production = TestFlight/App Store, development = sandbox).
    [
      'expo-notifications',
      {
        color: '#0B2A6B',
        icon: './assets/brand/icons/notification-icon.png',
        defaultChannel: 'social',
        mode: NOTIFICATIONS_MODE,
        enableBackgroundRemoteNotifications: false,
      },
    ],
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'Trabzone, yolculuk sırasında canlı konum paylaşımı ve güvenlik uyarıları için konumunu kullanır.',
      },
    ],
    [
      // iOS'ta native Apple Maps (MapKit), Android'de native Mapbox kullanılır.
      'expo-maps',
      {
        requestLocationPermission: true,
        locationPermission:
          'Trabzone, Etkileşim Haritası\'nda çevrendeki arkadaşları, yolculukları ve mekânları gösterebilmek için konumunu kullanır.',
      },
    ],
    './plugins/with-mapbox-android',
    // LiveKit (sesli/görüntülü arama). WebRTC çekirdeği native derleme gerektirir;
    // Expo Go yerine development build kullanılır.
    '@livekit/react-native-expo-plugin',
    '@config-plugins/react-native-webrtc',
    'expo-font',
    'expo-sharing',
    'expo-mail-composer',
    [
      'expo-video',
      {
        // Reels arka planda duymaya devam etmemeli: sekme degisince veya
        // uygulama arkaya gidince ses tamamen kesilir.
        supportsBackgroundPlayback: false,
        supportsPictureInPicture: false,
      },
    ],
    [
      'expo-alternate-app-icons',
      [
        {
          name: 'Orbit',
          ios: './assets/brand/icons/icon-orbit.png',
          android: {
            foregroundImage: './assets/brand/icons/adaptive-foreground-orbit.png',
            backgroundColor: '#0B2A6B',
          },
        },
        {
          name: 'Nova',
          ios: './assets/brand/icons/icon-nova.png',
          android: {
            foregroundImage: './assets/brand/icons/adaptive-foreground-nova.png',
            backgroundColor: '#0B2A6B',
          },
        },
      ],
    ],
    [
      'expo-build-properties',
      {
        android: {
          minSdkVersion: 26,
          // R8: release derlemesinde kod küçültme + kullanılmayan kaynak budama.
          // Daha küçük APK daha hızlı kurulur ve uygulama daha hızlı açılır.
          // (SDK 58'de eski `enableProguardInReleaseBuilds` adının yerini aldı.)
          enableMinifyInReleaseBuilds: true,
          enableShrinkResourcesInReleaseBuilds: true,
          // PNG'leri release'te optimize et (varsayılan açık, açıkça sabitlendi).
          enablePngCrunchInReleaseBuilds: true,
          // Hermes V1: daha hızlı açılış, daha az bellek (RN 0.84+ varsayılanı).
          useHermesV1: true,
          /**
           * R8 keep kuralları.
           *
           * `react-native-compressor` 2.x Nitro tabanlıdır: native taraf
           * HybridObject sınıflarını **isimle** (JNI) bulur. R8 bu sınıfları
           * yeniden adlandırdığında ya da tamamen budadığında video sıkıştırma
           * çağrısı JS hatası olarak değil, süreç ölümü olarak sonuçlanıyordu:
           * kullanıcı video paylaşırken uygulama kapanıyordu. Kurallar hem
           * Nitro çekirdeğini hem derleyici modülünü korur.
           */
          extraProguardRules: [
            '# --- react-native-nitro-modules (JNI isim cozumlemesi) ---',
            '-keep class com.margelo.nitro.** { *; }',
            '-keep class com.margelo.nitro.**$* { *; }',
            '-keep class * extends com.margelo.nitro.core.HybridObject { *; }',
            '-keepclasseswithmembernames class * { native <methods>; }',
            '',
            '# --- react-native-compressor (video/audio/image codec) ---',
            '-keep class com.reactnativecompressor.** { *; }',
            '-keep class com.reactnativecompressor.**$* { *; }',
            '-dontwarn com.reactnativecompressor.**',
            '',
            '# --- LiveKit Android SDK (JNI + relabeled jni_zero) ---',
            // LiveKit, WebRTC/JNI köprüsünde `org.jni_zero` sınıflarını kendi
            // paketi altına taşır (`livekit.org.jni_zero`). R8 bu JNI sınıfını
            // derleme sırasında bulamadığı için release build
            // `:app:minifyReleaseWithR8` adımında başarısız oluyordu
            // ("Missing classes detected while running R8").
            '-dontwarn livekit.org.jni_zero.**',
            '-keep class livekit.org.jni_zero.** { *; }',
            '-keep class io.livekit.** { *; }',
            '-dontwarn io.livekit.**',
            '-keepclasseswithmembernames class livekit.** { native <methods>; }',
          ].join('\n'),
        },
        ios: {
          // expo-maps (Apple Maps) iOS 18+ gerektirir.
          deploymentTarget: '18.0',
        },
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    appUrl: process.env.EXPO_PUBLIC_APP_URL ?? 'https://www.trabzoneapp.com',
    eas: {
      projectId: '2512ac5f-ba99-4d56-90ee-079b4211b77c',
    },
  },
});
