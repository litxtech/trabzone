import type { ConfigContext, ExpoConfig } from 'expo/config';

const APP_SCHEME = 'trabzone';
const BUNDLE_ID = 'com.litxtech.trabzone';

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
    permissions: ['android.permission.CAMERA', 'android.permission.RECORD_AUDIO'],
  },
  web: {
    bundler: 'metro',
    output: 'single',
    favicon: './assets/brand/icons/icon.png',
  },
  plugins: [
    'expo-router',
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
    'expo-font',
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
          enableProguardInReleaseBuilds: true,
          enableShrinkResourcesInReleaseBuilds: true,
        },
        ios: {
          deploymentTarget: '16.4',
        },
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    appUrl: process.env.EXPO_PUBLIC_APP_URL ?? 'https://trabzone.app',
    eas: {
      projectId: '2512ac5f-ba99-4d56-90ee-079b4211b77c',
    },
  },
});
