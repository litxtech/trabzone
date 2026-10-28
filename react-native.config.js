// iOS tarafinda harita motoru Apple Maps (expo-maps) oldugu icin Mapbox iOS
// pod'u kurulmaz. Android'de Mapbox `@rnmapbox/maps` ile native calisir.
module.exports = {
  dependencies: {
    '@rnmapbox/maps': {
      platforms: {
        ios: null,
      },
    },
  },
};
