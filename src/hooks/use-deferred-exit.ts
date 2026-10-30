import { useNavigation, type NavigationAction } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Kullanıcı onayından sonra ekrandan çıkışı güvenli biçimde tamamlar.
 *
 * `usePreventRemove` çıkışı engellediğinde engel durumu React state'inde
 * tutulur. Onay verildiği anda aynı karede `router.back()` veya
 * `navigation.dispatch(action)` çağırmak isteği yeniden engeller: kullanıcı
 * "Vazgeç" der, aynı onay penceresi yeniden açılır ve ekran hiç kapanmaz.
 *
 * Bu yüzden onaylanan çıkış bir sonraki commit'e ertelenir. Engel kalktıktan
 * sonra çalıştırılan fonksiyon tek seferliktir; aynı ekran yeniden açılsa bile
 * eski çıkış isteği tekrar tetiklenmez.
 */
export function useDeferredExit() {
  const navigation = useNavigation();
  const [approved, setApproved] = useState(false);
  const deferred = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!approved) {
      return;
    }
    const run = deferred.current;
    deferred.current = null;
    run?.();
  }, [approved]);

  /** Engel kalktıktan sonra verilen çıkış işini çalıştırır. */
  const exitAfterApproval = useCallback((run: () => void) => {
    deferred.current = run;
    setApproved(true);
  }, []);

  /** Engellenen gezinme hareketini onaydan sonra yeniden gönderir. */
  const dispatchAfterApproval = useCallback(
    (action: NavigationAction) => {
      deferred.current = () => navigation.dispatch(action);
      setApproved(true);
    },
    [navigation],
  );

  return { approved, exitAfterApproval, dispatchAfterApproval };
}
