const DISTRICTS = [
  'Akçaabat', 'Araklı', 'Arsin', 'Beşikdüzü', 'Çarşıbaşı', 'Çaykara',
  'Dernekpazarı', 'Düzköy', 'Hayrat', 'Köprübaşı', 'Maçka', 'Of',
  'Ortahisar', 'Sürmene', 'Şalpazarı', 'Tonya', 'Vakfıkebir', 'Yomra',
];

const UA = { 'User-Agent': 'TrabzoneBot/1.0 (contact@trabzone.app)' };

async function json(url) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

for (const name of DISTRICTS) {
  const wiki = await json(
    `https://tr.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(name)}&prop=coordinates&format=json&redirects=1`,
  );
  const page = Object.values(wiki.query.pages)[0];
  const coord = page?.coordinates?.[0];
  console.log(`\n=== ${name} === coord=${coord ? `${coord.lat},${coord.lon}` : 'none'}`);
  if (!coord) continue;
  const commons = await json(
    `https://commons.wikimedia.org/w/api.php?action=query&generator=geosearch&ggscoord=${coord.lat}|${coord.lon}&ggsradius=10000&ggslimit=40&ggsnamespace=6&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=1600&format=json`,
  );
  const pages = Object.values(commons.query?.pages ?? {});
  const photos = pages
    .map((p) => ({ title: p.title, ...p.imageinfo?.[0] }))
    .filter((p) => p.width >= 1200 && p.width > p.height * 1.25 && /\.(jpe?g|png)$/i.test(p.title))
    .filter((p) => !/(map|harita|logo|coat|flag|bayrak|arma|locator|location)/i.test(p.title))
    .slice(0, 5);
  for (const p of photos) {
    const license = p.extmetadata?.LicenseShortName?.value ?? '';
    const artist = (p.extmetadata?.Artist?.value ?? '').replace(/<[^>]+>/g, '').slice(0, 80);
    console.log(`- ${p.title} | ${p.width}x${p.height} | ${license} | ${artist} | ${p.thumburl}`);
  }
}
