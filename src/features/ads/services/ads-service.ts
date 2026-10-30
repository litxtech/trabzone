import { rpcError } from '@/services/rpc';
import { supabase } from '@/services/supabase/client';
import { fail, ok, type Result } from '@/utils/result';

import { adPlatform, adSessionId } from '../session';
import type {
  AdDetail,
  AdFeedbackReason,
  AdPlacementKey,
  AdServeResponse,
} from '../types';

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<Result<T>> {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) {
    return fail(rpcError(error));
  }
  return ok(data as unknown as T);
}

export const adKeys = {
  detail: (id: string) => ['ads', 'detail', id] as const,
};

/** Sunucudan yerleşime uygun reklam kararlarını ister. */
export async function serveAds(input: {
  placement: AdPlacementKey;
  count: number;
  contextDistrict?: string | null;
  exclude?: string[];
  lastCampaignId?: string | null;
}): Promise<Result<AdServeResponse>> {
  const result = await rpc<AdServeResponse>('ad_serve', {
    p_placement: input.placement,
    p_platform: adPlatform(),
    p_session_id: adSessionId(),
    p_count: input.count,
    p_context_district: input.contextDistrict ?? null,
    p_exclude: input.exclude ?? [],
    p_last_campaign: input.lastCampaignId ?? null,
  });
  if (!result.ok) {
    return result;
  }
  return ok({ ...result.data, ads: Array.isArray(result.data.ads) ? result.data.ads : [] });
}

export const recordAdImpression = (serveId: string, visibleMs: number) =>
  rpc<{ counted: boolean; reason?: string }>('ad_record_impression', {
    p_serve_id: serveId,
    p_visible_ms: Math.round(visibleMs),
  });

export const recordAdClick = (serveId: string) =>
  rpc<{ counted: boolean; reason?: string }>('ad_record_click', { p_serve_id: serveId });

export const sendAdFeedback = (input: {
  campaignId: string;
  kind: 'hide' | 'report';
  reason?: AdFeedbackReason | null;
  details?: string | null;
}) =>
  rpc<{ ok: boolean; hidden_until: string }>('ad_feedback', {
    p_campaign_id: input.campaignId,
    p_kind: input.kind,
    p_reason: input.reason ?? null,
    p_details: input.details ?? null,
  });

export const fetchAdDetail = (campaignId: string) =>
  rpc<AdDetail>('ad_detail_get', { p_campaign_id: campaignId });
