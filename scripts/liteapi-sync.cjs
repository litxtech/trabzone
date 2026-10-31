/**
 * LiteAPI otel senkronu için yerel CLI.
 *
 * Kullanım:
 *   node scripts/liteapi-sync.cjs test        # ilk 10 tesis (şehir + yarıçap)
 *   node scripts/liteapi-sync.cjs full        # Trabzon ilinin tamamı
 *   node scripts/liteapi-sync.cjs full 25     # sayfa boyutu 25
 *
 * Anahtar ve Supabase servis rolü `.env` dosyasından okunur. Bu betik
 * Vercel'e deploy edilmez; yalnızca operatörün kendi makinesinde çalışır.
 */

const { readFileSync } = require('node:fs');
const { join } = require('node:path');

function loadEnv() {
  const raw = readFileSync(join(process.cwd(), '.env'), 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnv();

const { runSyncBatch } = require('../server/liteapi/sync');

async function main() {
  const mode = process.argv[2] === 'full' ? 'full' : 'test';
  const pageSize = Number(process.argv[3]) || (mode === 'test' ? 10 : 25);

  let phase = 'city';
  let cursor = 0;
  let runId = null;
  let batches = 0;
  const totals = { scanned: 0, inserted: 0, updated: 0, linked: 0, skipped: 0, failed: 0 };

  for (;;) {
    const result = await runSyncBatch({
      mode,
      limit: pageSize,
      cursor,
      phase,
      runId,
      label: 'cli',
    });
    batches += 1;
    runId = result.runId;

    for (const key of Object.keys(totals)) {
      totals[key] += result.counts?.[key] ?? 0;
    }

    console.log(
      `[${batches}] faz=${result.phase} sonraki=${result.nextPhase}:${result.nextCursor} ` +
        `eklenen=${result.counts.inserted} güncellenen=${result.counts.updated} ` +
        `atlanan=${result.counts.skipped} hatalı=${result.counts.failed} ` +
        `(toplam sağlayıcı kaydı ~${result.totalAvailable})`,
    );

    if (!result.hasMore) break;

    phase = result.nextPhase;
    cursor = result.nextCursor;

    // Sağlayıcı hız limitine saygı.
    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  console.log('\nBitti. Run:', runId);
  console.log(JSON.stringify(totals, null, 2));
}

main().catch((error) => {
  console.error('Senkron başarısız:', error?.message || error);
  if (error?.code) console.error('kod:', error.code);
  process.exitCode = 1;
});
