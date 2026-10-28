const UA = { 'User-Agent': 'TrabzoneBot/1.0 (contact@trabzone.app)' };
const terms = process.argv.slice(2);
for (const term of terms) {
  const url =
    'https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=' +
    encodeURIComponent(term) +
    '&gsrnamespace=6&gsrlimit=20&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=1600&format=json';
  const res = await fetch(url, { headers: UA });
  const data = await res.json();
  console.log(`\n=== ${term} ===`);
  const pages = Object.values(data.query?.pages ?? {});
  for (const page of pages) {
    const ii = page.imageinfo?.[0];
    if (!ii) continue;
    if (ii.width < 1200 || ii.width <= ii.height * 1.2) continue;
    if (!/\.(jpe?g|png)$/i.test(page.title)) continue;
    if (/(map|harita|logo|coat|flag|bayrak|arma|locator|location)/i.test(page.title)) continue;
    const license = ii.extmetadata?.LicenseShortName?.value ?? '';
    const artist = (ii.extmetadata?.Artist?.value ?? '').replace(/<[^>]+>/g, '').slice(0, 60);
    console.log(`- ${page.title} | ${ii.width}x${ii.height} | ${license} | ${artist}`);
  }
}
