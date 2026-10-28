import { supabase } from '@/services/supabase/client';
import { fail, ok, type Result } from '@/utils/result';

export type DeletionRequestReceipt = {
  request_no: string;
  status: string;
  created_at: string;
  rate_limited: boolean;
};

export type DeletionRequestStatus = {
  request_no: string;
  status: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  identity_verified: boolean;
} | null;

function errorMessage(message: string | undefined, fallback: string) {
  if (message?.includes('invalid_email')) {
    return 'Geçerli bir e-posta adresi gir.';
  }
  return fallback;
}

/** Oturum açamayan kullanıcı için hesap silme talebi oluşturur. */
export async function createDeletionRequest(input: {
  email: string;
  reason?: string | null;
}): Promise<Result<DeletionRequestReceipt>> {
  const { data, error } = await supabase.rpc('deletion_request_create', {
    p_email: input.email.trim(),
    p_reason: input.reason?.trim() ? input.reason.trim() : null,
    p_source: 'web',
  });
  if (error) {
    return fail(new Error(errorMessage(error.message, 'Talep oluşturulamadı. Lütfen tekrar dene.')));
  }
  return ok(data as unknown as DeletionRequestReceipt);
}

/** Referans kodu + e-posta eşleşmesiyle talep durumunu sorgular. */
export async function fetchDeletionRequestStatus(input: {
  requestNo: string;
  email: string;
}): Promise<Result<DeletionRequestStatus>> {
  const { data, error } = await supabase.rpc('deletion_request_status', {
    p_request_no: input.requestNo.trim(),
    p_email: input.email.trim(),
  });
  if (error) {
    return fail(new Error('Talep durumu sorgulanamadı. Lütfen bilgileri kontrol et.'));
  }
  return ok((data as unknown as DeletionRequestStatus) ?? null);
}
