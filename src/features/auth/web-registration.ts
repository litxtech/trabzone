import { Platform } from 'react-native';

import { recordLegalAcceptance, setConsent } from '@/features/legal/services/legal-service';
import { setBirthDate } from '@/features/safety/services/safety-service';
import { appError } from '@/services/errors';
import { supabase } from '@/services/supabase/client';
import { fail, ok, type Result } from '@/utils/result';

/**
 * Web kayıt formunda toplanan sözleşme, yaş ve isteğe bağlı rıza beyanlarını
 * oturum oluştuktan sonra sunucuya yazar.
 *
 * E-posta doğrulaması açıksa kayıt anında oturum olmaz; bu nedenle beyanlar
 * kullanıcı metadata'sında taşınır ve doğrulama sonrası bu fonksiyon çalışır.
 * Aynı işlem tekrar çağrılsa bile kayıtlar idempotenttir.
 */
export async function applyWebRegistrationMetadata(): Promise<Result<null>> {
  const { data, error } = await supabase.auth.getUser();
  if (error) {
    return fail(appError('unknown', error.message));
  }
  const meta = (data.user?.user_metadata ?? {}) as Record<string, unknown>;
  const userAgent =
    Platform.OS === 'web' && typeof navigator !== 'undefined' ? navigator.userAgent : null;

  const birthDate = typeof meta.birth_date === 'string' ? meta.birth_date : null;
  if (birthDate) {
    const result = await setBirthDate(birthDate);
    if (!result.ok) {
      return result;
    }
  }

  if (meta.accepted_terms === true) {
    const result = await recordLegalAcceptance({
      slug: 'terms',
      source: 'web_register',
      userAgent,
    });
    if (!result.ok) {
      return result;
    }
  }

  if (meta.accepted_guidelines === true) {
    const result = await recordLegalAcceptance({
      slug: 'community-guidelines',
      source: 'web_register',
      userAgent,
    });
    if (!result.ok) {
      return result;
    }
  }

  // Bilgilendirme metinleri kabul değil, "sunuldu" olarak kaydedilir.
  for (const slug of ['privacy', 'kvkk', 'data-protection', 'child-safety', 'account-deletion']) {
    const result = await recordLegalAcceptance({
      slug,
      action: 'presented',
      source: 'web_register',
      userAgent,
    });
    // Eski bir sürüm arşivlenmişse bu kayıt atlanabilir; kabul kayıtlarını
    // engellememesi için hata burada durdurulmaz.
    void result;
  }

  if (meta.marketing_opt_in === true) {
    await setConsent({ purpose: 'marketing_email', granted: true, source: 'web_register' });
  }
  if (meta.analytics_opt_in === true) {
    await setConsent({ purpose: 'product_analytics', granted: true, source: 'web_register' });
  }

  return ok(null);
}
