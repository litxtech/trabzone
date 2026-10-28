import * as Clipboard from 'expo-clipboard';
import { Alert, Platform, Share } from 'react-native';

/**
 * Paylaşım sonucu. Sayaç yalnızca gerçekten paylaşılan veya panoya kopyalanan
 * içerikte artırılır; kullanıcı paylaşım penceresini kapattıysa artmaz.
 */
export type ShareOutcome = 'shared' | 'copied' | 'dismissed' | 'unavailable';

export type ShareInput = {
  title?: string;
  message: string;
  url?: string;
};

export function didShare(outcome: ShareOutcome): boolean {
  return outcome === 'shared' || outcome === 'copied';
}

let toastElement: HTMLElement | null = null;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Web'de alt ortada kısa süre görünen bildirim.
 *
 * Bağlantı panoya kopyalandığında hiçbir görsel geri bildirim yoktu; kullanıcı
 * butona bastığında yalnızca sayaç artıyor gibi görünüyordu.
 */
function showWebToast(text: string): void {
  if (typeof document === 'undefined') {
    return;
  }
  if (!toastElement || !toastElement.isConnected) {
    toastElement = document.createElement('div');
    toastElement.setAttribute('role', 'status');
    toastElement.setAttribute('aria-live', 'polite');
    Object.assign(toastElement.style, {
      position: 'fixed',
      left: '50%',
      bottom: '28px',
      transform: 'translateX(-50%)',
      zIndex: '2147483000',
      maxWidth: 'calc(100vw - 32px)',
      padding: '11px 18px',
      borderRadius: '999px',
      background: 'rgba(11, 16, 32, 0.96)',
      border: '1px solid rgba(140, 170, 235, 0.28)',
      boxShadow: '0 12px 32px rgba(0, 0, 0, 0.32)',
      color: '#FFFFFF',
      fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
      fontSize: '13px',
      fontWeight: '600',
      lineHeight: '18px',
      textAlign: 'center',
      pointerEvents: 'none',
      opacity: '0',
      transition: 'opacity 180ms ease',
    } as Partial<CSSStyleDeclaration>);
    document.body.appendChild(toastElement);
  }

  toastElement.textContent = text;
  requestAnimationFrame(() => {
    if (toastElement) {
      toastElement.style.opacity = '1';
    }
  });

  if (toastTimer) {
    clearTimeout(toastTimer);
  }
  toastTimer = setTimeout(() => {
    if (toastElement) {
      toastElement.style.opacity = '0';
    }
  }, 2400);
}

/** `navigator.clipboard` bir kullanıcı hareketi ve güvenli bağlam ister. */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await Clipboard.setStringAsync(text);
    return true;
  } catch {
    // devam: eski tarayıcı yolu
  }
  if (typeof document === 'undefined') {
    return false;
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '0';
    area.style.left = '-9999px';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

async function shareOnWeb({ title, message, url }: ShareInput): Promise<ShareOutcome> {
  // Bağlantı metnin içinde zaten varsa ikinci kez eklenmez: aksi halde
  // paylaşım sayfasında adres iki kez görünür.
  const text = url && !message.includes(url) ? `${message}\n\n${url}` : message;
  const share = (globalThis.navigator as (Navigator & { share?: unknown }) | undefined)?.share;

  if (typeof share === 'function') {
    try {
      // Yalnızca `text` verilir; `url` ayrıca geçildiğinde bağlantı tekrarlanır.
      await (share as unknown as (data: { title?: string; text?: string }) => Promise<void>).call(
        globalThis.navigator,
        { text, ...(title ? { title } : {}) },
      );
      return 'shared';
    } catch (error) {
      // Kullanıcı paylaşım sayfasını kapattı: kopyalama yoluna düşmeyiz.
      if ((error as { name?: string } | undefined)?.name === 'AbortError') {
        return 'dismissed';
      }
    }
  }

  if (await copyToClipboard(url || text)) {
    showWebToast('Bağlantı kopyalandı');
    return 'copied';
  }

  // Son çare: bağlantıyı seçilebilir biçimde göster.
  Alert.alert('Bağlantıyı paylaş', text);
  return 'unavailable';
}

/**
 * iOS, Android ve web için tek paylaşım giriş noktası.
 *
 * - Web: Web Share API varsa onu kullanır; yoksa bağlantıyı panoya kopyalar ve
 *   bunu kullanıcıya bildirir.
 * - Mobil: yerel paylaşım sayfasını açar. Kullanıcı kapatırsa `dismissed`
 *   döner ve paylaşım sayacı artmaz.
 */
export async function shareContent(input: ShareInput): Promise<ShareOutcome> {
  const title = (input.title ?? '').trim();
  const url = input.url?.trim();
  const message = input.message.trim();

  if (Platform.OS === 'web') {
    return shareOnWeb({ title, message, url });
  }

  try {
    const result = await Share.share(
      {
        title: title || undefined,
        message: url && !message.includes(url) ? `${message}\n\n${url}` : message,
        url,
      },
      title ? { dialogTitle: title } : undefined,
    );
    return result.action === Share.sharedAction ? 'shared' : 'dismissed';
  } catch {
    // Paylaşım sayfası açılamazsa bağlantıyı kopyalayarak kullanıcıyı
    // çıkmazda bırakmayız.
    return (await copyToClipboard(url || message)) ? 'copied' : 'unavailable';
  }
}
