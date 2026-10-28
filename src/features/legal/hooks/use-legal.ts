import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

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
    staleTime: 5 * 60_000,
    enabled: slug.length > 0,
  });
}

export function useLegalDocuments(locale: LegalLocale = 'tr') {
  return useQuery<LegalDocumentSummary[], Error>({
    queryKey: legalKeys.documents(locale),
    queryFn: async () => unwrap(await legal.fetchLegalDocuments(locale)),
    staleTime: 10 * 60_000,
  });
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
