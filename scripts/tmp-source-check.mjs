// Aday haber kaynaklarının erişilebilirliğini doğrular (yalnızca durum kodu).
const domains = [
  'takagazete.com.tr', 'trabzonhaber.com.tr', '61saat.com', 'haber61.net',
  'trabzonumhaber.com', 'aa.com.tr', 'iha.com.tr', 'dha.com.tr',
  'hurriyet.com.tr', 'milliyet.com.tr', 'ntv.com.tr', 'trthaber.com',
  'trabzonspor.org.tr', 'tff.org', 'kgm.gov.tr', 'tarimorman.gov.tr',
  'akcaabat.bel.tr', 'yomra.bel.tr', 'arsin.bel.tr', 'arakli.bel.tr',
  'surmene.bel.tr', 'of.bel.tr', 'caykara.bel.tr', 'dernekpazari.bel.tr',
  'hayrat.bel.tr', 'macka.bel.tr', 'duzkoy.bel.tr', 'vakfikebir.bel.tr',
  'besikduzu.bel.tr', 'carsibasi.bel.tr', 'salpazari.bel.tr', 'tonya.bel.tr',
  'koprubasi.bel.tr', 'trabzon.bel.tr', 'trabzon.gov.tr', 'afad.gov.tr', 'mgm.gov.tr',
];

const results = await Promise.all(
  domains.map(async (domain) => {
    const started = Date.now();
    try {
      const response = await fetch(`https://${domain}/`, {
        redirect: 'follow',
        signal: AbortSignal.timeout(12000),
        headers: { 'User-Agent': 'TrabzoneSourceCheck/1.0' },
      });
      return { domain, status: response.status, ms: Date.now() - started, final: new URL(response.url).hostname };
    } catch (error) {
      return { domain, status: 0, ms: Date.now() - started, error: String(error).slice(0, 80) };
    }
  }),
);

for (const row of results.sort((a, b) => a.domain.localeCompare(b.domain))) {
  console.log(`${row.status || 'ERR'}\t${row.domain}\t${row.ms}ms\t${row.final ?? ''}`);
}
