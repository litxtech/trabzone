import { useQuery, useQueryClient } from '@tanstack/react-query';

import { fetchUsernameAvailability } from '@/features/profile/services/profile-service';
import { USERNAME_PATTERN } from '@/features/auth/validators';
import { useDebouncedValue } from '@/hooks/use-debounced-value';

/**
 * Kayıt ekranlarındaki kullanıcı adı kontrolü.
 *
 * Instagram'daki gibi davranır: biçim yazarken anında yerelde denetlenir, ağ
 * sorgusu yalnızca kısa bir duraklamadan (200 ms) sonra atılır ve sonuç yeşil
 * "kullanılabilir" ya da kırmızı "alınmış" notuyla gösterilir. Aynı kullanıcı
 * adı yeniden yazıldığında yanıt önbellekten anında gelir.
 */

/** Fonksiyonun izin verdiği biçimle aynı liste (bkz. is_username_available). */
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

export const USERNAME_DEBOUNCE_MS = 150;

export type UsernameCheckState =
  | 'empty'
  | 'short'
  | 'invalid'
  | 'reserved'
  | 'own'
  | 'checking'
  | 'available'
  | 'taken'
  | 'error';

export const usernameQueryKey = (username: string) => ['username-availability', username] as const;

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Sadece yerel denetim: ağ beklemeden anında sonuç. */
export function localUsernameIssue(
  raw: string,
): 'empty' | 'short' | 'invalid' | 'reserved' | null {
  const value = normalizeUsername(raw);
  if (value.length === 0) {
    return 'empty';
  }
  // Henüz yazılıyor: kırmızı uyarı yerine nötr ipucu gösterilir.
  if (value.length < 3) {
    return 'short';
  }
  if (!USERNAME_PATTERN.test(value)) {
    return 'invalid';
  }
  if (RESERVED_USERNAMES.has(value)) {
    return 'reserved';
  }
  return null;
}

export function useUsernameAvailability(
  rawUsername: string,
  options?: { ownUsername?: string | null },
) {
  const username = normalizeUsername(rawUsername);
  const ownUsername = options?.ownUsername ? normalizeUsername(options.ownUsername) : null;
  const localIssue = localUsernameIssue(username);
  const queryClient = useQueryClient();

  // Daha önce sorgulanmış ad: bekletmeden, önbellekten anında yanıtlanır.
  const cached =
    !localIssue && username !== ownUsername && username.length >= 3
      ? queryClient.getQueryData<boolean>(usernameQueryKey(username))
      : undefined;

  // Biçim hatalıyken ağa çıkılmaz; debounce süresi de boşa beklemez.
  const skipRemote = Boolean(localIssue) || username === ownUsername;
  const debounced = useDebouncedValue(
    skipRemote ? '' : username,
    cached === undefined ? USERNAME_DEBOUNCE_MS : 0,
  );

  const query = useQuery({
    queryKey: usernameQueryKey(debounced),
    queryFn: async ({ signal }) => {
      const result = await fetchUsernameAvailability(debounced, signal);
      if (!result.ok) {
        throw result.error;
      }
      return result.data;
    },
    enabled: debounced.length >= 3,
    // Aynı ad yeniden yazıldığında ağ isteği tekrarlanmaz.
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    retry: 1,
  });

  const resolved = query.data ?? (debounced === username ? cached : undefined);

  let state: UsernameCheckState;
  if (localIssue === 'empty') {
    state = 'empty';
  } else if (localIssue === 'short') {
    state = 'short';
  } else if (localIssue === 'invalid') {
    state = 'invalid';
  } else if (localIssue === 'reserved') {
    state = 'reserved';
  } else if (username === ownUsername) {
    // Kullanıcının kendi adı "alınmış" görünmemeli.
    state = 'own';
  } else if (query.isError) {
    state = 'error';
  } else if (username !== debounced || resolved === undefined) {
    // Kullanıcı hâlâ yazıyor ya da ilk yanıt bekleniyor.
    state = 'checking';
  } else {
    state = resolved ? 'available' : 'taken';
  }

  return {
    state,
    username,
    isAvailable: state === 'available' || state === 'own',
    /** Gönderimi engellemesi gereken durumlar. */
    isBlocking: state === 'invalid' || state === 'reserved' || state === 'taken',
    /** Aynı değeri elle yeniden sorgulamak için (ör. "tekrar dene"). */
    recheck: query.refetch,
  };
}

export const USERNAME_HINT: Record<UsernameCheckState, string> = {
  empty: 'En az 3 karakter; küçük harf, rakam, nokta, alt çizgi',
  short: 'En az 3 karakter',
  invalid: '3-24 karakter; yalnızca küçük harf, rakam, nokta ve alt çizgi',
  reserved: 'Bu kullanıcı adı ayrılmış, başka bir tane seç',
  own: 'Bu senin mevcut kullanıcı adın',
  checking: 'Kullanıcı adı kontrol ediliyor…',
  available: 'Bu kullanıcı adı kullanılabilir',
  taken: 'Bu kullanıcı adı alınmış, başka bir tane dene',
  error: 'Kullanıcı adı kontrol edilemedi, bağlantını kontrol et',
};

export const USERNAME_HINT_TONE = {
  empty: 'neutral',
  short: 'neutral',
  invalid: 'danger',
  reserved: 'danger',
  own: 'success',
  checking: 'neutral',
  available: 'success',
  taken: 'danger',
  error: 'danger',
} as const satisfies Record<UsernameCheckState, 'neutral' | 'success' | 'danger'>;

/**
 * Form gönderilirken son sözü sunucuya bırakır: canlı gösterge eskiyse taze
 * bir sorgu yapar. Ağ hatasında `unknown` döner; bu durumda kaydı engellemek
 * yerine `complete_registration` çağrısının sonucu beklenir.
 */
export async function ensureUsernameAvailable(
  rawUsername: string,
): Promise<'available' | 'taken' | 'unknown'> {
  const username = normalizeUsername(rawUsername);
  if (localUsernameIssue(username)) {
    return 'unknown';
  }
  const result = await fetchUsernameAvailability(username);
  if (!result.ok) {
    return 'unknown';
  }
  return result.data ? 'available' : 'taken';
}
