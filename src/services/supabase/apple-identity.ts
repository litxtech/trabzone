import { appError } from '@/services/errors';
import { fail, ok, type Result } from '@/utils/result';

import { supabase } from './client';

/**
 * Apple oturum jetonlarının yönetimi.
 *
 * Apple, hesap silindiğinde uygulamanın Apple kimlik yetkisinin de kaldırılmasını
 * ister (App Store 5.1.1(v) ve "Sign in with Apple" kuralları). Supabase native
 * Apple girişinde yalnızca kimlik anahtarını doğrular; Apple'ın yenileme jetonu
 * `apple-token` edge function'ında yetki kodu ile bir kez alınıp saklanır ve
 * hesap silinirken iptal edilir.
 *
 * Sunucu tarafı yapılandırılmamışsa çağrılar sessizce `skipped` döner; giriş ve
 * silme akışları bu yüzden başarısız olmaz.
 */

export type AppleIdentityReport = {
  ok: boolean;
  linked?: boolean;
  revoked?: boolean;
  skipped?: string | null;
  error?: string;
};

function toReport(data: AppleIdentityReport | null): AppleIdentityReport {
  if (!data) {
    return { ok: false, error: 'empty_response' };
  }
  return data;
}

/**
 * Apple girişinden dönen yetki kodunu yenileme jetonuna çevirip saklar.
 * Giriş akışını bloklamaz: başarısız olsa da oturum açılmış olarak kalır.
 */
export async function linkAppleIdentity(code: string): Promise<Result<AppleIdentityReport>> {
  if (!code.trim()) {
    return fail(appError('invalid_input'));
  }
  try {
    const { data, error } = await supabase.functions.invoke<AppleIdentityReport>('apple-token', {
      body: { action: 'link', code },
    });
    if (error) {
      return fail(appError('network'));
    }
    return ok(toReport(data));
  } catch {
    return fail(appError('network'));
  }
}

/**
 * Hesap silmeden önce Apple jetonunu geri alır.
 *
 * `targetUserId` yalnızca gizlilik talebi yöneticileri için gönderilir; yetki
 * kontrolü sunucuda (`account_deletion_target_allowed`) yapılır.
 */
export async function revokeAppleIdentity(
  targetUserId?: string,
): Promise<Result<AppleIdentityReport>> {
  try {
    const { data, error } = await supabase.functions.invoke<AppleIdentityReport>('apple-token', {
      body: targetUserId ? { action: 'revoke', targetUserId } : { action: 'revoke' },
    });
    if (error) {
      return fail(appError('network'));
    }
    return ok(toReport(data));
  } catch {
    return fail(appError('network'));
  }
}
