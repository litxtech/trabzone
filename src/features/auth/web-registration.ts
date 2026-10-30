import { Platform } from 'react-native';

import { recordRegistrationConsents } from '@/features/legal/registration-consent';
import { setConsent } from '@/features/legal/services/legal-service';
import { setBirthDate } from '@/features/safety/services/safety-service';
import { appError } from '@/services/errors';
import { supabase } from '@/services/supabase/client';
import { fail, ok, type Result } from '@/utils/result';

/**
 * Kayıt formunda toplanan sözleşme, yaş ve isteğe bağlı rıza beyanlarını
 * oturum oluştuktan sonra sunucuya yazar.
 *
 * Kayıt ekranındaki tek onay kutusu yayındaki TÜM sözleşme ve politikaları
 * kapsar. Bu nedenle onay verildiğinde her belge için ayrı `accepted` kaydı
 * oluşturulur; kullanıcı giriş yaptığında veya sonraki ekranlarda sözleşme
 * onayı yeniden sorulmaz.
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
  const source = Platform.OS === 'web' ? 'web_register' : 'mobile_register';

  const birthDate = typeof meta.birth_date === 'string' ? meta.birth_date : null;
  if (birthDate) {
    const result = await setBirthDate(birthDate);
    if (!result.ok) {
      return result;
    }
  }

  // Kayıt ekranında "tüm politikaları kabul ediyorum" işaretlendiyse bütün
  // yayındaki belgeler için kabul kaydı yazılır. Eski istemcilerden gelen
  // `accepted_guidelines` bayrağı da aynı kapsamı tetikler.
  if (meta.accepted_terms === true || meta.accepted_guidelines === true) {
    const consent = await recordRegistrationConsents({ source, userAgent });
    if (!consent.ok) {
      return fail(consent.error);
    }
  }

  // İsteğe bağlı rızaların kaynak listesi `consent_set` ile sınırlı:
  // mobil kayıt 'mobile_settings', web kayıt 'web_register' olarak yazılır.
  const consentSource = Platform.OS === 'web' ? 'web_register' : 'mobile_settings';
  if (meta.marketing_opt_in === true) {
    await setConsent({ purpose: 'marketing_email', granted: true, source: consentSource });
  }
  if (meta.analytics_opt_in === true) {
    await setConsent({ purpose: 'product_analytics', granted: true, source: consentSource });
  }

  return ok(null);
}
