import { create } from 'zustand';

type InAppBrowserState = {
  visible: boolean;
  url: string | null;
  title: string | null;
  /** Aynı adres yeniden açıldığında sayfanın baştan yüklenmesi için artar. */
  session: number;
  /** Kartın açıldığı an (ms). Açılışın artık dokunuşlarını elemek için. */
  openedAt: number;
  open: (url: string, title?: string | null) => void;
  close: () => void;
};

/**
 * Kart kapanırken içerik kaybolmasın diye `url` kapanışta silinmez; yalnızca
 * `visible` düşer. Sonraki açılış yeni bir oturumla sayfayı yeniden yükler.
 */
export const useInAppBrowserStore = create<InAppBrowserState>()((set) => ({
  visible: false,
  url: null,
  title: null,
  session: 0,
  openedAt: 0,
  open: (url, title = null) =>
    set((state) => ({
      visible: true,
      url,
      title,
      session: state.session + 1,
      openedAt: Date.now(),
    })),
  close: () => set({ visible: false }),
}));
