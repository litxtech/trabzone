import type { AuthError } from '@supabase/supabase-js';

export type AppErrorCode =
  | 'network'
  | 'invalid_credentials'
  | 'email_not_confirmed'
  | 'otp_invalid'
  | 'otp_expired'
  | 'rate_limited'
  | 'weak_password'
  | 'user_exists'
  | 'session_missing'
  | 'duplicate'
  | 'forbidden'
  | 'not_found'
  | 'invalid_input'
  | 'ticket_closed'
  | 'unknown';

export type AppError = {
  code: AppErrorCode;
  message: string;
};

const MESSAGES: Record<AppErrorCode, string> = {
  network: 'İnternet bağlantını kontrol edip tekrar dene.',
  invalid_credentials: 'E-posta veya şifre hatalı.',
  email_not_confirmed: 'E-postanı doğrulaman gerekiyor.',
  otp_invalid: 'Kod hatalı. Tekrar dene.',
  otp_expired: 'Kodun süresi doldu. Yeni kod isteyebilirsin.',
  rate_limited: 'Çok fazla deneme yaptın. Birkaç dakika sonra tekrar dene.',
  weak_password: 'Şifre güvenlik kurallarını karşılamıyor.',
  user_exists: 'Bu e-posta ile bir hesap zaten var.',
  session_missing: 'Oturum bulunamadı. Tekrar giriş yap.',
  duplicate: 'Bu işlem zaten yapılmış. Mevcut kaydını kontrol edebilirsin.',
  forbidden: 'Bu işlem için yetkin yok.',
  not_found: 'Kayıt bulunamadı. Sayfayı yenileyip tekrar dene.',
  invalid_input: 'Girdiğin bilgiler geçersiz. Kontrol edip tekrar dene.',
  ticket_closed: 'Bu talep kapatılmış. Yeni bir talep oluşturabilirsin.',
  unknown: 'Bir şeyler ters gitti. Tekrar dene.',
};

export const appError = (code: AppErrorCode, message?: string): AppError => ({
  code,
  message: message ?? MESSAGES[code],
});

export function mapAuthError(error: AuthError): AppError {
  const code = error.code ?? '';
  const status = error.status ?? 0;

  if (error.name === 'AuthRetryableFetchError' || status === 0) {
    return appError('network');
  }
  if (code === 'invalid_credentials' || code === 'invalid_grant') {
    return appError('invalid_credentials');
  }
  if (code === 'email_not_confirmed') {
    return appError('email_not_confirmed');
  }
  if (code === 'otp_expired' || code === 'token_expired') {
    return appError('otp_expired');
  }
  if (code === 'invalid_token' || code === 'otp_disabled') {
    return appError('otp_invalid');
  }
  if (code === 'over_email_send_rate_limit' || status === 429) {
    return appError('rate_limited');
  }
  if (code === 'weak_password') {
    return appError('weak_password');
  }
  if (code === 'user_already_exists' || code === 'email_exists') {
    return appError('user_exists');
  }
  return appError('unknown', 'İşlem tamamlanamadı. Lütfen tekrar dene.');
}

export function isAppError(value: unknown): value is AppError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    'message' in value &&
    typeof (value as AppError).message === 'string'
  );
}
