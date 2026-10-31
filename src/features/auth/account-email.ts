/**
 * Apple "Gizli E-posta" (private relay) yardımcıları.
 *
 * Kullanıcı Apple'ın izin ekranında "E-postamı Gizle" seçeneğini seçtiğinde
 * Apple gerçek adresi hiçbir zaman paylaşmaz; bunun yerine
 * `<rastgele>@privaterelay.appleid.com` biçiminde, çalışan ama kullanıcıya
 * anlamsız görünen bir vekil adres döner. Bu adresin yerel kısmı rastgele
 * üretildiği için kullanıcı adı ya da ad-soyad türetmek için de kullanılamaz.
 */
const APPLE_RELAY_DOMAIN = '@privaterelay.appleid.com';

export function isApplePrivateRelayEmail(email: string | null | undefined): boolean {
  return typeof email === 'string' && email.trim().toLowerCase().endsWith(APPLE_RELAY_DOMAIN);
}

export type AccountEmailDisplay = {
  email: string | null;
  /** Apple gizli e-posta adresi: arayüzde "bozuk adres" gibi görünmemeli. */
  isAppleRelay: boolean;
  /** Adresin altında gösterilecek açıklama. */
  hint: string | null;
};

/**
 * E-posta adresini arayüzde gösterilecek biçime çevirir.
 *
 * Gizli relay adresi olduğu gibi gösterildiğinde kullanıcı bunu hatalı bir
 * kayıt sanıyordu. Adres korunur (bildirimler oraya gider, yanıt da çalışır)
 * ama ne olduğu açıklanır ve gerçek adresini ekleyebileceği yer söylenir.
 */
export function accountEmailDisplay(email: string | null | undefined): AccountEmailDisplay {
  const value = typeof email === 'string' && email.trim() ? email.trim() : null;
  const isAppleRelay = isApplePrivateRelayEmail(value);
  return {
    email: value,
    isAppleRelay,
    hint: isAppleRelay
      ? 'Apple gizli e-posta kullandı. Gerçek adresini Ayarlar → Hesap bölümünden ekleyebilirsin.'
      : null,
  };
}

/** Sunucudaki `is_username_available` ile aynı ayrılmış adlar. */
const RESERVED_USERNAMES = new Set([
  'admin',
  'trabzone',
  'support',
  'help',
  'marketplace',
  'official',
  'moderator',
  'root',
  'system',
]);

/**
 * E-posta adresinden kullanıcı adı önerisi üretir.
 *
 * Yalnızca gerçek adreslerde denenir: relay adresinin yerel kısmı rastgele
 * olduğu için (`cg6mnhk2js`) kullanıcı adı olarak sunulmaz. Üretilen değer
 * `is_username_available` kuralıyla aynı biçimde olmalıdır; ayrılmış adlar
 * (ör. `support@...`) önerilmez çünkü kayıt sunucuda reddedilirdi.
 */
export function usernameFromEmail(email: string | null | undefined): string | null {
  if (typeof email !== 'string' || isApplePrivateRelayEmail(email)) {
    return null;
  }
  const local = email.split('@')[0]?.toLowerCase() ?? '';
  const slug = local
    .replace(/[^a-z0-9_.]/g, '')
    .replace(/^[._]+/, '')
    .replace(/[._]+$/, '')
    .slice(0, 24);
  if (!/^[a-z0-9_.]{3,24}$/.test(slug) || RESERVED_USERNAMES.has(slug)) {
    return null;
  }
  return slug;
}
