import { useEffect } from 'react';

type ScrollToTopHandler = () => void;

/**
 * Alt menüde zaten seçili olan sekmeye yeniden basıldığında ilgili ekranı
 * başa saran köprü.
 *
 * Sekmeler `lazy` ile bir kez kurulup bağlı kaldığı için ekran kendi
 * listesinin referansını buraya kaydeder; menü de aynı isimle istek gönderir.
 * Böylece AppTabBar'ın herhangi bir ekranın listesine doğrudan erişmesi
 * gerekmez ve iki taraf birbirini import etmez.
 */
const handlers = new Map<string, Set<ScrollToTopHandler>>();

export function registerTabScrollTop(tab: string, handler: ScrollToTopHandler): () => void {
  const set = handlers.get(tab) ?? new Set<ScrollToTopHandler>();
  handlers.set(tab, set);
  set.add(handler);

  return () => {
    set.delete(handler);
    if (set.size === 0 && handlers.get(tab) === set) {
      handlers.delete(tab);
    }
  };
}

export function requestTabScrollTop(tab: string): boolean {
  const set = handlers.get(tab);
  if (!set || set.size === 0) {
    return false;
  }
  set.forEach((handler) => handler());
  return true;
}

/** Ekran bağlı kaldığı sürece kendi "başa sar" davranışını kaydeder. */
export function useTabScrollTop(tab: string, scrollToTop: ScrollToTopHandler) {
  useEffect(() => registerTabScrollTop(tab, scrollToTop), [tab, scrollToTop]);
}
