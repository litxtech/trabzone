import { Platform } from 'react-native';

const SHELL_ID = 'tz-shell';

/**
 * `scripts/generate-seo.mjs` tarafından `index.html`'e yazılan statik açılış
 * kabuğunu (ana sayfada hero, diğer rotalarda yükleniyor ekranı) kaldırır.
 * Kabuk `#root` dışında sabit bir katman olduğu için React onu kendisi silmez.
 */
export function dismissBootShell() {
  if (Platform.OS !== 'web' || typeof document === 'undefined') {
    return;
  }
  const shell = document.getElementById(SHELL_ID);
  const unlock = () => document.documentElement.classList.remove('tz-shell-on');
  if (!shell) {
    unlock();
    return;
  }
  // İlk React karesi boyandıktan sonra kabuk yumuşakça kaybolur.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      shell.classList.add('tz-shell--out');
      unlock();
      window.setTimeout(() => shell.remove(), 220);
    });
  });
}
