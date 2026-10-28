/** Instagram/TikTok dilinde kisa sayi: 1.2B, 34.5K, 980. */
export function formatCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '0';
  }
  if (value < 1000) {
    return String(Math.round(value));
  }
  if (value < 1_000_000) {
    const scaled = value / 1000;
    return `${scaled >= 10 ? Math.round(scaled) : scaled.toFixed(1).replace('.0', '')}B`;
  }
  if (value < 1_000_000_000) {
    const scaled = value / 1_000_000;
    return `${scaled >= 10 ? Math.round(scaled) : scaled.toFixed(1).replace('.0', '')}Mn`;
  }
  return `${(value / 1_000_000_000).toFixed(1).replace('.0', '')}Mr`;
}

/** 0:07 / 1:24 biciminde sure etiketi. */
export function formatDuration(ms: number | null | undefined): string | null {
  if (!ms || ms < 0) {
    return null;
  }
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
