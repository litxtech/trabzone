/**
 * Trabzone yerel sayı biçimi: 128 · 1,2 B · 24,6 B · 1,4 Mn · 2,1 Mr
 * `B` = bin, `Mn` = milyon, `Mr` = milyar.
 */
export function formatViewCount(value: number | null | undefined): string {
  const raw = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 0;
  const count = Math.max(0, raw);
  if (count < 1000) {
    return groupThousands(count);
  }
  if (count < 1_000_000) {
    return `${scaled(count / 1000)} B`;
  }
  if (count < 1_000_000_000) {
    return `${scaled(count / 1_000_000)} Mn`;
  }
  return `${scaled(count / 1_000_000_000)} Mr`;
}

function scaled(value: number): string {
  const rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return String(rounded).replace('.', ',');
}

function groupThousands(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** Ekran okuyucular için tam sayı; kısaltılmış biçim yerine okunur hâli. */
export function spokenViewCount(value: number | null | undefined): string {
  const count = typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return `${groupThousands(count)} tekil görüntüleme`;
}
