import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { supabase } from '@/services/supabase/client';
import type { Result } from '@/utils/result';

import * as legal from '../services/legal-service';
import type {
  ConsentPurpose,
  ConsentRecord,
  LegalAcceptance,
  LegalAdminVersion,
  LegalDocument,
  LegalDocumentSummary,
  LegalLocale,
  LegalSource,
  PendingAcceptance,
} from '../types';

export const legalKeys = {
  document: (slug: string, locale: LegalLocale) => ['legal', 'document', slug, locale] as const,
  documents: (locale: LegalLocale) => ['legal', 'documents', locale] as const,
  acceptances: ['legal', 'acceptances'] as const,
  pending: ['legal', 'pending'] as const,
  consents: ['legal', 'consents'] as const,
  adminVersions: (slug: string | null) => ['legal', 'admin', 'versions', slug] as const,
};

const unwrap = <T>(result: Result<T>): T => {
  if (!result.ok) {
    throw result.error;
  }
  return result.data;
};

export function useLegalDocument(slug: string, locale: LegalLocale = 'tr') {
  return useQuery<LegalDocument | null, Error>({
    queryKey: legalKeys.document(slug, locale),
    queryFn: async () => unwrap(await legal.fetchLegalDocument(slug, locale)),
    // Yönetici yayınladığı an site taze metni göstermeli; uzun önbellek yok.
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    enabled: slug.length > 0,
  });
}

export function useLegalDocuments(locale: LegalLocale = 'tr') {
  return useQuery<LegalDocumentSummary[], Error>({
    queryKey: legalKeys.documents(locale),
    queryFn: async () => unwrap(await legal.fetchLegalDocuments(locale)),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

/** Aynı kanalı dinleyen tüm ekranların tazeleme geri çağrıları. */
const legalListeners = new Set<() => void>();
let legalChannel: ReturnType<typeof supabase.channel> | null = null;
let legalChannelReady = false;

const notifyLegalListeners = () => {
  legalListeners.forEach((listener) => listener());
};

/**
 * `legal-policies` kanalını süreç başına bir kez kurar.
 *
 * `supabase.channel(topic)` aynı konu için mevcut kanal örneğini döndürür.
 * Her ekran kendi kanalını kurup `removeChannel` ile kaldırdığında, kaldırma
 * asenkron olduğu için iki ekran art arda bağlandığında ikinci `.on(...)`
 * çağrısı "cannot add `postgres_changes` callbacks ... after `subscribe()`"
 * hatası veriyordu (özellikle React StrictMode'un çift mount'unda). Kanal artık
 * paylaşılıyor: dinleyiciler bir kümede tutulur, kanal bir kez abone olur.
 */
function ensureLegalChannel() {
  if (legalChannel && legalChannelReady) {
    return;
  }
  const channel = supabase.channel('legal-policies');
  try {
    channel
      .on('broadcast', { event: 'legal_changed' }, notifyLegalListeners)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'safety_policy_versions' },
        notifyLegalListeners,
      )
      .subscribe();
    legalChannel = channel;
    legalChannelReady = true;
  } catch {
    // Kanal başka bir abone tarafından çoktan kurulmuş olabilir; o kanal zaten
    // aynı olayları iletiyor, yeniden abone olmaya çalışmayız.
    legalChannel = channel;
    legalChannelReady = true;
  }
}

/**
 * Yayınlanmış sözleşmeler değiştiğinde açık oturumları anında tazeler.
 * Yönetim panelinden yapılan her yayın/geri alma/düzenleme, sayfa
 * yenilenmeden siteye ve uygulamaya yansır.
 *
 * İki kanal birlikte kullanılır:
 *  - `legal-policies` broadcast: RLS'in gizlediği silme/geri alma olayları
 *    dahil her değişikliği iletir (0083 tetikleyicisi).
 *  - `postgres_changes`: değişen satır içeriğini yetkili oturumlara iletir.
 */
export function useLegalRealtime(enabled = true) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: ['legal'] });
      void queryClient.invalidateQueries({ queryKey: ['safety'] });
    };
    legalListeners.add(refresh);
    ensureLegalChannel();

    return () => {
      legalListeners.delete(refresh);
      // Kanal bilinçli olarak açık bırakılır: sonraki mount'ta yeniden
      // kullanılır, tekrar abone olma hatası oluşmaz.
    };
  }, [enabled, queryClient]);
}

export function usePendingAcceptances(enabled = true) {
  return useQuery<PendingAcceptance[], Error>({
    queryKey: legalKeys.pending,
    queryFn: async () => unwrap(await legal.fetchPendingAcceptances()),
    staleTime: 30_000,
    enabled,
  });
}

export function useMyAcceptances() {
  return useQuery<LegalAcceptance[], Error>({
    queryKey: legalKeys.acceptances,
    queryFn: async () => unwrap(await legal.fetchMyAcceptances()),
    staleTime: 60_000,
  });
}

export function useMyConsents(enabled = true) {
  return useQuery<ConsentRecord[], Error>({
    queryKey: legalKeys.consents,
    queryFn: async () => unwrap(await legal.fetchMyConsents()),
    staleTime: 60_000,
    enabled,
  });
}

export function useRecordAcceptance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      slug: string;
      source: LegalSource;
      version?: number | null;
      userAgent?: string | null;
    }) => unwrap(await legal.recordLegalAcceptance(input)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: legalKeys.pending });
      void queryClient.invalidateQueries({ queryKey: legalKeys.acceptances });
    },
  });
}

export function useSetConsent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      purpose: ConsentPurpose;
      granted: boolean;
      source?: 'web_register' | 'web_settings' | 'oauth_register' | 'mobile_settings';
    }) => unwrap(await legal.setConsent(input)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: legalKeys.consents });
    },
  });
}

// -----------------------------------------------------------------------------
// Yönetici
// -----------------------------------------------------------------------------

export function useAdminLegalVersions(slug: string | null = null) {
  return useQuery<LegalAdminVersion[], Error>({
    queryKey: legalKeys.adminVersions(slug),
    queryFn: async () => unwrap(await legal.adminFetchLegalVersions(slug)),
    staleTime: 30_000,
  });
}

export function useAdminSaveLegalDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: Parameters<typeof legal.adminSaveLegalDocument>[0]) =>
      unwrap(await legal.adminSaveLegalDocument(input)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['legal', 'admin'] });
      void queryClient.invalidateQueries({ queryKey: ['legal', 'documents'] });
      void queryClient.invalidateQueries({ queryKey: ['legal', 'document'] });
    },
  });
}

export function useAdminPublishLegalDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; effectiveAt?: string | null }) =>
      unwrap(await legal.adminPublishLegalDocument(input.id, input.effectiveAt)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['legal', 'admin'] });
      void queryClient.invalidateQueries({ queryKey: ['legal', 'documents'] });
      void queryClient.invalidateQueries({ queryKey: ['legal', 'document'] });
    },
  });
}

export function useAdminArchiveLegalDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; reason?: string | null }) =>
      unwrap(await legal.adminArchiveLegalDocument(input.id, input.reason)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['legal', 'admin'] });
      void queryClient.invalidateQueries({ queryKey: ['legal', 'documents'] });
    },
  });
}

/** Yayındaki sözleşmeyi geri alır; varsa önceki sürüm yeniden yürürlüğe girer. */
export function useAdminUnpublishLegalDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; reason?: string | null }) =>
      unwrap(await legal.adminUnpublishLegalDocument(input.id, input.reason)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['legal', 'admin'] });
      void queryClient.invalidateQueries({ queryKey: ['legal', 'documents'] });
      void queryClient.invalidateQueries({ queryKey: ['legal', 'document'] });
    },
  });
}

/** Tek sürümü kalıcı siler (kabul kaydı yoksa ve sürüm yayında değilse). */
export function useAdminDeleteLegalVersion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string }) =>
      unwrap(await legal.adminDeleteLegalVersion(input.id)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['legal', 'admin'] });
      void queryClient.invalidateQueries({ queryKey: ['legal', 'documents'] });
      void queryClient.invalidateQueries({ queryKey: ['legal', 'document'] });
    },
  });
}

/** Belgeyi tüm sürümleriyle siler (hiç kabul kaydı yoksa). */
export function useAdminDeleteLegalDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { slug: string; locale?: LegalLocale }) =>
      unwrap(await legal.adminDeleteLegalDocument(input.slug, input.locale)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['legal', 'admin'] });
      void queryClient.invalidateQueries({ queryKey: ['legal', 'documents'] });
      void queryClient.invalidateQueries({ queryKey: ['legal', 'document'] });
      void queryClient.invalidateQueries({ queryKey: ['legal', 'pending'] });
    },
  });
}
