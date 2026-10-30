import { useEffect, useState } from 'react';

import { countdownClock } from '../utils/format';

/**
 * Maç başlangıcına geri sayım.
 *
 * Son bir saatte saniye saniye işler; daha uzak maçlarda dakikada bir
 * güncellenir. Böylece saniye göstergesi canlı hissi verirken uzak maçlarda
 * gereksiz render üretilmez.
 */
export function useCountdown(iso: string | null | undefined, enabled = true): string | null {
  const target = iso ? new Date(iso).getTime() : Number.NaN;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled || !Number.isFinite(target)) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      const remaining = target - Date.now();
      if (remaining <= 0) return;
      timer = setTimeout(
        () => {
          setNow(Date.now());
          schedule();
        },
        remaining <= 3_600_000 ? 1_000 : 30_000,
      );
    };

    schedule();
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [enabled, target]);

  if (!enabled || !Number.isFinite(target) || !iso) return null;
  return countdownClock(iso, now);
}
