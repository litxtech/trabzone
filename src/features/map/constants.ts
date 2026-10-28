import type { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';

import type { MapDensity, MapLayerKey, MapMode, MapPointKind } from './types';

type IconName = ComponentProps<typeof Ionicons>['name'];

/** Trabzon — harita ilk açıldığında merkez. */
export const MAP_DEFAULT_CAMERA = { lat: 41.0027, lng: 39.7168, zoom: 12.4 };

export const MAP_MIN_ZOOM = 3;
export const MAP_MAX_ZOOM = 18.5;

export const MAP_DEFAULT_RADIUS_KM = 30;
export const MAP_MAX_RADIUS_KM = 200;

/** Kümeleme bu zoom seviyesinin üzerinde kapatılır. */
export const MAP_CLUSTER_MAX_ZOOM = 15.5;

export const MAP_DENSITY_POINT_LIMIT: Record<MapDensity, number> = {
  simple: 70,
  balanced: 150,
  rich: 260,
};

export const MAP_DENSITY_ZOOM_STEP: Record<MapDensity, number> = {
  simple: 1.1,
  balanced: 0.7,
  rich: 0.4,
};

export const MAP_MODE_LIST: {
  key: MapMode;
  label: string;
  icon: IconName;
  layers: MapLayerKey[];
}[] = [
  { key: 'social', label: 'Sosyal', icon: 'people-outline', layers: ['friends', 'live', 'reels', 'events'] },
  { key: 'ride', label: 'Yolculuk', icon: 'car-sport-outline', layers: ['rides'] },
  { key: 'explore', label: 'Keşfet', icon: 'compass-outline', layers: ['places', 'events', 'reels', 'live'] },
  { key: 'support', label: 'Destek', icon: 'help-buoy-outline', layers: ['help'] },
];

export const MAP_LAYER_LIST: {
  key: MapLayerKey;
  label: string;
  hint: string;
  icon: IconName;
  tone: 'primary' | 'accent' | 'success' | 'warning' | 'danger' | 'info';
  /** Bu katmanın arka ucu bağlı mı? Bağlı olmayan katman sahte veri göstermez. */
  ready: boolean;
}[] = [
  {
    key: 'friends',
    label: 'Arkadaşlar',
    hint: 'Yalnızca konum paylaşan arkadaşlar',
    icon: 'people-outline',
    tone: 'primary',
    ready: true,
  },
  {
    key: 'rides',
    label: 'Yolculuklar',
    hint: 'Sürücü ilanları ve yolcu talepleri',
    icon: 'car-sport-outline',
    tone: 'success',
    ready: true,
  },
  {
    key: 'events',
    label: 'Etkinlikler',
    hint: 'Etkinlik modülü bağlandığında görünür',
    icon: 'calendar-outline',
    tone: 'warning',
    ready: false,
  },
  {
    key: 'places',
    label: 'Mekânlar',
    hint: 'İşletme ve mekân modülü bağlandığında görünür',
    icon: 'storefront-outline',
    tone: 'accent',
    ready: false,
  },
  {
    key: 'live',
    label: 'Canlı yayınlar',
    hint: 'Harita canlı yayın keşfi henüz bağlı değil',
    icon: 'radio-outline',
    tone: 'danger',
    ready: false,
  },
  {
    key: 'reels',
    label: 'Reels ve hikâyeler',
    hint: 'Konumlu medya katmanı henüz bağlı değil',
    icon: 'play-circle-outline',
    tone: 'info',
    ready: false,
  },
  {
    key: 'help',
    label: 'Yardım ve kayıp eşya',
    hint: 'Topluluk yardım modülü henüz bağlı değil',
    icon: 'help-buoy-outline',
    tone: 'warning',
    ready: false,
  },
  {
    key: 'traffic',
    label: 'Trafik',
    hint: 'Trafik sağlayıcısı bağlandığında görünür',
    icon: 'git-network-outline',
    tone: 'danger',
    ready: false,
  },
  {
    key: 'weather',
    label: 'Hava durumu',
    hint: 'Hava durumu sağlayıcısı bağlandığında görünür',
    icon: 'partly-sunny-outline',
    tone: 'info',
    ready: false,
  },
];

export const MAP_LAYER_INDEX: Record<MapLayerKey, (typeof MAP_LAYER_LIST)[number]> = Object.fromEntries(
  MAP_LAYER_LIST.map((layer) => [layer.key, layer]),
) as Record<MapLayerKey, (typeof MAP_LAYER_LIST)[number]>;

export const MAP_KIND_LABEL: Record<MapPointKind, string> = {
  friend: 'Arkadaş',
  ride_offer: 'Sürücü ilanı',
  ride_request: 'Yolcu talebi',
  event: 'Etkinlik',
  place: 'Mekân',
  real_estate: 'Emlak',
  live: 'Canlı yayın',
  reel: 'Reels',
  story: 'Hikâye',
  help: 'Yardım',
  cluster: 'Bölge',
};

export const MAP_DENSITY_LIST: { key: MapDensity; label: string; hint: string }[] = [
  { key: 'simple', label: 'Sade', hint: 'Az işaret, yüksek performans' },
  { key: 'balanced', label: 'Dengeli', hint: 'Önerilen görünüm' },
  { key: 'rich', label: 'Zengin', hint: 'Tüm işaretler, daha yoğun' },
];

export const MAP_SHARE_DURATIONS = [15, 60, 180, 480, 1440] as const;

export type QuickActionKey =
  | 'find_ride'
  | 'publish_ride'
  | 'share_location'
  | 'friends'
  | 'create_event'
  | 'create_meetup'
  | 'trip_plan'
  | 'post_location'
  | 'discover_live'
  | 'discover_places'
  | 'safety';

export const MAP_QUICK_ACTIONS: {
  key: QuickActionKey;
  label: string;
  icon: IconName;
  hint: string;
  ready: boolean;
}[] = [
  {
    key: 'find_ride',
    label: 'Yolculuk bul',
    icon: 'search-outline',
    hint: 'Şehir içi ve şehirler arası',
    ready: true,
  },
  {
    key: 'publish_ride',
    label: 'Yolculuk paylaş',
    icon: 'add-circle-outline',
    hint: 'Sürücü olarak ilan ver',
    ready: true,
  },
  {
    key: 'share_location',
    label: 'Konum paylaş',
    icon: 'locate-outline',
    hint: 'Süreli canlı konum',
    ready: true,
  },
  {
    key: 'friends',
    label: 'Arkadaşları gör',
    icon: 'people-outline',
    hint: 'Kim haritada?',
    ready: true,
  },
  {
    key: 'safety',
    label: 'Güvenlik merkezi',
    icon: 'shield-checkmark-outline',
    hint: 'Hayalet modu ve erişimler',
    ready: true,
  },
  {
    key: 'create_event',
    label: 'Etkinlik oluştur',
    icon: 'calendar-outline',
    hint: 'Etkinlik modülü bekleniyor',
    ready: false,
  },
  {
    key: 'create_meetup',
    label: 'Buluşma oluştur',
    icon: 'people-circle-outline',
    hint: 'Grup haritası fazı bekleniyor',
    ready: false,
  },
  {
    key: 'trip_plan',
    label: 'Gezi planı oluştur',
    icon: 'map-outline',
    hint: 'Gezi planlayıcı fazı bekleniyor',
    ready: false,
  },
  {
    key: 'post_location',
    label: 'Konumlu gönderi',
    icon: 'image-outline',
    hint: 'Konumlu medya fazı bekleniyor',
    ready: false,
  },
  {
    key: 'discover_live',
    label: 'Canlı yayın keşfet',
    icon: 'radio-outline',
    hint: 'Yayın haritası fazı bekleniyor',
    ready: false,
  },
  {
    key: 'discover_places',
    label: 'Mekânları keşfet',
    icon: 'storefront-outline',
    hint: 'Mekân modülü fazı bekleniyor',
    ready: false,
  },
];

/** Marker tonları — tema renkleriyle eşlenir. */
export const MAP_KIND_TONE: Record<Exclude<MapPointKind, 'cluster'>, 'primary' | 'accent' | 'success' | 'warning' | 'danger' | 'info'> = {
  friend: 'primary',
  ride_offer: 'success',
  ride_request: 'warning',
  event: 'accent',
  place: 'accent',
  real_estate: 'primary',
  live: 'danger',
  reel: 'info',
  story: 'info',
  help: 'warning',
};

export const MAP_KIND_ICON: Record<Exclude<MapPointKind, 'cluster'>, IconName> = {
  friend: 'person',
  ride_offer: 'car-sport',
  ride_request: 'hand-left',
  event: 'calendar',
  place: 'storefront',
  real_estate: 'home',
  live: 'radio',
  reel: 'play',
  story: 'aperture',
  help: 'help-buoy',
};
