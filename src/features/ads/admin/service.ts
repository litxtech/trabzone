import type { PostgrestError } from '@supabase/supabase-js';

import { mapAdminError } from '@/features/admin/services/admin-service';
import { appError, type AppError } from '@/services/errors';
import { supabase } from '@/services/supabase/client';
import { fail, ok, type Result } from '@/utils/result';

import type {
  AdAdjustment,
  AdAdvertiser,
  AdAnalytics,
  AdAuditItem,
  AdCampaignAnalytics,
  AdCampaignFull,
  AdCampaignList,
  AdCampaignPayload,
  AdMediaAsset,
  AdPlacementPatch,
  AdPlacementRow,
  AdRule,
  AdSettings,
  AdsOverview,
  AdTargeting,
  AdTransition,
} from './types';

/** Kampanya doğrulama sorunlarının yönetici dostu karşılıkları. */
export const AD_ISSUE_LABELS: Record<string, string> = {
  title_missing: 'Reklam başlığı eksik (en az 3 karakter).',
  title_too_long: 'Başlık 70 karakteri aşıyor; banner üzerinde kesilir.',
  description_too_long: 'Açıklama 140 karakteri aşıyor.',
  media_missing: 'Banner görseli eklenmedi.',
  media_url_invalid: 'Medya adresi https ile başlamalı ve geçerli olmalı.',
  ends_in_past: 'Bitiş tarihi geçmişte.',
  placements_missing: 'En az bir yerleşim seçilmeli.',
  platforms_missing: 'En az bir platform seçilmeli.',
  policy_prohibited: 'Kategori reklam politikasına aykırı.',
  advertiser_inactive: 'Reklamveren aktif değil.',
  destination_destination_missing: 'Yönlendirme hedefi tanımlanmadı.',
  destination_detail_missing: 'Detay sayfası içeriği eksik.',
  destination_target_invalid: 'Hedef kimliği geçersiz.',
  destination_target_unavailable: 'Hedef içerik yayında değil veya silinmiş.',
  destination_phone_invalid: 'Telefon numarası geçersiz.',
  destination_location_invalid: 'Harita konumu geçersiz.',
  destination_url_invalid: 'Web adresi geçersiz.',
  destination_url_scheme_invalid: 'Web adresi https ile başlamalı.',
  destination_url_credentials: 'Web adresi kullanıcı bilgisi içeremez.',
  destination_url_host_invalid: 'Web adresinin alan adı geçersiz.',
  destination_url_domain_not_allowed: 'Alan adı izin verilen listede değil.',
};

export function adIssueLabel(code: string): string {
  return AD_ISSUE_LABELS[code] ?? code;
}

const TOKENS: Record<string, string> = {
  ad_name_invalid: 'Ad 2–120 karakter olmalı.',
  ad_policy_prohibited: 'Bu kategori reklam politikası gereği yasak.',
  ad_policy_category_invalid: 'Geçersiz reklam kategorisi.',
  dates_invalid: 'Bitiş tarihi başlangıçtan sonra olmalı.',
  ad_advertiser_not_found: 'Reklamveren bulunamadı.',
  ad_placement_not_found: 'Yerleşim bulunamadı.',
  ad_media_url_invalid: 'Medya adresi https ile başlamalı (en fazla 12 galeri görseli).',
  ad_destination_invalid: 'Geçersiz yönlendirme türü.',
  ad_url_invalid: 'Web adresi güvenli değil veya izin verilen alan adlarında değil.',
  ad_campaign_not_found: 'Kampanya bulunamadı.',
  ad_campaign_locked: 'Süresi dolan veya arşivlenen kampanya düzenlenemez.',
  ad_transition_invalid: 'Kampanya bu duruma geçirilemez.',
  ad_review_note_required: 'Sağlık ve finans reklamlarında en az 10 karakterlik inceleme notu zorunlu.',
  ad_format_unsupported: 'Bu yerleşim seçilen formatı desteklemiyor.',
  ad_domain_invalid: 'Alan adı listesinde geçersiz bir kayıt var.',
  ad_admob_config_required: 'AdMob açmak için iOS veya Android uygulama kimliği gerekli.',
  ad_rule_not_found: 'Kural bulunamadı.',
  ad_rule_out_of_bounds: 'Değerler güvenli sınırların dışında.',
  ad_email_invalid: 'E-posta adresi geçersiz.',
  ad_status_invalid: 'Geçersiz durum.',
  ad_place_not_found: 'İşletme bulunamadı.',
  ad_media_not_found: 'Medya bulunamadı.',
  mfa_required: 'Bu kritik işlem için iki adımlı doğrulama gerekli.',
  session_revoked: 'Yönetici oturumun sonlandırılmış. Yeniden giriş yap.',
};

export function mapAdsError(error: PostgrestError | Error | null | undefined): AppError {
  const raw = (error && 'message' in error ? (error.message ?? '') : '').trim();
  if (raw.startsWith('ad_campaign_incomplete')) {
    const codes = raw
      .slice(raw.indexOf(':') + 1)
      .split(',')
      .map((code) => code.trim())
      .filter(Boolean);
    return appError(
      'invalid_input',
      `Kampanya yayına hazır değil:\n• ${codes.map(adIssueLabel).join('\n• ')}`,
    );
  }
  const token = raw.split(/\s/)[0] ?? '';
  if (TOKENS[token]) {
    return appError('invalid_input', TOKENS[token]);
  }
  return mapAdminError(error);
}

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<Result<T>> {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) {
    return fail(mapAdsError(error));
  }
  return ok(data as unknown as T);
}

export const adsAdminKeys = {
  all: ['admin', 'ads'] as const,
  overview: ['admin', 'ads', 'overview'] as const,
  settings: ['admin', 'ads', 'settings'] as const,
  placements: ['admin', 'ads', 'placements'] as const,
  advertisers: (search: string, offset: number) => ['admin', 'ads', 'advertisers', search, offset] as const,
  campaigns: (status: string | null, search: string, offset: number) =>
    ['admin', 'ads', 'campaigns', status, search, offset] as const,
  campaign: (id: string) => ['admin', 'ads', 'campaign', id] as const,
  campaignAnalytics: (id: string, days: number) => ['admin', 'ads', 'campaign-analytics', id, days] as const,
  analytics: (days: number) => ['admin', 'ads', 'analytics', days] as const,
  targeting: ['admin', 'ads', 'targeting'] as const,
  media: (variant: string | null) => ['admin', 'ads', 'media', variant] as const,
  audit: (offset: number) => ['admin', 'ads', 'audit', offset] as const,
};

export const fetchAdsOverview = () => rpc<AdsOverview>('admin_ads_overview');
export const fetchAdsSettings = () =>
  rpc<{ settings: AdSettings; rules: AdRule[] }>('admin_ads_settings_get');
export const setAdsGlobal = (enabled: boolean, reason: string) =>
  rpc<{ ads_enabled: boolean }>('admin_ads_global_set', { p_enabled: enabled, p_reason: reason });
export const updateAdsSettings = (patch: Partial<AdSettings>, reason: string) =>
  rpc<AdSettings>('admin_ads_settings_update', { p_patch: patch, p_reason: reason });
export const updateAdRule = (input: { key: string; min: number; max: number; def: number; reason: string }) =>
  rpc<AdRule>('admin_ads_rule_update', {
    p_key: input.key,
    p_min: input.min,
    p_max: input.max,
    p_default: input.def,
    p_reason: input.reason,
  });

export const fetchAdPlacements = () => rpc<AdPlacementRow[]>('admin_ads_placements_list');
export const updateAdPlacement = (key: string, patch: AdPlacementPatch, reason: string) =>
  rpc<{ placement: AdPlacementRow; adjustments: AdAdjustment[] }>('admin_ads_placement_update', {
    p_key: key,
    p_patch: patch,
    p_reason: reason,
  });

export const fetchAdAdvertisers = (search: string, limit: number, offset: number) =>
  rpc<{ total: number; limit: number; offset: number; items: AdAdvertiser[] }>(
    'admin_ads_advertisers_list',
    { p_search: search || null, p_limit: limit, p_offset: offset },
  );
export const saveAdAdvertiser = (id: string | null, payload: Partial<AdAdvertiser>, reason?: string) =>
  rpc<AdAdvertiser>('admin_ads_advertiser_save', { p_id: id, p_payload: payload, p_reason: reason ?? null });
export const setAdAdvertiserMember = (advertiserId: string, username: string, add: boolean) =>
  rpc<{ ok: boolean }>('admin_ads_advertiser_member_set', {
    p_advertiser_id: advertiserId,
    p_username: username,
    p_add: add,
    p_reason: null,
  });

export const fetchAdCampaigns = (status: string | null, search: string, limit: number, offset: number) =>
  rpc<AdCampaignList>('admin_ads_campaigns_list', {
    p_status: status,
    p_search: search || null,
    p_limit: limit,
    p_offset: offset,
  });
export const fetchAdCampaign = (id: string) => rpc<AdCampaignFull>('admin_ads_campaign_get', { p_id: id });
export const saveAdCampaign = (id: string | null, payload: AdCampaignPayload, reason?: string) =>
  rpc<AdCampaignFull>('admin_ads_campaign_save', { p_id: id, p_payload: payload, p_reason: reason ?? null });
export const transitionAdCampaign = (id: string, action: AdTransition, reason?: string | null) =>
  rpc<AdCampaignFull>('admin_ads_campaign_transition', {
    p_id: id,
    p_action: action,
    p_reason: reason ?? null,
  });
export const generateAdReport = (id: string) =>
  rpc<{ id: string }>('admin_ads_report_generate', { p_campaign_id: id });
export const fetchAdCampaignAnalytics = (id: string, days: number) =>
  rpc<AdCampaignAnalytics>('admin_ads_campaign_analytics', { p_id: id, p_days: days });

export const fetchAdsAnalytics = (days: number) => rpc<AdAnalytics>('admin_ads_analytics', { p_days: days });
export const fetchAdsTargeting = () => rpc<AdTargeting>('admin_ads_targeting_overview');

export const fetchAdMedia = (variant: string | null, limit = 60, offset = 0) =>
  rpc<{ total: number; items: AdMediaAsset[] }>('admin_ads_media_list', {
    p_variant: variant,
    p_limit: limit,
    p_offset: offset,
  });
export const registerAdMedia = (input: {
  url: string;
  storagePath: string | null;
  mediaType: 'image' | 'video';
  variant: AdMediaAsset['variant'];
  width?: number | null;
  height?: number | null;
  size?: number | null;
  label?: string | null;
}) =>
  rpc<AdMediaAsset>('admin_ads_media_register', {
    p_url: input.url,
    p_storage_path: input.storagePath,
    p_media_type: input.mediaType,
    p_variant: input.variant,
    p_width: input.width ?? null,
    p_height: input.height ?? null,
    p_size: input.size ?? null,
    p_label: input.label ?? null,
  });
export const archiveAdMedia = (id: string) => rpc<{ ok: boolean }>('admin_ads_media_archive', { p_id: id });

export const fetchAdsAudit = (limit: number, offset: number) =>
  rpc<{ total: number; items: AdAuditItem[] }>('admin_ads_audit', { p_limit: limit, p_offset: offset });
