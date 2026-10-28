// Android-only Mapbox kurulumu.
//
// Neden yerel (local) plugin?
//   `@rnmapbox/maps` resmi plugin'i hem Android gradle dosyalarini hem de iOS
//   Podfile'ini degistiriyor. Trabzone'da iOS tarafi Apple Maps (expo-maps)
//   kullandigi icin Mapbox iOS pod'u kurulmuyor (react-native.config.js ile
//   iOS'ta autolinking kapali). Resmi plugin iOS Podfile'ina `$RNMapboxMaps`
//   bloklari eklerse Podfile tanimsiz degiskene referans verip kirilir.
//   Bu yuzden yalnizca Android tarafini yapilandiriyoruz.
const {
  createRunOncePlugin,
  withAppBuildGradle,
  withProjectBuildGradle,
} = require('expo/config-plugins');

const pkg = require('../package.json');

const MAVEN_TAG = 'trabzone-mapbox-maven';
const PACKAGING_TAG = 'trabzone-mapbox-packaging';

/**
 * `mergeContents` SDK 58'de `expo/config-plugins` üzerinden export edilmiyor
 * (yalnızca `@expo/config-plugins/build/utils/generateCode` içinde). Prebuild
 * sırasında "mergeContents is not a function" hatasıyla Android derlemesi
 * kırıldığı için etiket tabanlı basit ve idempotent bir ekleme yapıyoruz.
 */
function insertIntoAndroidBlock(contents, block, tag) {
  if (contents.includes(tag)) {
    return contents;
  }
  const match = /^android\s*\{[^\n]*\n/m.exec(contents);
  if (!match) {
    return contents;
  }
  const index = match.index + match[0].length;
  return `${contents.slice(0, index)}${block}\n${contents.slice(index)}`;
}

const mavenBlock = `
// Mapbox v11 Maven deposu. Mapbox indirme kimlik dogrulamasini kaldirdigi icin
// varsayilan olarak token gerekmez; MAPBOX_DOWNLOADS_TOKEN tanimliysa kullanilir.
// @generated begin ${MAVEN_TAG}
allprojects {
  repositories {
    maven {
      url 'https://api.mapbox.com/downloads/v2/releases/maven'
      def mapboxDownloadToken = project.properties['MAPBOX_DOWNLOADS_TOKEN'] ?: System.getenv('RNMAPBOX_MAPS_DOWNLOAD_TOKEN')
      if (mapboxDownloadToken) {
        authentication { basic(BasicAuthentication) }
        credentials {
          username = 'mapbox'
          password = mapboxDownloadToken
        }
      }
    }
  }
}
// @generated end ${MAVEN_TAG}
`;

const withMapboxMaven = (config) =>
  withProjectBuildGradle(config, (config) => {
    if (config.modResults.language !== 'groovy') {
      return config;
    }
    if (config.modResults.contents.includes(MAVEN_TAG)) {
      return config;
    }
    config.modResults.contents += mavenBlock;
    return config;
  });

const withMapboxPackaging = (config) =>
  withAppBuildGradle(config, (config) => {
    if (config.modResults.language !== 'groovy') {
      return config;
    }
    const block = `    // @generated begin ${PACKAGING_TAG}
    packagingOptions {
        pickFirst 'lib/x86/libc++_shared.so'
        pickFirst 'lib/x86_64/libc++_shared.so'
        pickFirst 'lib/arm64-v8a/libc++_shared.so'
        pickFirst 'lib/armeabi-v7a/libc++_shared.so'
    }
    // @generated end ${PACKAGING_TAG}`;
    config.modResults.contents = insertIntoAndroidBlock(
      config.modResults.contents,
      block,
      PACKAGING_TAG,
    );
    return config;
  });

const withMapboxAndroid = (config) => {
  config = withMapboxMaven(config);
  config = withMapboxPackaging(config);
  return config;
};

module.exports = createRunOncePlugin(withMapboxAndroid, 'trabzone-mapbox-android', pkg.version);
