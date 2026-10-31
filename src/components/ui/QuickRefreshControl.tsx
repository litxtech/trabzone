import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshControl, type RefreshControlProps } from 'react-native';

/**
 * Telegram benzeri kısa yenileme göstergesi.
 *
 * Ağ isteği (refetch) ne kadar sürerse sürsün, dönen yenileme simgesi en fazla
 * MAX_VISIBLE_MS kadar görünür ve liste kendini bırakır; veri arkada gelmeye
 * devam eder. Tam tersi durumda (istek çok hızlı biterse) simge en az
 * MIN_VISIBLE_MS görünür, böylece göz kırpma olmaz.
 */
const MIN_VISIBLE_MS = 220;
const MAX_VISIBLE_MS = 550;

export type QuickRefreshControlProps = Omit<RefreshControlProps, 'refreshing' | 'onRefresh'> & {
  refreshing: boolean;
  onRefresh?: () => void;
};

export function QuickRefreshControl({ refreshing, onRefresh, ...rest }: QuickRefreshControlProps) {
  const [visible, setVisible] = useState(false);
  const visibleRef = useRef(false);
  const shownAt = useRef(0);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearHide = useCallback(() => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }, []);

  const setShown = useCallback((value: boolean) => {
    visibleRef.current = value;
    setVisible(value);
  }, []);

  // Kullanıcı listeyi çektiğinde simgeyi hemen göster ve üst süreyi başlat.
  const handleRefresh = useCallback(() => {
    shownAt.current = Date.now();
    setShown(true);
    clearHide();
    hideTimer.current = setTimeout(() => {
      hideTimer.current = null;
      setShown(false);
    }, MAX_VISIBLE_MS);
    onRefresh?.();
  }, [clearHide, onRefresh, setShown]);

  // Yenileme erken bittiyse simgenin göz kırpmasını önlemek için kalan en kısa
  // görünme süresini tamamla.
  useEffect(() => {
    if (refreshing || !visibleRef.current) {
      return;
    }
    clearHide();
    const elapsed = Date.now() - shownAt.current;
    hideTimer.current = setTimeout(() => {
      hideTimer.current = null;
      setShown(false);
    }, Math.max(0, MIN_VISIBLE_MS - elapsed));
  }, [refreshing, clearHide, setShown]);

  useEffect(() => clearHide, [clearHide]);

  return <RefreshControl {...rest} refreshing={visible} onRefresh={handleRefresh} />;
}
