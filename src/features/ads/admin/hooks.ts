import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { unwrap } from '@/utils/result';

import * as svc from './service';
import { adsAdminKeys } from './service';
import type { AdAdvertiser, AdCampaignPayload, AdPlacementPatch, AdSettings, AdTransition } from './types';

function useInvalidateAds() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: adsAdminKeys.all });
}

export function useAdsOverview() {
  return useQuery({
    queryKey: adsAdminKeys.overview,
    queryFn: async () => unwrap(await svc.fetchAdsOverview()),
    staleTime: 15_000,
  });
}

export function useAdsSettings() {
  return useQuery({
    queryKey: adsAdminKeys.settings,
    queryFn: async () => unwrap(await svc.fetchAdsSettings()),
  });
}

export function useAdsGlobalSet() {
  const invalidate = useInvalidateAds();
  return useMutation({
    mutationFn: async (input: { enabled: boolean; reason: string }) =>
      unwrap(await svc.setAdsGlobal(input.enabled, input.reason)),
    onSuccess: () => void invalidate(),
  });
}

export function useAdsSettingsUpdate() {
  const invalidate = useInvalidateAds();
  return useMutation({
    mutationFn: async (input: { patch: Partial<AdSettings>; reason: string }) =>
      unwrap(await svc.updateAdsSettings(input.patch, input.reason)),
    onSuccess: () => void invalidate(),
  });
}

export function useAdRuleUpdate() {
  const invalidate = useInvalidateAds();
  return useMutation({
    mutationFn: async (input: { key: string; min: number; max: number; def: number; reason: string }) =>
      unwrap(await svc.updateAdRule(input)),
    onSuccess: () => void invalidate(),
  });
}

export function useAdPlacements() {
  return useQuery({
    queryKey: adsAdminKeys.placements,
    queryFn: async () => unwrap(await svc.fetchAdPlacements()),
  });
}

export function useAdPlacementUpdate() {
  const invalidate = useInvalidateAds();
  return useMutation({
    mutationFn: async (input: { key: string; patch: AdPlacementPatch; reason: string }) =>
      unwrap(await svc.updateAdPlacement(input.key, input.patch, input.reason)),
    onSuccess: () => void invalidate(),
  });
}

export function useAdAdvertisers(search: string, offset: number, limit = 25) {
  return useQuery({
    queryKey: adsAdminKeys.advertisers(search, offset),
    queryFn: async () => unwrap(await svc.fetchAdAdvertisers(search, limit, offset)),
    placeholderData: keepPreviousData,
  });
}

export function useAdAdvertiserSave() {
  const invalidate = useInvalidateAds();
  return useMutation({
    mutationFn: async (input: { id: string | null; payload: Partial<AdAdvertiser> }) =>
      unwrap(await svc.saveAdAdvertiser(input.id, input.payload)),
    onSuccess: () => void invalidate(),
  });
}

export function useAdAdvertiserMember() {
  const invalidate = useInvalidateAds();
  return useMutation({
    mutationFn: async (input: { advertiserId: string; username: string; add: boolean }) =>
      unwrap(await svc.setAdAdvertiserMember(input.advertiserId, input.username, input.add)),
    onSuccess: () => void invalidate(),
  });
}

export function useAdCampaigns(status: string | null, search: string, offset: number, limit = 20) {
  return useQuery({
    queryKey: adsAdminKeys.campaigns(status, search, offset),
    queryFn: async () => unwrap(await svc.fetchAdCampaigns(status, search, limit, offset)),
    placeholderData: keepPreviousData,
  });
}

export function useAdCampaign(id: string | null) {
  return useQuery({
    queryKey: adsAdminKeys.campaign(id ?? ''),
    enabled: Boolean(id),
    queryFn: async () => unwrap(await svc.fetchAdCampaign(id as string)),
  });
}

export function useAdCampaignSave() {
  const invalidate = useInvalidateAds();
  return useMutation({
    mutationFn: async (input: { id: string | null; payload: AdCampaignPayload; reason?: string }) =>
      unwrap(await svc.saveAdCampaign(input.id, input.payload, input.reason)),
    onSuccess: () => void invalidate(),
  });
}

export function useAdCampaignTransition() {
  const invalidate = useInvalidateAds();
  return useMutation({
    mutationFn: async (input: { id: string; action: AdTransition; reason?: string | null }) =>
      unwrap(await svc.transitionAdCampaign(input.id, input.action, input.reason)),
    onSuccess: () => void invalidate(),
  });
}

export function useAdReportGenerate() {
  const invalidate = useInvalidateAds();
  return useMutation({
    mutationFn: async (id: string) => unwrap(await svc.generateAdReport(id)),
    onSuccess: () => void invalidate(),
  });
}

export function useAdCampaignAnalytics(id: string | null, days: number) {
  return useQuery({
    queryKey: adsAdminKeys.campaignAnalytics(id ?? '', days),
    enabled: Boolean(id),
    queryFn: async () => unwrap(await svc.fetchAdCampaignAnalytics(id as string, days)),
  });
}

export function useAdsAnalytics(days: number, enabled = true) {
  return useQuery({
    queryKey: adsAdminKeys.analytics(days),
    enabled,
    queryFn: async () => unwrap(await svc.fetchAdsAnalytics(days)),
  });
}

export function useAdsTargeting(enabled = true) {
  return useQuery({
    queryKey: adsAdminKeys.targeting,
    enabled,
    queryFn: async () => unwrap(await svc.fetchAdsTargeting()),
  });
}

export function useAdMedia(variant: string | null, enabled = true) {
  return useQuery({
    queryKey: adsAdminKeys.media(variant),
    enabled,
    queryFn: async () => unwrap(await svc.fetchAdMedia(variant)),
  });
}

export function useAdMediaRegister() {
  const invalidate = useInvalidateAds();
  return useMutation({
    mutationFn: async (input: Parameters<typeof svc.registerAdMedia>[0]) =>
      unwrap(await svc.registerAdMedia(input)),
    onSuccess: () => void invalidate(),
  });
}

export function useAdMediaArchive() {
  const invalidate = useInvalidateAds();
  return useMutation({
    mutationFn: async (id: string) => unwrap(await svc.archiveAdMedia(id)),
    onSuccess: () => void invalidate(),
  });
}

export function useAdsAudit(offset: number, enabled = true, limit = 40) {
  return useQuery({
    queryKey: adsAdminKeys.audit(offset),
    enabled,
    queryFn: async () => unwrap(await svc.fetchAdsAudit(limit, offset)),
    placeholderData: keepPreviousData,
  });
}
