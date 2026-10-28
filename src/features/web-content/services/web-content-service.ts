import type { PostgrestError } from '@supabase/supabase-js';

import { appError, type AppError } from '@/services/errors';
import { supabase } from '@/services/supabase/client';
import { fail, ok, type Result } from '@/utils/result';

import type {
  AdminContactChannel,
  ContactChannel,
  ContactSubmission,
  ContactTopic,
  EmailLogs,
  WebsiteContent,
  WebsiteSection,
} from '../types';

const WEB_ERRORS: Record<string, AppError> = {
  not_authenticated: appError('session_missing'),
  insufficient_privilege: appError('forbidden'),
  invalid_topic: appError('invalid_input', 'Geçerli bir konu seç.'),
  invalid_name: appError('invalid_input', 'Ad soyad en az 2 karakter olmalı.'),
  invalid_email: appError('invalid_input', 'Geçerli bir e-posta adresi gir.'),
  invalid_message: appError('invalid_input', 'Mesaj en az 10 karakter olmalı.'),
  invalid_key: appError('invalid_input', 'Anahtar geçersiz.'),
  invalid_title: appError('invalid_input', 'Başlık çok kısa.'),
  invalid_value: appError('invalid_input', 'Ayar değeri geçersiz.'),
  email_not_verified: appError(
    'invalid_input',
    'Doğrulanmamış bir e-posta adresi yayına alınamaz. Önce adresi doğrulayın.',
  ),
  rate_limited: appError('rate_limited'),
};

function mapError(error: PostgrestError | Error | null | undefined): AppError {
  if (!error) {
    return appError('unknown');
  }
  const raw = ('message' in error ? String(error.message ?? '') : '').trim();
  const known = WEB_ERRORS[raw];
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

export const fetchWebsiteContent = () => callRpc<WebsiteContent>('website_public_content');

export const fetchContactChannels = async (): Promise<Result<ContactChannel[]>> => {
  const result = await callRpc<ContactChannel[]>('contact_channels_public');
  return result.ok ? ok(result.data ?? []) : result;
};

export const submitContact = (input: {
  name: string;
  email: string;
  topic: ContactTopic;
  message: string;
}) =>
  callRpc<{ id: string; reference_code: string; created_at: string }>('contact_submit', {
    p_name: input.name,
    p_email: input.email,
    p_topic: input.topic,
    p_message: input.message,
  });

// -----------------------------------------------------------------------------
// Yönetici
// -----------------------------------------------------------------------------

export const adminFetchWebsiteContent = () => callRpc<WebsiteContent>('admin_website_content');

export const adminSaveWebsiteSetting = (input: { key: string; value: Record<string, unknown> }) =>
  callRpc<{ key: string; value: Record<string, unknown> }>('admin_website_setting_save', {
    p_key: input.key,
    p_value: input.value,
  });

export const adminSaveWebsiteSection = (input: {
  key: string;
  title: string;
  subtitle?: string | null;
  body?: string | null;
  payload?: Record<string, unknown>;
  sortOrder?: number;
  isPublished?: boolean;
}) =>
  callRpc<WebsiteSection>('admin_website_section_save', {
    p_key: input.key,
    p_title: input.title,
    p_subtitle: input.subtitle ?? null,
    p_body: input.body ?? null,
    p_payload: input.payload ?? {},
    p_sort_order: input.sortOrder ?? 100,
    p_is_published: input.isPublished ?? true,
  });

export const adminFetchContactChannels = async (): Promise<Result<AdminContactChannel[]>> => {
  const result = await callRpc<AdminContactChannel[]>('admin_contact_channels');
  return result.ok ? ok(result.data ?? []) : result;
};

export const adminSaveContactChannel = (input: {
  key: string;
  label: string;
  email: string | null;
  description?: string | null;
  isActive?: boolean;
  verified?: boolean;
  sortOrder?: number;
}) =>
  callRpc<{
    key: string;
    label: string;
    email: string | null;
    is_active: boolean;
    verified_at: string | null;
  }>('admin_contact_channel_save', {
    p_key: input.key,
    p_label: input.label,
    p_email: input.email,
    p_description: input.description ?? null,
    p_is_active: input.isActive ?? false,
    p_verified: input.verified ?? false,
    p_sort_order: input.sortOrder ?? 100,
  });

export const adminFetchContactSubmissions = async (
  status: string | null = null,
): Promise<Result<ContactSubmission[]>> => {
  const result = await callRpc<{ items: ContactSubmission[] }>('admin_contact_submissions', {
    p_status: status,
  });
  return result.ok ? ok(result.data.items ?? []) : result;
};

export const adminFetchEmailLogs = (limit = 50) =>
  callRpc<EmailLogs>('admin_email_logs', { p_limit: limit });
