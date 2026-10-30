import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ComponentRef, type RefObject } from 'react';
import { AppState, Dimensions, Platform, type View } from 'react-native';

import { recordAdClick, recordAdImpression } from './services/ads-service';

/** Aynı sunum kaydı için tekrar istek atılmaz (liste hücresi yeniden bağlansa da). */
const impressed = new Set<string>();
const clicked = new Set<string>();

const POLL_MS = 250;

/**
 * AdImpressionTracker: reklamın en az `minRatio` kadarı kesintisiz `minMs`
 * süre ekranda kaldığında tek bir gösterim bildirir. Sadece çizilmiş olmak
 * gösterim sayılmaz. Ekran odakta değilse veya uygulama arka plandaysa
 * sayaç sıfırlanır. Sunucu aynı eşikleri ayrıca doğrular.
 */
export function useAdImpressionTracker(
  ref: RefObject<ComponentRef<typeof View> | null>,
  input: { serveId: string | null; minRatio: number; minMs: number; enabled?: boolean },
) {
  const { serveId, enabled = true } = input;
  const minRatio = Math.max(0.5, input.minRatio);
  const minMs = Math.max(1000, input.minMs);
  const [focused, setFocused] = useState(true);
  const visibleSince = useRef<number | null>(null);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  useEffect(() => {
    if (!serveId || !enabled || !focused || impressed.has(serveId)) {
      return;
    }
    visibleSince.current = null;
    let stopped = false;

    const report = (now: number) => {
      if (impressed.has(serveId)) {
        return;
      }
      impressed.add(serveId);
      const visibleMs = now - (visibleSince.current ?? now);
      void recordAdImpression(serveId, visibleMs).then((result) => {
        // Ağ hatasında aynı sunum ileride yeniden denenebilir.
        if (!result.ok) {
          impressed.delete(serveId);
        }
      });
    };

    const observe = (ratio: number) => {
      const now = Date.now();
      const appActive = AppState.currentState === 'active';
      if (ratio >= minRatio && appActive) {
        if (visibleSince.current == null) {
          visibleSince.current = now;
        } else if (now - visibleSince.current >= minMs) {
          report(now);
          return true;
        }
      } else {
        visibleSince.current = null;
      }
      return false;
    };

    if (Platform.OS === 'web' && typeof IntersectionObserver !== 'undefined') {
      const node = ref.current as unknown as Element | null;
      if (!node) {
        return;
      }
      let ratio = 0;
      const observer = new IntersectionObserver(
        (entries) => {
          ratio = entries[entries.length - 1]?.intersectionRatio ?? 0;
        },
        { threshold: [0, 0.25, 0.5, 0.75, 1] },
      );
      observer.observe(node);
      const timer = setInterval(() => {
        const visible = typeof document === 'undefined' || document.visibilityState === 'visible';
        if (observe(visible ? ratio : 0)) {
          clearInterval(timer);
          observer.disconnect();
        }
      }, POLL_MS);
      return () => {
        clearInterval(timer);
        observer.disconnect();
      };
    }

    const timer = setInterval(() => {
      const node = ref.current;
      if (!node || stopped) {
        return;
      }
      node.measureInWindow((x, y, width, height) => {
        if (stopped || width <= 0 || height <= 0) {
          return;
        }
        const window = Dimensions.get('window');
        const visibleHeight = Math.max(0, Math.min(y + height, window.height) - Math.max(y, 0));
        const visibleWidth = Math.max(0, Math.min(x + width, window.width) - Math.max(x, 0));
        const ratio = (visibleHeight * visibleWidth) / (height * width);
        if (observe(ratio)) {
          stopped = true;
          clearInterval(timer);
        }
      });
    }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [enabled, focused, minMs, minRatio, ref, serveId]);
}

/**
 * AdClickTracker: tıklama sunucuya iletilir, yönlendirme beklemez. Sunucu
 * tıklamayı geçerli bir gösterim ve hız limitleriyle doğrular.
 */
export function trackAdClick(serveId: string) {
  if (clicked.has(serveId)) {
    return;
  }
  clicked.add(serveId);
  impressed.add(serveId);
  void recordAdClick(serveId).then((result) => {
    if (!result.ok) {
      clicked.delete(serveId);
    }
  });
}
