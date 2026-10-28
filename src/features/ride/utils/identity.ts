import type {
  RideMemberProfile,
  Verification,
  VerificationKind,
  VerificationStatus,
} from '../types';

/**
 * Yolculuk kimlik durumu tek yerden okunur.
 *
 * `ride_member_profiles.identity_status` geçmişte belge kaydıyla
 * senkronsuz kalabiliyordu: yönetici kimlik belgesini onayladığı hâlde
 * kullanıcı "doğrulanmadı" görünüyor ve tekrar belge yüklemesi isteniyordu.
 * Bu yardımcı önce onaylı belge kaydına bakar; profil alanı yalnızca
 * geriye dönük uyumluluk için yedek kabul edilir.
 */

export type EffectiveIdentityStatus =
  | 'unverified'
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'expired';

export const VERIFICATION_PURPOSE: Record<VerificationKind, string> = {
  identity: 'Yolculuk paylaşımı ve rezervasyon',
  driver_license: 'Sürücü olarak ilan yayınlama',
  insurance: 'Araç ve yolculuk sigortası',
  transport_license: 'Ticari taşımacılık yetkisi',
};

export const VERIFICATION_REQUIREMENT: Record<VerificationKind, string> = {
  identity: 'Hem yolcu hem sürücü için zorunlu. Bir kez onaylanır, tekrar istenmez.',
  driver_license: 'Sürücü olarak ilan yayınlamak için zorunlu.',
  insurance: 'Garajdaki aracın onaylanması için zorunlu.',
  transport_license: 'Yalnızca ticari taşımacılık yapacaksan gerekli.',
};

const VERIFICATION_KINDS: VerificationKind[] = [
  'identity',
  'driver_license',
  'insurance',
  'transport_license',
];

function endOfDay(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const date = new Date(`${value.slice(0, 10)}T23:59:59`);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

/** Onaylı bir belgenin süresi bugünün sonunda dolmuşsa `expired` döner. */
export function effectiveVerificationStatus(
  verification: Verification | null | undefined,
  now = Date.now(),
): VerificationStatus {
  if (!verification) {
    return 'expired';
  }
  if (verification.status !== 'approved') {
    return verification.status;
  }
  const expiry = endOfDay(verification.expires_at);
  return expiry != null && expiry < now ? 'expired' : 'approved';
}

/** Sunucu en yeni kaydı başa koyar; ilk eşleşme güncel kayıttır. */
export function latestVerification(
  profile: RideMemberProfile | null | undefined,
  kind: VerificationKind,
): Verification | null {
  return profile?.verifications.find((item) => item.kind === kind) ?? null;
}

export function effectiveIdentityStatus(
  profile: RideMemberProfile | null | undefined,
  now = Date.now(),
): EffectiveIdentityStatus {
  if (!profile) {
    return 'unverified';
  }
  const identity = latestVerification(profile, 'identity');
  if (identity) {
    const status = effectiveVerificationStatus(identity, now);
    return status === 'expired' && profile.identity_status === 'approved'
      ? 'expired'
      : status;
  }
  return profile.identity_status;
}

export function isIdentityVerified(
  profile: RideMemberProfile | null | undefined,
  now = Date.now(),
): boolean {
  return effectiveIdentityStatus(profile, now) === 'approved';
}

export function identityVerifiedAt(profile: RideMemberProfile | null | undefined): string | null {
  const identity = latestVerification(profile, 'identity');
  if (!identity || effectiveVerificationStatus(identity) !== 'approved') {
    return profile?.identity_verified_at ?? null;
  }
  return identity.reviewed_at ?? identity.created_at;
}

export function identityExpiresAt(profile: RideMemberProfile | null | undefined): string | null {
  return latestVerification(profile, 'identity')?.expires_at ?? null;
}

/** Doğrulama gerektiren ilk belge; hepsi onaylıysa `null`. */
export function nextVerificationKind(
  profile: RideMemberProfile | null | undefined,
): VerificationKind | null {
  if (!profile) {
    return 'identity';
  }
  for (const kind of VERIFICATION_KINDS) {
    const verification = latestVerification(profile, kind);
    const status = verification ? effectiveVerificationStatus(verification) : 'unverified';
    if (status !== 'approved') {
      return kind;
    }
  }
  return null;
}

export function metaText(
  meta: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  const value = meta?.[key];
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** TC kimlik numarasını ekranda göstermek için maskeler. */
export function maskDocumentNo(value: string | null | undefined): string | null {
  const digits = (value ?? '').replace(/\D/g, '');
  if (digits.length < 5) {
    return value ?? null;
  }
  return `${digits.slice(0, 2)}${'•'.repeat(Math.max(digits.length - 6, 3))}${digits.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// Türkiye tarih formatı (GG.AA.YYYY) ve kimlik alanı doğrulaması
// ---------------------------------------------------------------------------

/** Yazarken noktaları otomatik ekler; en fazla 8 rakam tutar. */
export function formatTrDateInput(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) {
    return digits;
  }
  if (digits.length <= 4) {
    return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  }
  return `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4)}`;
}

/** GG.AA.YYYY metnini doğrular ve veritabanının beklediği YYYY-MM-DD'ye çevirir. */
export function trDateToIso(value: string): string | null {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value.trim());
  if (!match) {
    return null;
  }
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${match[3]}-${match[2]}-${match[1]}`;
}

export function isoToTrDate(value: string | null | undefined): string {
  if (!value) {
    return '';
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : '';
}

/** T.C. Kimlik Numarası algoritması (11 hane, ilk hane sıfır olamaz). */
export function isValidTckn(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  if (!/^[1-9]\d{10}$/.test(digits)) {
    return false;
  }
  const numbers = digits.split('').map(Number);
  const odd = numbers[0]! + numbers[2]! + numbers[4]! + numbers[6]! + numbers[8]!;
  const even = numbers[1]! + numbers[3]! + numbers[5]! + numbers[7]!;
  const tenth = (odd * 7 - even) % 10;
  if (tenth !== numbers[9]) {
    return false;
  }
  const total = numbers.slice(0, 10).reduce((sum, item) => sum + item, 0);
  return total % 10 === numbers[10];
}

/** Kimlik formundaki ad soyad alanlarını tek metne indirger. */
export function fullName(firstName: string, lastName: string): string {
  return `${firstName.trim()} ${lastName.trim()}`.trim();
}

export function splitFullName(value: string | null | undefined): {
  firstName: string;
  lastName: string;
} {
  const parts = (value ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return { firstName: '', lastName: '' };
  }
  if (parts.length === 1) {
    return { firstName: parts[0]!, lastName: '' };
  }
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts.at(-1)! };
}
