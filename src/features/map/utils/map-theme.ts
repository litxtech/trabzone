import { Platform } from 'react-native';

import type { Theme } from '@/theme/themes';

import { MAP_KIND_TONE } from '../constants';
import type { MapPointKind, MapProviderId } from '../types';

export type MarkerTone = 'primary' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

export function toneColor(theme: Theme, tone: MarkerTone): string {
  return theme.colors[tone];
}

export function toneSoftColor(theme: Theme, tone: MarkerTone): string {
  const map: Record<MarkerTone, keyof Theme['colors']> = {
    primary: 'primarySoft',
    accent: 'accentSoft',
    success: 'successSoft',
    warning: 'warningSoft',
    danger: 'dangerSoft',
    info: 'primarySoft',
  };
  return theme.colors[map[tone]];
}

export function markerTone(kind: MapPointKind): MarkerTone {
  if (kind === 'cluster') {
    return 'primary';
  }
  return MAP_KIND_TONE[kind];
}

export type MapProviderInfo = {
  id: MapProviderId;
  label: string;
  /** Harita motoru bu derlemede kullanılabilir mi (token / native modül). */
  detail: string;
};

export function currentMapProvider(hasToken: boolean): MapProviderInfo {
  if (Platform.OS === 'ios') {
    return {
      id: 'apple-maps',
      label: 'Apple Maps',
      detail: 'iOS · MapKit',
    };
  }
  if (Platform.OS === 'android') {
    return {
      id: 'mapbox',
      label: 'Mapbox',
      detail: hasToken ? 'Android · Mapbox v11' : 'Android · token eksik',
    };
  }
  return {
    id: 'static',
    label: 'Mapbox',
    detail: hasToken ? 'Web · statik önizleme' : 'Web · token eksik',
  };
}

/** Mapbox stil URL'leri — gündüz/gece premium görünüm. */
export const MAPBOX_STYLE = {
  light: 'mapbox://styles/mapbox/light-v11',
  dark: 'mapbox://styles/mapbox/dark-v11',
} as const;

/** Statik harita (web / geri dönüş) için stil adı. */
export const MAPBOX_STATIC_STYLE = {
  light: 'mapbox/light-v11',
  dark: 'mapbox/dark-v11',
} as const;

export function initialsFor(name: string | null | undefined): string {
  if (!name) {
    return '?';
  }
  const parts = name.trim().split(/\s+/).slice(0, 2);
  const initials = parts.map((part) => part.charAt(0).toLocaleUpperCase('tr-TR')).join('');
  return initials || '?';
}

export function formatRelativeTime(iso: string | null | undefined): string | null {
  if (!iso) {
    return null;
  }
  const value = new Date(iso).getTime();
  if (Number.isNaN(value)) {
    return null;
  }
  const diffSeconds = Math.round((Date.now() - value) / 1000);
  if (diffSeconds < 45) {
    return 'az önce';
  }
  const minutes = Math.round(diffSeconds / 60);
  if (minutes < 60) {
    return `${minutes} dk önce`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours} sa önce`;
  }
  return `${Math.round(hours / 24)} gün önce`;
}

export function formatMinutesLeft(iso: string | null | undefined): string | null {
  if (!iso) {
    return null;
  }
  const value = new Date(iso).getTime();
  if (Number.isNaN(value)) {
    return null;
  }
  const minutes = Math.max(0, Math.round((value - Date.now()) / 60000));
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest > 0 ? `${hours} sa ${rest} dk` : `${hours} sa`;
  }
  return `${minutes} dk`;
}
