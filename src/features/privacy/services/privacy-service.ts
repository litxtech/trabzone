import type { PostgrestError } from '@supabase/supabase-js';

import { appError, type AppError } from '@/services/errors';
import { supabase } from '@/services/supabase/client';
import { fail, ok, type Result } from '@/utils/result';

import type {
  AdminPrivacyRequestList,
  PrivacyRequestDetail,
  PrivacyRequestSummary,
  PrivacyRequestType,
} from '../types';

const PRIVACY_ERRORS: Record<string, AppError> = {
  not_authenticated: appError('session_missing'),
  insufficient_privilege: appError('forbidden'),
  not_found: appError('not_found', 'Başvuru bulunamadı.'),
  invalid_type: appError('invalid_input', 'Geçerli bir talep türü seç.'),
  invalid_subject: appError('invalid_input', 'Konu en az 3 karakter olmalı.'),
  invalid_details: appError('invalid_input', 'Açıklama en az 10 karakter olmalı.'),
  invalid_status: appError('invalid_input'),
  rate_limited: appError('rate_limited'),
  request_closed: appError('ticket_closed', 'Bu başvuru kapatılmış.'),
};

function mapError(error: PostgrestError | Error | null | undefined): AppError {
  if (!error) {
    return appError('unknown');
  }
  const raw = ('message' in error ? String(error.message ?? '') : '').trim();
  const known = PRIVACY_ERRORS[raw];
  if (known) {
    return known;
  }
  const code = 'code' in error ? String(error.code ?? '') : '';
  if (code === '42501' || code === 'PGRST301') {
    return appError('forbidden');
  }
  if (code === '42900') {
    return appError('rate_limited');
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

export const createPrivacyRequest = (input: {
  requestType: PrivacyRequestType;
  subject: string;
  details: string;
}) =>
  callRpc<{ id: string; request_no: string; status: string; due_at: string | null; created_at: string }>(
    'privacy_request_create',
    {
      p_request_type: input.requestType,
      p_subject: input.subject,
      p_details: input.details,
    },
  );

export const fetchMyPrivacyRequests = async (): Promise<Result<PrivacyRequestSummary[]>> => {
  const result = await callRpc<PrivacyRequestSummary[]>('privacy_request_list_my');
  return result.ok ? ok(result.data ?? []) : result;
};

export const fetchPrivacyRequest = (id: string) =>
  callRpc<PrivacyRequestDetail>('privacy_request_get', { p_id: id });

export const cancelPrivacyRequest = (id: string) =>
  callRpc<{ id: string; status: string }>('privacy_request_cancel', { p_id: id });

// -----------------------------------------------------------------------------
// Yönetici
// -----------------------------------------------------------------------------

export const adminFetchPrivacyRequests = (input: {
  status?: string | null;
  limit?: number;
  offset?: number;
}) =>
  callRpc<AdminPrivacyRequestList>('admin_privacy_requests', {
    p_status: input.status ?? null,
    p_limit: input.limit ?? 50,
    p_offset: input.offset ?? 0,
  });

export const adminUpdatePrivacyRequest = (input: {
  id: string;
  status: string;
  note?: string | null;
  response?: string | null;
}) =>
  callRpc<{ id: string; status: string }>('admin_privacy_request_update', {
    p_id: input.id,
    p_status: input.status,
    p_note: input.note ?? null,
    p_response: input.response ?? null,
  });
