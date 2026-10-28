import type { ConfigContext, ExpoConfig } from 'expo/config';

const APP_SCHEME = 'trabzone';
const BUNDLE_ID = 'com.litxtech.trabzone';

/**
 * Apple ile giriş yalnızca sosyal giriş açıkken derlemeye dahil edilir.
 *
 * `com.apple.developer.applesignin` yetkisi, Apple Developer portalındaki
 * App ID'de "Sign In with Apple" açılmadan ve provisioning profile yeniden
 * üretilmeden imzalanamaz; profile yetkiyi içermezse arşiv adımı başarısız
 * olur. Sosyal giriş kapalıyken (EXPO_PUBLIC_ENABLE_SOCIAL_AUTH=false)
 * yetki ve config plugin hiç eklenmez, böylece imzalama mevcut profille uyumlu
 * kalır. Uygulama tarafında da Apple girişi aynı bayrakla kapatılmıştır
 * (src/config/env.ts, src/services/supabase/auth.ts).
 */
const SOCIAL_AUTH_ENABLED = process.env.EXPO_PUBLIC_ENABLE_SOCIAL_AUTH === 'true';

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
    usesAppleSignIn: SOCIAL_AUTH_ENABLED,
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
    predictiveBackGestureEnabled: true,
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
    'expo-web-browser',
    // Yetki (entitlement) eklediği için yalnızca sosyal giriş açıkken eklenir.
    ...(SOCIAL_AUTH_ENABLED ? ['expo-apple-authentication' as const] : []),
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
