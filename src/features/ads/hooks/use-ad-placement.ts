import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { isAdProviderReady } from '../providers';
import { adPositions, hashSeed } from '../frequency';
import { serveAds } from '../services/ads-service';
import { adSessionId, onAdSessionChange } from '../session';
import type { AdFallback, AdPlacementKey, AdServeConfig, AdSlot, ServedAd } from '../types';

/** Kapal? yerle?im i?in gereksiz a? turu at?lmaz; durum k?sa sˆ¢re ?nbelleklenir. */
const DISABLED_TTL_MS = 90_000;
const disabledUntil = new Map<string, number>();

/** Hafif listeler (?r. ?zgara) bir oturumda en fazla bu kadar reklam? birden ister. */
const MAX_BATCH = 3;

type PlacementState = {
  key: string;
  config: AdServeConfig | null;
  /** Gizlenen reklam?n yeri null kal?r; sonraki reklamlar kaymaz. */
  ads: (ServedAd | null)[];
  fallback: AdFallback;
  exhausted: boolean;
  disabled: boolean;
};

const initialState = (key: string): PlacementState => ({
  key,
  config: null,
  ads: [],
  fallback: null,
  exhausted: false,
  disabled: false,
});

export type AdPlacementOptions = {
  /** Ekran ba??ndaki il?e (?r. il?e filtresi). Yoksa profil il?esi kullan?l?r. */
  contextDistrict?: string | null;
  /** Izgara listelerinde reklam sat?r sonuna hizalan?r. */
  columns?: number;
  /** Bu yˆ¢zeyde en fazla ka? reklam yeri a??labilece?i. */
  maxSlots?: number;
  enabled?: boolean;
};

export type AdPlacementHandle = {
  /** Reklam? haz?r olan konumlar (organik i?erik say?s? cinsinden). */
  positions: number[];
  slotAt: (after: number) => AdSlot | null;
  hide: (campaignId: string) => void;
};

/**
 * AdPlacementSlot altyap?s?n?n veri katman?. Sunucudan reklam karar? al?r,
 * konumlar? hesaplar ve yaln?zca ger?ekten g?sterilecek bir reklam varsa
 * konum d?ndˆ¢rˆ¢r. Reklam yoksa hi?bir sat?r eklenmez; bo? ?er?eve olu?maz.
 */
export function useAdPlacement(
  placement: AdPlacementKey | null,
  organicCount: number,
  options: AdPlacementOptions = {},
): AdPlacementHandle {
  const { contextDistrict = null, columns = 1, maxSlots, enabled = true } = options;
  const [session, setSession] = useState(adSessionId);
  const stateKey = `${placement ?? ''}|${contextDistrict ?? ''}|${session}`;
  const [state, setState] = useState<PlacementState>(() => initialState(stateKey));
  const inflight = useRef<string | null>(null);
  const hidden = useRef(new Set<string>());

  useEffect(() => onAdSessionChange(() => setSession(adSessionId())), []);

  const current = useMemo(
    () => (state.key === stateKey ? state : initialState(stateKey)),
    [state, stateKey],
  );
  const seed = useMemo(() => hashSeed(stateKey), [stateKey]);

  const allPositions = useMemo(
    () =>
      current.config
        ? adPositions(current.config, organicCount, { seed, columns, maxSlots })
        : [],
    [columns, current.config, maxSlots, organicCount, seed],
  );

  useEffect(() => {
    if (!placement || !enabled || organicCount <= 3) {
      return;
    }
    if (current.disabled || current.exhausted || inflight.current === stateKey) {
      return;
    }
    const cachedOff = disabledUntil.get(placement);
    if (cachedOff && cachedOff > Date.now()) {
      return;
    }
    const needed = current.config ? allPositions.length - current.ads.length : 1;
    if (needed <= 0) {
      return;
    }

    inflight.current = stateKey;
    const requestKey = stateKey;
    void serveAds({
      placement,
      count: Math.min(needed, MAX_BATCH),
      contextDistrict,
      exclude: Array.from(hidden.current),
      lastCampaignId: [...current.ads].reverse().find((ad) => ad != null)?.campaign_id ?? null,
    }).then((result) => {
      if (inflight.current === requestKey) {
        inflight.current = null;
      }
      setState((previous) => {
        const base = previous.key === requestKey ? previous : initialState(requestKey);
        if (!result.ok) {
          return { ...base, exhausted: true };
        }
        const response = result.data;
        if (!response.enabled || !response.config) {
          disabledUntil.set(placement, Date.now() + DISABLED_TTL_MS);
          return { ...base, disabled: true };
        }
        disabledUntil.delete(placement);
        const fresh = response.ads.filter((ad) => !hidden.current.has(ad.campaign_id));
        return {
          ...base,
          config: response.config,
          fallback: response.fallback ?? null,
          ads: [...base.ads, ...fresh],
          exhausted: response.ads.length < Math.min(needed, MAX_BATCH),
        };
      });
    });
  }, [
    allPositions.length,
    contextDistrict,
    current.ads,
    current.config,
    current.disabled,
    current.exhausted,
    enabled,
    organicCount,
    placement,
    stateKey,
  ]);

  const providerReady = current.fallback ? isAdProviderReady(current.fallback.provider) : false;

  const positions = useMemo(() => {
    if (providerReady) {
      return allPositions;
    }
    return allPositions.slice(0, current.ads.length).filter((_, index) => current.ads[index] != null);
  }, [allPositions, current.ads, providerReady]);

  const slotAt = useCallback(
    (after: number): AdSlot | null => {
      const index = allPositions.indexOf(after);
      if (index < 0) {
        return null;
      }
      const ad = current.ads[index];
      if (ad) {
        return {
          kind: 'direct',
          key: ad.serve_id,
          slotIndex: index,
          ad,
          minVisibleRatio: current.config?.min_visible_ratio ?? 0.5,
          minViewMs: current.config?.min_view_ms ?? 1000,
        };
      }
      if (current.fallback && providerReady) {
        return {
          kind: 'provider',
          key: `${current.fallback.provider}-${after}`,
          slotIndex: index,
          fallback: current.fallback,
        };
      }
      return null;
    },
    [allPositions, current.ads, current.config, current.fallback, providerReady],
  );

  const hide = useCallback(
    (campaignId: string) => {
      hidden.current.add(campaignId);
      setState((previous) =>
        previous.key === stateKey
          ? {
              ...previous,
              ads: previous.ads.map((ad) => (ad?.campaign_id === campaignId ? null : ad)),
            }
          : previous,
      );
    },
    [stateKey],
  );

  return useMemo(() => ({ positions, slotAt, hide }), [hide, positions, slotAt]);
}
