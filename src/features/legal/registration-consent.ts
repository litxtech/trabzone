import { appError } from '@/services/errors';
import { fail, ok, type Result } from '@/utils/result';

import { PUBLIC_LEGAL_PAGES } from './catalog';
import { fetchLegalDocuments, recordLegalAcceptance } from './services/legal-service';
import type { LegalSource } from './types';

/**
 * Kayıt sırasında onaylanan belgeler.
 *
 * Ürün kararı: sözleşme ve politikaların tamamı YALNIZCA kayıt ekranında
 * onaylanır; girişte ve sonraki ekranlarda tekrar sorulmaz. Yönetim panelinden
 * yeni bir belge yayınlanırsa kayıt ekranındaki liste ve onay kaydı da onu
 * otomatik kapsar.
 */
export const REGISTRATION_POLICY_SLUGS: string[] = PUBLIC_LEGAL_PAGES.map((page) => page.slug);

export type RegistrationConsentSource = Extract<
  LegalSource,
  'mobile_register' | 'web_register'
>;

export type RegistrationConsentResult = {
  accepted: string[];
  failed: string[];
};

/** Kullanım Koşulları önce yazılır: akışı durdurabilecek tek kayıt odur. */
function orderSlugs(slugs: string[]): string[] {
  return Array.from(new Set(slugs)).sort((a, b) => {
    if (a === b) return 0;
    if (a === 'terms') return -1;
    if (b === 'terms') return 1;
    return 0;
  });
}

/**
 * Kayıt formunda tek seferde alınan onayı yayındaki tüm belgeler için yazar.
 *
 * Belgeler sunucudan okunur; böylece panelden eklenen yeni politikalar da ilk
 * kayıtta kapsanır. Ağ hatasında yerleşik kataloğa düşülür. Tek tek belge
 * hataları kaydı durdurmaz (yayından kaldırılmış bir belge olabilir);
 * Kullanım Koşulları yazılamazsa çağıran akış hata gösterir.
 */
export async function recordRegistrationConsents(input: {
  source: RegistrationConsentSource;
  userAgent?: string | null;
}): Promise<Result<RegistrationConsentResult>> {
  const published = await fetchLegalDocuments('tr');
  const slugs = orderSlugs(
    published.ok && published.data.length > 0
      ? published.data.map((doc) => doc.slug)
      : REGISTRATION_POLICY_SLUGS,
  );

  const outcomes = await Promise.all(
    slugs.map(async (slug) => {
      const result = await recordLegalAcceptance({
        slug,
        action: 'accepted',
        source: input.source,
        userAgent: input.userAgent ?? null,
      });
      if (!result.ok) {
        console.warn(`[legal] Kayıt onayı yazılamadı: ${slug}`, result.error.message);
      }
      return { slug, ok: result.ok };
    }),
  );

  const accepted = outcomes.filter((item) => item.ok).map((item) => item.slug);
  const failed = outcomes.filter((item) => !item.ok).map((item) => item.slug);

  if (failed.includes('terms')) {
    return fail(
      appError('unknown', 'Kullanım Koşulları onayı kaydedilemedi. Lütfen tekrar dene.'),
    );
  }

  return ok({ accepted, failed });
}
