import type { PostgrestError } from '@supabase/supabase-js';

import { appError, type AppError } from '@/services/errors';
import { supabase } from '@/services/supabase/client';
import { fail, ok, type Result } from '@/utils/result';

import type {
  ConsentPurpose,
  ConsentRecord,
  LegalAcceptance,
  LegalAction,
  LegalAdminVersion,
  LegalDocument,
  LegalDocumentSummary,
  LegalLocale,
  LegalSource,
  PendingAcceptance,
} from '../types';

const LEGAL_ERRORS: Record<string, AppError> = {
  not_authenticated: appError('session_missing'),
  insufficient_privilege: appError('forbidden'),
  document_not_found: appError('not_found', 'Belge bulunamadı.'),
  stale_document_version: appError(
    'invalid_input',
    'Belge güncellendi. Lütfen sayfayı yenileyip yeni sürümü incele.',
  ),
  invalid_action: appError('invalid_input'),
  invalid_source: appError('invalid_input'),
  invalid_slug: appError('invalid_input', 'Belge adresi geçersiz.'),
  invalid_title: appError('invalid_input', 'Belge başlığı çok kısa.'),
  invalid_body: appError('invalid_input', 'Belge içeriği çok kısa.'),
  invalid_doc_type: appError('invalid_input'),
  already_published: appError('duplicate', 'Bu sürüm zaten yayımlanmış.'),
  invalid_purpose: appError('invalid_input'),
  rate_limited: appError('rate_limited'),
};

function mapError(error: PostgrestError | Error | null | undefined): AppError {
  if (!error) {
    return appError('unknown');
  }
  const raw = ('message' in error ? String(error.message ?? '') : '').trim();
  const known = LEGAL_ERRORS[raw];
  if (known) {
    return known;
  }
  const code = 'code' in error ? String(error.code ?? '') : '';
  if (code === '42501' || code === 'PGRST301') {
    return appError('forbidden');
  }
  if (code === 'PGRST202' || code === '42883') {
    return appError('unknown', 'Sunucu güncel değil. Lütfen daha sonra tekrar dene.');
  }
  if (raw.includes('Failed to fetch') || raw.includes('Network request failed')) {
    return appError('network');
  }
  return appError('unknown');
}

async function callRpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<Result<T>> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    return fail(mapError(error));
  }
  return ok(data as unknown as T);
}

export const fetchLegalDocument = (slug: string, locale: LegalLocale = 'tr') =>
  callRpc<LegalDocument | null>('legal_document', { p_slug: slug, p_locale: locale });

export const fetchLegalDocuments = async (
  locale: LegalLocale = 'tr',
): Promise<Result<LegalDocumentSummary[]>> => {
  const result = await callRpc<LegalDocumentSummary[]>('legal_documents', { p_locale: locale });
  return result.ok ? ok(result.data ?? []) : result;
};

export const recordLegalAcceptance = (input: {
  slug: string;
  action?: LegalAction;
  source: LegalSource;
  version?: number | null;
  userAgent?: string | null;
}) =>
  callRpc<{ slug: string; version: number; action: LegalAction; content_hash: string }>(
    'legal_record_acceptance',
    {
      p_slug: input.slug,
      p_action: input.action ?? 'accepted',
      p_source: input.source,
      p_version: input.version ?? null,
      p_user_agent: input.userAgent ?? null,
    },
  );

export const fetchMyAcceptances = async (): Promise<Result<LegalAcceptance[]>> => {
  const result = await callRpc<LegalAcceptance[]>('legal_my_acceptances');
  return result.ok ? ok(result.data ?? []) : result;
};

export const fetchPendingAcceptances = async (): Promise<Result<PendingAcceptance[]>> => {
  const result = await callRpc<PendingAcceptance[]>('legal_my_pending');
  return result.ok ? ok(result.data ?? []) : result;
};

export const fetchMyConsents = async (): Promise<Result<ConsentRecord[]>> => {
  const result = await callRpc<ConsentRecord[]>('consents_my');
  return result.ok ? ok(result.data ?? []) : result;
};

export const setConsent = (input: {
  purpose: ConsentPurpose;
  granted: boolean;
  source?: 'web_register' | 'web_settings' | 'oauth_register' | 'mobile_settings';
}) =>
  callRpc<{ purpose: ConsentPurpose; granted: boolean }>('consent_set', {
    p_purpose: input.purpose,
    p_granted: input.granted,
    p_source: input.source ?? 'web_settings',
  });

// -----------------------------------------------------------------------------
// Yönetici
// -----------------------------------------------------------------------------

export const adminFetchLegalVersions = async (
  slug?: string | null,
): Promise<Result<LegalAdminVersion[]>> => {
  const result = await callRpc<LegalAdminVersion[]>('legal_admin_versions', {
    p_slug: slug ?? null,
  });
  return result.ok ? ok(result.data ?? []) : result;
};

export const adminSaveLegalDocument = (input: {
  slug: string;
  title: string;
  summary?: string | null;
  bodyMd: string;
  locale?: LegalLocale;
  docType?: 'contract' | 'policy' | 'notice' | 'rules' | 'disclosure';
  requiresAcceptance?: boolean;
  effectiveAt?: string | null;
  changeSummary?: string | null;
  publish?: boolean;
}) =>
  callRpc<LegalAdminVersion>('legal_admin_save', {
    p_slug: input.slug,
    p_title: input.title,
    p_summary: input.summary ?? null,
    p_body_md: input.bodyMd,
    p_locale: input.locale ?? 'tr',
    p_doc_type: input.docType ?? 'policy',
    p_requires_acceptance: input.requiresAcceptance ?? true,
    p_effective_at: input.effectiveAt ?? null,
    p_change_summary: input.changeSummary ?? null,
    p_publish: input.publish ?? false,
  });

export const adminPublishLegalDocument = (id: string, effectiveAt?: string | null) =>
  callRpc<LegalAdminVersion>('legal_admin_publish', {
    p_id: id,
    p_effective_at: effectiveAt ?? null,
  });

export const adminArchiveLegalDocument = (id: string, reason?: string | null) =>
  callRpc<LegalAdminVersion>('legal_admin_archive', {
    p_id: id,
    p_reason: reason ?? null,
  });
