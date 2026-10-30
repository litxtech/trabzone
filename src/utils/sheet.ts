/**
 * Alt sayfa (ActionSheet / Modal) kapanışı ile yeni bir modal açılışını ayırır.
 *
 * Aynı dokunuşta hem menüyü kapatıp hem ikinci bir modal açmak iOS ve
 * Android'de yeni modalın açılıp anında kapanmasına ("sönmesi") yol açıyor:
 * iki modal aynı anda yönetilemiyor. Kapanış animasyonu bitene kadar beklemek
 * bu çakışmayı ortadan kaldırır.
 */
export const SHEET_DISMISS_MS = 340;

/** Menü kapandıktan sonra `run` çağrısını güvenli biçimde planlar. */
export function afterSheetDismiss(run: () => void, delay = SHEET_DISMISS_MS): void {
  setTimeout(run, delay);
}
