// AI haber web/SEO uçlarını gerçek Supabase verisiyle yerel olarak doğrular.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

for (const line of readFileSync(join(root, '.env'), 'utf8').split(/\r?\n/)) {
  if (!line || line.trim().startsWith('#') || !line.includes('=')) continue;
  const index = line.indexOf('=');
  process.env[line.slice(0, index).trim()] = line.slice(index + 1).trim();
}
process.chdir(root);

const news = require('../api/news.js');
const sitemapNews = require('../api/sitemap-news.js');

function invoke(handler, { url, method = 'GET' }) {
  return new Promise((resolve, reject) => {
    const headers = {};
    const chunks = [];
    const parsed = new URL(url, 'https://trabzone.com');
    const query = {};
    parsed.searchParams.forEach((value, key) => { query[key] = value; });
    const req = { method, url, query, headers: { host: 'trabzone.com', 'user-agent': 'smoke-test' } };
    const res = {
      statusCode: 200,
      setHeader(name, value) { headers[name.toLowerCase()] = value; },
      getHeader(name) { return headers[name.toLowerCase()]; },
      end(chunk) { resolve({ status: res.statusCode, headers, body: chunk ? String(chunk) : chunks.join('') }); },
      write(chunk) { chunks.push(String(chunk)); },
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const slug = process.argv[2] || 'of-ta-salep-maviyemis-ve-aronya-ureticileri-bulustu-organik-sertifikalar-verildi-289388fc';

const post = await invoke(news, { url: `/api/news?slug=${slug}` });
check('haber sayfası 200 döner', post.status === 200, String(post.status));
check('haber canonical', post.body.includes(`<link rel="canonical" href="https://www.trabzoneapp.com/haber/${slug}"`));
check('haber NewsArticle JSON-LD', post.body.includes('"@type":"NewsArticle"') || post.body.includes('"@type": "NewsArticle"'));
check('haber AI şeffaflık etiketi', /AI destekli haber/i.test(post.body));
check('haber kaynak listesi', /Kaynaklar/i.test(post.body) && post.body.includes('takagazete.com.tr'));
check('haber OG görseli', /property="og:image"/i.test(post.body));
check('haber yayın tarihi', /datePublished|published_time/i.test(post.body));
check('haber 404 değil', !post.body.includes('Haber bulunamadı'));

const missing = await invoke(news, { url: '/api/news?slug=bu-haber-yok-12345' });
check('olmayan haber 404', missing.status === 404, String(missing.status));
check('olmayan haber noindex', /noindex/i.test(missing.body));

const index = await invoke(news, { url: '/api/news' });
check('haber indeksi 200', index.status === 200, String(index.status));
check('haber indeksi listesi', index.body.includes(slug));

const sitemap = await invoke(sitemapNews, { url: '/sitemap-news.xml' });
check('news sitemap 200', sitemap.status === 200, String(sitemap.status));
check('news sitemap xml', String(sitemap.headers['content-type'] || '').includes('xml'));
check('news sitemap slug içerir', sitemap.body.includes(slug));
check('news sitemap lastmod', sitemap.body.includes('<lastmod>'));
check('news sitemap news namespace', sitemap.body.includes('news:news') || sitemap.body.includes('sitemap-news'));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} web testi geçti`);
if (failed.length) process.exit(1);
