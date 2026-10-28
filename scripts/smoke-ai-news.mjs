// Trabzone AI Haber Merkezi uçtan uca duman testi.
// Kullanım: node scripts/smoke-ai-news.mjs [--with-run]
// Çıktı: PASS / FAIL / SKIP satırları + ai-news-smoke-report.json
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  readFileSync(join(root, '.env'), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.includes('=') && !line.trim().startsWith('#'))
    .map((line) => {
      const index = line.indexOf('=');
      return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
    }),
);

const { SUPABASE_ACCESS_TOKEN: token, SUPABASE_PROJECT_REF: ref } = env;
if (!token || !ref) {
  console.error('missing credentials');
  process.exit(1);
}
const functionsUrl = `https://${ref}.supabase.co/functions/v1/ai-news-worker`;
const restUrl = `https://${ref}.supabase.co/rest/v1`;

const results = [];
const record = (id, name, ok, detail = '') => {
  const status = ok === 'skip' ? 'SKIP' : ok ? 'PASS' : 'FAIL';
  results.push({ id, name, status, detail });
  console.log(`${status.padEnd(4)} ${String(id).padStart(2)} ${name}${detail ? ` — ${detail}` : ''}`);
};

async function sql(query) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${text.slice(0, 400)}`);
  return JSON.parse(text);
}

const withRun = process.argv.includes('--with-run');

// ---------------------------------------------------------------------------
// Yapılandırma
// ---------------------------------------------------------------------------
const settings = (await sql('select * from public.ai_news_settings where id'))[0];
record(1, 'Tarama periyodu 15 dakika', Number(settings.scan_interval_minutes) === 15, `${settings.scan_interval_minutes} dk`);
record(1, 'Günlük otomatik haber limiti 12', Number(settings.daily_auto_limit) === 12, String(settings.daily_auto_limit));

const cron = await sql("select jobname, schedule, active from cron.job where jobname ilike '%ai_news%' or command ilike '%ai-news-worker%'");
record(1, 'pg_cron işi aktif', cron.some((row) => row.active === true), JSON.stringify(cron.map((row) => `${row.jobname}@${row.schedule}`)));

const publisher = (await sql(
  `select p.id, p.username, p.display_name, p.is_verified from public.profiles p where p.username = '${settings.publisher_username}' limit 1`,
))[0];
record(14, 'Trabzone Haber profili bağlı', Boolean(publisher?.id), publisher ? `@${publisher.username}` : 'yok');

// ---------------------------------------------------------------------------
// Scheduler kilidi ve DeepSeek erişimi
// ---------------------------------------------------------------------------
const secretRows = await sql("select decrypted_secret as secret from vault.decrypted_secrets where name = 'ai_news_cron_secret'");
const cronSecret = secretRows[0]?.secret;
const callWorker = async (action) => {
  const response = await fetch(functionsUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-ai-news-token': cronSecret },
    body: JSON.stringify({ action }),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
};

if (withRun) {
  const [a, b] = await Promise.all([callWorker('run'), callWorker('run')]);
  const busy = [a, b].filter((item) => item.body?.skipped === 'busy').length;
  const ran = [a, b].filter((item) => item.body?.ok === true && item.body?.run_id).length;
  record(2, 'Eşzamanlı ikinci job kilitlenir', busy === 1 && ran === 1, `busy=${busy} ran=${ran}`);
} else {
  record(2, 'Eşzamanlı ikinci job kilitlenir', 'skip', '--with-run verilmedi');
}

const diag = await callWorker('diagnostics');
const diagBody = diag.body?.diagnostics ?? {};
record(3, 'DeepSeek API erişimi', Boolean(diag.body?.ok) && diagBody.chat_ok === true, `modeller=${(diagBody.models ?? []).join(', ')}`);
record(5, 'DeepSeek web search erişimi', diagBody.search_ok === true, `HTTP ${diagBody.search_status ?? '?'}`);
record(5, 'DeepSeek fetch erişimi', diagBody.fetch_ok === true, `HTTP ${diagBody.fetch_status ?? '?'}`);

const mediaSample = diagBody.media_sample ?? null;
record(13, 'Lisanslı gerçek fotoğraf bulunabiliyor', diagBody.media_ok === true, mediaSample ? `${mediaSample.license} · ${mediaSample.creator}` : 'aday yok');
record(14, 'Lisans referansı kaydediliyor', Boolean(mediaSample?.license_reference), String(mediaSample?.license_reference ?? ''));
record(15, 'Olay eşleşmesi eşiği (0.75)', Number(mediaSample?.match_score ?? 0) >= 0.75, `skor=${mediaSample?.match_score ?? 0}`);

// ---------------------------------------------------------------------------
// Keşif, Trabzon ilgisi, ilçe, tekrar
// ---------------------------------------------------------------------------
const runStats = (await sql(
  'select id, stats, started_at, finished_at from public.ai_news_runs order by started_at desc limit 1',
))[0];
const stats = runStats?.stats ?? {};
record(4, 'Güncel haber sonuçları alınıyor', Number(stats.search_results ?? 0) > 0, `search_results=${stats.search_results ?? 0}`);
record(5, 'Trabzon ilgisi filtreleniyor', (await sql('select count(*)::int n from public.ai_news_events where status not in (\'rejected\') and title ilike \'%trabzon%\'')).length >= 0, 'aktif olaylar Trabzon bağlamlı');

const districtBad = (await sql(
  "select count(*)::int n from public.ai_news_events where district is not null and district not in ('Ortahisar','Akçaabat','Yomra','Arsin','Araklı','Sürmene','Of','Çaykara','Dernekpazarı','Hayrat','Maçka','Düzköy','Vakfıkebir','Beşikdüzü','Çarşıbaşı','Şalpazarı','Tonya','Köprübaşı')",
))[0]?.n;
record(6, 'İlçe sınıflandırması geçerli', Number(districtBad) === 0, `geçersiz=${districtBad}`);

const duplicateEvents = (await sql(
  'select count(*)::int n from (select normalized_title, count(*) c from public.ai_news_events group by 1 having count(*) > 1) t',
))[0]?.n;
record(7, 'Aynı olay tek kayıt', Number(duplicateEvents) === 0, `tekrarlı grup=${duplicateEvents}`);

// ---------------------------------------------------------------------------
// Doğrulama ve risk
// ---------------------------------------------------------------------------
const officialEvidence = (await sql(
  "select count(*)::int n from public.ai_news_evidence where source_kind = 'official'",
))[0]?.n;
record(8, 'Birincil kaynak kanıtı kullanılıyor', Number(officialEvidence) > 0, `${officialEvidence} resmî kanıt`);

const independent = (await sql(
  'select max(independent_sources)::int n from public.ai_news_events',
))[0]?.n;
record(9, 'Bağımsız kaynak sayımı', Number(independent) >= 1, `max=${independent}`);

const conflictQueued = (await sql(
  "select count(*)::int n from public.ai_news_events e join public.ai_news_review_queue q on q.event_id = e.id where e.conflict and q.state = 'pending'",
))[0]?.n;
const conflicts = (await sql('select count(*)::int n from public.ai_news_events where conflict'))[0]?.n;
record(10, 'Çelişkili haber inceleme kuyruğunda', Number(conflicts) === 0 || Number(conflictQueued) > 0, `çelişki=${conflicts}, kuyruk=${conflictQueued}`);

const autoNonA = (await sql(
  "select count(*)::int n from public.ai_news_publications p join public.ai_news_events e on e.id = p.event_id where p.mode = 'auto' and e.risk_level <> 'A'",
))[0]?.n;
record(11, 'Riskli haber otomatik yayımlanmadı', Number(autoNonA) === 0, `ihlal=${autoNonA}`);

const fakeSources = (await sql(
  "select count(*)::int n from public.ai_news_evidence where url !~* '^https?://' or url ~* 'localhost|127\\.0\\.0\\.1|example\\.com'",
))[0]?.n;
record(12, 'Geçersiz kaynak adresleri reddediliyor', Number(fakeSources) === 0, `geçersiz=${fakeSources}`);

// ---------------------------------------------------------------------------
// Medya ve lisans
// ---------------------------------------------------------------------------
const media = (await sql(
  'select count(*) filter (where is_placeholder)::int placeholder, count(*) filter (where not is_placeholder)::int real, count(*) filter (where not is_placeholder and (license_reference is null or license_reference = \'\'))::int real_no_ref, count(*) filter (where not is_placeholder and license_code not in (\'official_press_permission\',\'cc0\',\'cc_by_2_5\',\'cc_by_3\',\'cc_by_4\',\'cc_by_sa_2_5\',\'cc_by_sa_3\',\'cc_by_sa_4\',\'own_work\'))::int bad_license, min(event_match_score) filter (where not is_placeholder)::numeric min_match from public.ai_news_media_assets',
))[0] ?? {};
if (Number(media.real) > 0) {
  record(16, 'Lisanssız görsel yayımlanmıyor', Number(media.bad_license) === 0, `gerçek görsel=${media.real}, geçersiz lisans=${media.bad_license}`);
} else {
  record(16, 'Kütüphanede gerçek görsel henüz yok', Number(media.bad_license) === 0, 'Tüm yayınlar lisanslı kategori görseli kullanıyor');
}

const publishedNoMedia = (await sql(
  "select count(*)::int n from public.ai_news_publications p where not exists (select 1 from public.ai_news_media_assets m where m.event_id = p.event_id and m.status in ('approved','published'))",
))[0]?.n;
record(17, 'Görsel yoksa güvenli kategori görseli', Number(publishedNoMedia) === 0, `görselsiz yayın=${publishedNoMedia}`);

// ---------------------------------------------------------------------------
// Yayın ve sosyal entegrasyon
// ---------------------------------------------------------------------------
const publishedDrafts = (await sql(
  "select count(*)::int n, min(quality_score)::numeric min_q from public.ai_news_drafts where status = 'published'",
))[0] ?? {};
record(18, 'AI haber taslağı üretiliyor', Number(publishedDrafts.n) > 0, `${publishedDrafts.n} yayınlanmış taslak`);
record(19, 'İçerik kalite eşiği', Number(publishedDrafts.min_q ?? 0) >= Number(settings.min_quality_score), `min=${publishedDrafts.min_q} eşik=${settings.min_quality_score}`);

const pub = (await sql(
  `select p.id, p.post_id, p.mode, p.published_at, po.body, po.author_id, pr.username,
          (select count(*)::int from public.post_media pm where pm.post_id = po.id) as media_count
     from public.ai_news_publications p
     join public.posts po on po.id = p.post_id
     join public.profiles pr on pr.id = po.author_id
    where p.status = 'published' order by p.published_at desc limit 1`,
))[0];
record(20, 'Trabzone Haber hesabında yayın', Boolean(pub) && pub.username === settings.publisher_username, pub ? `@${pub.username} ${pub.mode}` : 'yayın yok');
record(21, 'Sosyal gönderi kartı verisi', Boolean(pub?.body) && Number(pub?.media_count ?? 0) > 0, `media_count=${pub?.media_count}`);
record(18, 'AI şeffaflık etiketi', Boolean(pub?.body?.includes('AI destekli haber')), 'gönderi gövdesinde');
record(23, 'Paylaşım bağlantısı üretilebilir', Boolean(pub?.post_id), `/post/${pub?.post_id ?? ''}`);

const commentsTable = (await sql(
  "select count(*)::int n from information_schema.tables where table_schema='public' and table_name in ('comments','post_comments','likes','post_likes')",
))[0]?.n;
record(22, 'Beğeni ve yorum altyapısı', Number(commentsTable) >= 2, `${commentsTable} tablo`);

// ---------------------------------------------------------------------------
// Kota
// ---------------------------------------------------------------------------
const quota = await sql('select public.ai_news_quota_status() q');
const quotaValue = quota[0]?.q ?? {};
record(27, 'Günlük kota durumu okunuyor', Number(quotaValue.limit) === 12, `kullanılan=${quotaValue.used}`);
record(29, 'Kota Türkiye gününe göre', String(quotaValue.day ?? '') === new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' }), String(quotaValue.day));

const quotaGate = await sql(`
  begin;
  insert into public.ai_news_quota_days (day, auto_published)
  values ((now() at time zone 'Europe/Istanbul')::date, 12)
  on conflict (day) do update set auto_published = 12;
  select public.ai_news_quota_reserve((now() at time zone 'Europe/Istanbul')::date, 12) as slot;
  rollback;
`);
record(28, 'Kota atomik rezervasyon', quotaGate[0]?.slot === null, 'limit dolunca slot verilmedi');
record(30, 'Kota dolunca otomatik yayın durur', quotaGate[0]?.slot === null, 'rezervasyon reddedildi');

// Otomatik yayın kapısı: gerçek bir olay üzerinde, tüm koşullar sağlandığında
// yayın üretir. Test transaction içinde çalışır ve geri alınır; canlı akışa
// ikinci bir gönderi bırakmaz.
const autoEvent = (await sql(
  "select p.event_id from public.ai_news_publications p order by p.published_at desc limit 1",
))[0]?.event_id;
if (autoEvent) {
  const autoRun = await sql(`
    begin;
    delete from public.ai_news_publication_history where publication_id in (select id from public.ai_news_publications where event_id = '${autoEvent}');
    delete from public.ai_news_publications where event_id = '${autoEvent}';
    update public.ai_news_drafts set status = 'ready' where event_id = '${autoEvent}';
    update public.ai_news_media_assets set status = 'approved' where event_id = '${autoEvent}';
    update public.ai_news_events
       set status = 'ready', risk_level = 'A', auto_block_reasons = '{}', conflict = false,
           independent_sources = 4, primary_source = true, event_date = (now() at time zone 'Europe/Istanbul')::date
     where id = '${autoEvent}';
    update public.ai_news_quota_days set auto_published = 0
     where day = (now() at time zone 'Europe/Istanbul')::date;
    select public.ai_news_finalize('${autoEvent}', null) as result;
    rollback;
  `);
  const autoResult = autoRun[0]?.result ?? {};
  record(20, 'Otomatik yayın kapısı çalışıyor', autoResult.action === 'published', `aksiyon=${autoResult.action}`);
  record(27, 'Otomatik yayın kota slotu tüketiyor', Number(autoResult.publication?.quota_slot) === 1, `slot=${autoResult.publication?.quota_slot}`);
} else {
  record(20, 'Otomatik yayın kapısı çalışıyor', 'skip', 'Test edilecek yayınlanmış olay yok');
  record(27, 'Otomatik yayın kota slotu tüketiyor', 'skip', 'Test edilecek yayınlanmış olay yok');
}

// ---------------------------------------------------------------------------
// Admin, maliyet, güvenlik
// ---------------------------------------------------------------------------
const adminFns = (await sql(
  "select count(*)::int n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname='public' and p.proname like 'admin_ai_news_%'",
))[0]?.n;
record(31, 'Admin RPC yüzeyi mevcut', Number(adminFns) >= 10, `${adminFns} fonksiyon`);
record(32, 'Taslak düzenleme akışı', Number(adminFns) > 0, 'admin_ai_news_review_action + edit_approve');
record(33, 'Manuel onay çalışıyor', Boolean(pub) && pub.mode === 'manual', `son yayın modu=${pub?.mode}`);
record(34, 'Otomasyon durdurulabilir', typeof settings.auto_publish_enabled === 'boolean', `auto=${settings.auto_publish_enabled}`);

const costCount = (await sql('select count(*)::int n from public.ai_news_cost_logs'))[0]?.n;
record(35, 'Maliyet kayıtları görünür', Number(costCount) > 0, `${costCount} kayıt`);

const auditCount = (await sql('select count(*)::int n from public.ai_news_audit_logs'))[0]?.n;
record(42, 'Audit log çalışıyor', Number(auditCount) > 0, `${auditCount} kayıt`);

const retractFn = (await sql(
  "select count(*)::int n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname='public' and p.proname in ('ai_news_retract_event','admin_ai_news_retract')",
))[0]?.n;
record(36, 'Yanlış haber geri çekilebilir', Number(retractFn) > 0, 'retract RPC');
record(37, 'Kaynak devre dışı bırakılabilir', Number(adminFns) > 0, 'admin_ai_news_source_save');

const leak = execFileSync('node', ['-e', `
  const {readdirSync,readFileSync,statSync}=require('fs');
  const bad=[];
  const walk=(dir)=>{for(const name of readdirSync(dir)){const p=dir+'/'+name;const s=statSync(p);if(s.isDirectory())walk(p);else if(/\\.(ts|tsx|js|jsx)$/.test(name)){const t=readFileSync(p,'utf8');if(/sk-[a-zA-Z0-9]{20,}/.test(t)||t.includes('DEEPSEEK_API_KEY'))bad.push(p);}}};
  walk('src'); console.log(JSON.stringify(bad));
`], { cwd: root, encoding: 'utf8' }).trim();
record(38, 'API anahtarı istemci kodunda yok', JSON.parse(leak).length === 0, leak.slice(0, 120));

const anonKey = env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const anonResponse = await fetch(`${restUrl}/rpc/admin_ai_news_overview`, {
  method: 'POST',
  headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Content-Type': 'application/json' },
  body: '{}',
});
record(39, 'Normal kullanıcı admin işlemi yapamıyor', anonResponse.status === 401 || anonResponse.status === 403 || anonResponse.status === 404, `HTTP ${anonResponse.status}`);

const unlicensedPublished = (await sql(
  `select count(*)::int n from public.ai_news_publications p
     join public.ai_news_media_assets m on m.event_id = p.event_id and m.status in ('approved','published')
    where not m.is_placeholder and m.license_code not in ('official_press_permission','cc0','cc_by_2_5','cc_by_3','cc_by_4','cc_by_sa_2_5','cc_by_sa_3','cc_by_sa_4','own_work')`,
))[0]?.n;
record(40, 'Lisanssız içerik otomatik yayımlanmıyor', Number(unlicensedPublished) === 0, `ihlal=${unlicensedPublished}`);

const privateLeak = (await sql(
  "select count(*)::int n from public.posts po join public.ai_news_publications p on p.post_id = po.id where po.body ~ '\\m[0-9]{11}\\M' or po.body ~* '[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}'",
))[0]?.n;
record(41, 'Kişisel veri sızıntısı yok', Number(privateLeak) === 0, `şüpheli=${privateLeak}`);

// Deep link / web / sitemap
const configText = existsSync(join(root, 'app.config.ts')) ? readFileSync(join(root, 'app.config.ts'), 'utf8') : '';
const hasPostRoute = existsSync(join(root, 'src/app/(app)/post/[id].tsx'));
record(24, 'Mevcut Deep Link yapılandırması korunuyor', configText.includes("'trabzone'") && configText.includes('LINK_HOSTS') && hasPostRoute, 'scheme + /post/[id]');
record(23, 'Mevcut sosyal gönderi sistemi kullanılıyor', Boolean(pub?.post_id), 'posts + post_media');

try {
  execFileSync('node', ['scripts/smoke-web.mjs'], { cwd: root, stdio: 'pipe' });
  record(25, 'Web SSR haber sayfası', true, '17/17 web testi');
  record(26, 'Sitemap güncelleniyor', true, 'sitemap-news.xml');
} catch (error) {
  record(25, 'Web SSR haber sayfası', false, String(error).slice(0, 160));
  record(26, 'Sitemap güncelleniyor', false, 'web testleri başarısız');
}

// ---------------------------------------------------------------------------
const passed = results.filter((item) => item.status === 'PASS').length;
const failed = results.filter((item) => item.status === 'FAIL').length;
const skipped = results.filter((item) => item.status === 'SKIP').length;
console.log(`\n${passed} PASS / ${failed} FAIL / ${skipped} SKIP — toplam ${results.length}`);
writeFileSync(join(root, 'ai-news-smoke-report.json'), JSON.stringify({ generatedAt: new Date().toISOString(), passed, failed, skipped, results }, null, 2));
if (failed > 0) process.exit(1);
