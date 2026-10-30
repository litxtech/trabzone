import { openUrl } from '@/features/in-app-browser';
import { shareLink } from '@/features/share/links';

export type TextToken =
  | { type: 'text'; value: string }
  | { type: 'link'; value: string; href: string };

const URL_PATTERN = /(https?:\/\/[^\s<>"']+)/gi;
const TRAILING = /[.,;:!?)\]}]+$/;

/** Sadece http(s) bağlantıları tıklanabilir hale getirir. */
export function tokenizeComment(body: string): TextToken[] {
  if (!body) {
    return [];
  }

  const tokens: TextToken[] = [];
  let lastIndex = 0;
  for (const match of body.matchAll(URL_PATTERN)) {
    const raw = match[0];
    const index = match.index ?? 0;
    const trimmed = raw.replace(TRAILING, '');
    if (trimmed.length <= 8) {
      continue;
    }
    const href = normalizeHttps(trimmed);
    if (!href) {
      continue;
    }
    if (index > lastIndex) {
      tokens.push({ type: 'text', value: body.slice(lastIndex, index) });
    }
    tokens.push({ type: 'link', value: trimmed, href });
    lastIndex = index + trimmed.length;
    // Sondaki noktalama metin olarak kalır.
    if (raw.length > trimmed.length) {
      tokens.push({ type: 'text', value: raw.slice(trimmed.length) });
      lastIndex += raw.length - trimmed.length;
    }
  }

  if (lastIndex < body.length) {
    tokens.push({ type: 'text', value: body.slice(lastIndex) });
  }
  return tokens.length > 0 ? tokens : [{ type: 'text', value: body }];
}

function normalizeHttps(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return null;
    }
    // Kimlik bilgisi içeren aldatıcı bağlantılar açılmaz.
    if (url.username || url.password) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Var olan web/derin bağlantı rotasını kullanır. Paylaşım adresi `/p/...`
 * biçimindedir: uygulama yüklüyse doğrudan ilgili gönderi/reels açılır,
 * değilse önizleme kartı ve mağaza bağlantıları görünür.
 */
export function commentDeepLink(
  contentType: 'post' | 'reel' | 'match',
  contentKey: string,
  commentId: string,
): string {
  return shareLink(contentType, contentKey, { comment: commentId });
}

export async function openSafeLink(href: string): Promise<boolean> {
  const safe = normalizeHttps(href);
  if (!safe) {
    return false;
  }
  return openUrl(safe);
}
