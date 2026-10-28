import { appError } from '@/services/errors';
import { rpcError } from '@/services/rpc';
import { supabase } from '@/services/supabase/client';
import { fail, ok, type Result } from '@/utils/result';

import { MAP_LAYER_LIST } from '../constants';
import type {
  MapAdminOverview,
  MapAdminShare,
  MapDensity,
  MapExploreResult,
  MapFriend,
  MapLayerKey,
  MapMode,
  MapPoint,
  MapPreferences,
  MapRegion,
  MapSavedPlace,
  MapShare,
  MapVisibility,
} from '../types';

type RpcArgs = Record<string, unknown>;

async function call<T>(fn: string, args: RpcArgs = {}): Promise<Result<T>> {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) {
    return fail(rpcError(error));
  }
  return ok(data as unknown as T);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

const LAYER_KEYS = MAP_LAYER_LIST.map((layer) => layer.key);

function parseLayers(value: unknown, fallback?: Record<MapLayerKey, boolean>): Record<MapLayerKey, boolean> {
  const raw = asRecord(value);
  const out = {} as Record<MapLayerKey, boolean>;
  for (const key of LAYER_KEYS) {
    const current = asBoolean(raw[key]);
    out[key] = current ?? fallback?.[key] ?? (key === 'friends' || key === 'rides');
  }
  return out;
}

function parseShare(value: unknown): MapShare | null {
  const raw = asRecord(value);
  const id = asString(raw.id);
  const expires = asString(raw.expires_at);
  if (!id || !expires) {
    return null;
  }
  const audience = raw.audience === 'selected' ? 'selected' : 'friends';
  const viewersRaw = Array.isArray(raw.viewers) ? raw.viewers : [];
  return {
    id,
    audience,
    precise: asBoolean(raw.precise) ?? false,
    started_at: asString(raw.started_at) ?? new Date().toISOString(),
    expires_at: expires,
    lat: asNumber(raw.lat) ?? undefined,
    lng: asNumber(raw.lng) ?? undefined,
    viewers: viewersRaw.map((item) => String(item)),
  };
}

function parseVisibility(value: unknown): MapVisibility {
  return value === 'friends' || value === 'selected' || value === 'ghost' ? value : 'ghost';
}

function parseMode(value: unknown): MapMode {
  return value === 'ride' || value === 'explore' || value === 'support' || value === 'social'
    ? value
    : 'social';
}

function parseDensity(value: unknown): MapDensity {
  return value === 'simple' || value === 'rich' || value === 'balanced' ? value : 'balanced';
}

export function parsePreferences(raw: unknown): MapPreferences {
  const data = asRecord(raw);
  const lastView = asRecord(data.last_view);
  return {
    userId: asString(data.user_id) ?? '',
    ghostMode: asBoolean(data.ghost_mode) ?? true,
    visibility: parseVisibility(data.visibility),
    precision: data.precision === 'exact' ? 'exact' : 'approximate',
    defaultShareMinutes: asNumber(data.default_share_minutes) ?? 60,
    activeMode: parseMode(data.active_mode),
    layers: parseLayers(data.layers),
    density: parseDensity(data.density),
    lastView: {
      lat: asNumber(lastView.lat) ?? undefined,
      lng: asNumber(lastView.lng) ?? undefined,
      zoom: asNumber(lastView.zoom) ?? undefined,
      city: asString(lastView.city),
    },
    onboardingDone: asBoolean(data.onboarding_done) ?? false,
    activeShare: parseShare(data.active_share),
  };
}

function parsePoint(raw: unknown): MapPoint | null {
  const data = asRecord(raw);
  const id = asString(data.id);
  const lat = asNumber(data.lat);
  const lng = asNumber(data.lng);
  if (!id || lat == null || lng == null) {
    return null;
  }
  const kind = asString(data.kind) ?? 'place';
  const allowed: MapPoint['kind'][] = [
    'friend',
    'ride_offer',
    'ride_request',
    'event',
    'place',
    'live',
    'reel',
    'story',
    'help',
    'cluster',
  ];
  return {
    id,
    kind: allowed.includes(kind as MapPoint['kind']) ? (kind as MapPoint['kind']) : 'place',
    lat,
    lng,
    title: asString(data.title) ?? 'Harita işareti',
    subtitle: asString(data.subtitle),
    username: asString(data.username),
    avatarPath: asString(data.avatar_path),
    precise: asBoolean(data.precise) ?? false,
    updatedAt: asString(data.updated_at),
    expiresAt: asString(data.expires_at),
    meta: asRecord(data.meta),
  };
}

export function parseExplore(raw: unknown): MapExploreResult {
  const data = asRecord(raw);
  const center = asRecord(data.center);
  const counts = asRecord(data.counts);
  const pointsRaw = Array.isArray(data.points) ? data.points : [];
  const points = pointsRaw
    .map(parsePoint)
    .filter((point): point is MapPoint => point !== null);
  return {
    center: {
      lat: asNumber(center.lat) ?? 0,
      lng: asNumber(center.lng) ?? 0,
    },
    radiusKm: asNumber(data.radius_km) ?? 0,
    counts: {
      friends: asNumber(counts.friends) ?? 0,
      rides: asNumber(counts.rides) ?? 0,
    },
    points,
    generatedAt: asString(data.generated_at) ?? new Date().toISOString(),
  };
}

export const mapQueryKeys = {
  preferences: ['map', 'preferences'] as const,
  explore: (camera: { lat: number; lng: number; zoom: number }, layers: MapLayerKey[]) =>
    ['map', 'explore', camera.lat.toFixed(3), camera.lng.toFixed(3), camera.zoom.toFixed(1), layers.join(',')] as const,
  friends: ['map', 'friends'] as const,
  savedPlaces: ['map', 'saved-places'] as const,
  regions: ['map', 'regions'] as const,
};

// ---------------------------------------------------------------------------
// Tercihler ve paylaşım
// ---------------------------------------------------------------------------
export async function getMapPreferences(): Promise<Result<MapPreferences>> {
  const result = await call<unknown>('map_prefs_get');
  return result.ok ? ok(parsePreferences(result.data)) : result;
}

export type MapPreferencePatch = {
  ghost_mode?: boolean;
  visibility?: MapVisibility;
  precision?: MapPreferences['precision'];
  active_mode?: MapMode;
  layers?: Record<MapLayerKey, boolean>;
  density?: MapDensity;
  default_share_minutes?: number;
  last_view?: { lat?: number; lng?: number; zoom?: number; city?: string | null };
  onboarding_done?: boolean;
};

export async function saveMapPreferences(patch: MapPreferencePatch): Promise<Result<MapPreferences>> {
  const result = await call<unknown>('map_prefs_save', { p_payload: patch });
  return result.ok ? ok(parsePreferences(result.data)) : result;
}

export async function startLocationShare(input: {
  lat: number;
  lng: number;
  precise: boolean;
  minutes: number;
  audience: 'friends' | 'selected';
  viewers?: string[];
}): Promise<Result<MapShare>> {
  const result = await call<unknown>('map_share_start', {
    p_lat: input.lat,
    p_lng: input.lng,
    p_precise: input.precise,
    p_minutes: input.minutes,
    p_audience: input.audience,
    p_viewers: input.viewers ?? [],
  });
  if (!result.ok) {
    return result;
  }
  const share = parseShare(result.data);
  if (!share) {
    return fail(appError('unknown', 'Konum paylaşımı başlatılamadı.'));
  }
  return ok(share);
}

export async function heartbeatLocationShare(lat: number, lng: number): Promise<Result<boolean>> {
  const result = await call<unknown>('map_share_heartbeat', { p_lat: lat, p_lng: lng });
  return result.ok ? ok(true) : result;
}

export async function stopLocationShare(): Promise<Result<boolean>> {
  const result = await call<unknown>('map_share_stop');
  return result.ok ? ok(true) : result;
}

export async function stopAllSharing(): Promise<Result<boolean>> {
  const result = await call<unknown>('map_panic_stop_sharing');
  return result.ok ? ok(true) : result;
}

// ---------------------------------------------------------------------------
// Keşif
// ---------------------------------------------------------------------------
export async function exploreMap(input: {
  lat: number;
  lng: number;
  radiusKm: number;
  layers: MapLayerKey[];
}): Promise<Result<MapExploreResult>> {
  const result = await call<unknown>('map_explore', {
    p_lat: input.lat,
    p_lng: input.lng,
    p_radius: input.radiusKm,
    p_layers: input.layers,
    p_limit: 200,
  });
  return result.ok ? ok(parseExplore(result.data)) : result;
}

export async function listMapFriends(): Promise<Result<MapFriend[]>> {
  const result = await call<unknown>('map_friends');
  if (!result.ok) {
    return result;
  }
  const rows = Array.isArray(result.data) ? result.data : [];
  return ok(
    rows.map((row) => {
      const data = asRecord(row);
      return {
        id: asString(data.id) ?? '',
        username: asString(data.username) ?? '',
        displayName: asString(data.display_name) ?? asString(data.username) ?? 'Trabzone üyesi',
        avatarPath: asString(data.avatar_path),
        isVerified: asBoolean(data.is_verified) ?? false,
        sharing: asBoolean(data.sharing) ?? false,
      };
    }),
  );
}

// ---------------------------------------------------------------------------
// Kaydedilen yerler / bölgeler
// ---------------------------------------------------------------------------
export async function listSavedPlaces(): Promise<Result<MapSavedPlace[]>> {
  const result = await call<unknown>('map_saved_places_list');
  if (!result.ok) {
    return result;
  }
  const rows = Array.isArray(result.data) ? result.data : [];
  return ok(
    rows
      .map((row) => {
        const data = asRecord(row);
        const id = asString(data.id);
        const lat = asNumber(data.lat);
        const lng = asNumber(data.lng);
        if (!id || lat == null || lng == null) {
          return null;
        }
        const collection = asString(data.collection);
        const visibility = asString(data.visibility);
        return {
          id,
          title: asString(data.title) ?? 'Kaydedilen yer',
          address: asString(data.address),
          lat,
          lng,
          category: asString(data.category) ?? 'place',
          note: asString(data.note),
          collection:
            collection === 'wishlist' || collection === 'trips' || collection === 'custom'
              ? collection
              : 'favorites',
          visibility:
            visibility === 'public' || visibility === 'link' ? visibility : 'private',
          created_at: asString(data.created_at) ?? new Date().toISOString(),
        } satisfies MapSavedPlace;
      })
      .filter((row): row is MapSavedPlace => row !== null),
  );
}

export async function addSavedPlace(input: {
  title: string;
  lat: number;
  lng: number;
  address?: string | null;
  category?: string;
  collection?: MapSavedPlace['collection'];
  visibility?: MapSavedPlace['visibility'];
  note?: string | null;
}): Promise<Result<boolean>> {
  const result = await call<unknown>('map_saved_place_add', {
    p_title: input.title,
    p_lat: input.lat,
    p_lng: input.lng,
    p_address: input.address ?? null,
    p_category: input.category ?? 'place',
    p_collection: input.collection ?? 'favorites',
    p_visibility: input.visibility ?? 'private',
    p_note: input.note ?? null,
  });
  return result.ok ? ok(true) : result;
}

export async function deleteSavedPlace(id: string): Promise<Result<boolean>> {
  const result = await call<boolean>('map_saved_place_delete', { p_id: id });
  return result.ok ? ok(Boolean(result.data)) : result;
}

export async function listRegions(): Promise<Result<MapRegion[]>> {
  const result = await call<unknown>('map_regions_list');
  if (!result.ok) {
    return result;
  }
  const rows = Array.isArray(result.data) ? result.data : [];
  return ok(
    rows
      .map((row) => {
        const data = asRecord(row);
        const id = asString(data.id);
        if (!id) {
          return null;
        }
        const notify = asString(data.notify_mode);
        return {
          id,
          label: asString(data.label) ?? 'Bölge',
          lat: asNumber(data.lat),
          lng: asNumber(data.lng),
          radius_km: asNumber(data.radius_km) ?? 25,
          notify_mode:
            notify === 'instant' || notify === 'important' || notify === 'off'
              ? notify
              : 'daily',
          created_at: asString(data.created_at) ?? new Date().toISOString(),
        } satisfies MapRegion;
      })
      .filter((row): row is MapRegion => row !== null),
  );
}

export async function followRegion(input: {
  label: string;
  radiusKm: number;
  notify: MapRegion['notify_mode'];
  lat?: number;
  lng?: number;
}): Promise<Result<boolean>> {
  const result = await call<unknown>('map_region_follow', {
    p_label: input.label,
    p_radius_km: input.radiusKm,
    p_notify: input.notify,
    p_lat: input.lat ?? null,
    p_lng: input.lng ?? null,
  });
  return result.ok ? ok(true) : result;
}

export async function unfollowRegion(id: string): Promise<Result<boolean>> {
  const result = await call<boolean>('map_region_unfollow', { p_id: id });
  return result.ok ? ok(Boolean(result.data)) : result;
}

// ---------------------------------------------------------------------------
// Yönetici (yalnızca toplulaştırılmış veri, koordinat/kimlik yok)
// ---------------------------------------------------------------------------
const MODULE_STATES = ['ready', 'partial', 'not_configured'] as const;

export function parseAdminOverview(raw: unknown): MapAdminOverview {
  const data = asRecord(raw);
  const preferences = asRecord(data.preferences);
  const sharing = asRecord(data.sharing);
  const library = asRecord(data.library);
  const rides = asRecord(data.rides);
  const privacy = asRecord(data.privacy);
  const modulesRaw = Array.isArray(data.modules) ? data.modules : [];
  return {
    preferences: {
      total: asNumber(preferences.total) ?? 0,
      ghost: asNumber(preferences.ghost) ?? 0,
      friends: asNumber(preferences.friends) ?? 0,
      selected: asNumber(preferences.selected) ?? 0,
      exact_precision: asNumber(preferences.exact_precision) ?? 0,
      onboarded: asNumber(preferences.onboarded) ?? 0,
    },
    sharing: {
      active: asNumber(sharing.active) ?? 0,
      expired_24h: asNumber(sharing.expired_24h) ?? 0,
      stopped_24h: asNumber(sharing.stopped_24h) ?? 0,
      selected_audience: asNumber(sharing.selected_audience) ?? 0,
      precise_active: asNumber(sharing.precise_active) ?? 0,
      viewer_grants: asNumber(sharing.viewer_grants) ?? 0,
      owners_24h: asNumber(sharing.owners_24h) ?? 0,
    },
    library: {
      saved_places: asNumber(library.saved_places) ?? 0,
      public_places: asNumber(library.public_places) ?? 0,
      link_places: asNumber(library.link_places) ?? 0,
      collections: asNumber(library.collections) ?? 0,
      regions: asNumber(library.regions) ?? 0,
      instant_regions: asNumber(library.instant_regions) ?? 0,
    },
    rides: {
      active_offers: asNumber(rides.active_offers) ?? 0,
      with_coordinates: asNumber(rides.with_coordinates) ?? 0,
      open_requests: asNumber(rides.open_requests) ?? 0,
    },
    privacy: {
      ghost_default: asBoolean(privacy.ghost_default) ?? true,
      exact_requires_explicit_consent: asBoolean(privacy.exact_requires_explicit_consent) ?? true,
      approximate_fuzz_meters: asNumber(privacy.approximate_fuzz_meters) ?? 1100,
      admin_coordinate_access: asBoolean(privacy.admin_coordinate_access) ?? false,
      admin_identity_access: asBoolean(privacy.admin_identity_access) ?? false,
      raw_gps_in_public_results: asBoolean(privacy.raw_gps_in_public_results) ?? false,
      retention_note: asString(privacy.retention_note) ?? '',
    },
    modules: modulesRaw
      .map((item) => {
        const module = asRecord(item);
        const key = asString(module.key);
        if (!key) {
          return null;
        }
        const state = asString(module.state);
        return {
          key,
          label: asString(module.label) ?? key,
          state: MODULE_STATES.includes(state as (typeof MODULE_STATES)[number])
            ? (state as MapAdminOverview['modules'][number]['state'])
            : 'not_configured',
        } satisfies MapAdminOverview['modules'][number];
      })
      .filter((item): item is MapAdminOverview['modules'][number] => item !== null),
  };
}

export async function getMapAdminOverview(): Promise<Result<MapAdminOverview>> {
  const result = await call<unknown>('map_admin_overview');
  return result.ok ? ok(parseAdminOverview(result.data)) : result;
}

export async function listMapAdminActiveShares(): Promise<Result<MapAdminShare[]>> {
  const result = await call<unknown>('map_admin_active_shares');
  if (!result.ok) {
    return result;
  }
  const rows = Array.isArray(result.data) ? result.data : [];
  return ok(
    rows
      .map((row) => {
        const data = asRecord(row);
        const id = asString(data.session_id);
        const expires = asString(data.expires_at);
        if (!id || !expires) {
          return null;
        }
        return {
          session_id: id,
          audience: data.audience === 'selected' ? 'selected' : 'friends',
          precise: asBoolean(data.precise) ?? false,
          started_at: asString(data.started_at) ?? new Date().toISOString(),
          expires_at: expires,
          expires_in_minutes: asNumber(data.expires_in_minutes) ?? 0,
          viewer_count: asNumber(data.viewer_count) ?? 0,
        } satisfies MapAdminShare;
      })
      .filter((row): row is MapAdminShare => row !== null),
  );
}

export async function stopMapAdminShare(sessionId: string, reason: string): Promise<Result<boolean>> {
  const result = await call<{ stopped?: boolean }>('map_admin_stop_share', {
    p_session_id: sessionId,
    p_reason: reason,
  });
  return result.ok ? ok(result.data?.stopped === true) : result;
}
