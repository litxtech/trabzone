// Push teslimat teşhisi: "neden bildirim gelmiyor" sorusunu tek çıktıda yanıtlar.
//
// Denetlenenler:
//   1. Sunucu hattı      — push_settings (worker adresi, açık/kapalı), cron işi
//   2. Kayıtlı cihazlar  — token var mı, geçersiz işaretlenmiş mi, platform
//   3. Son teslimatlar   — durum dağılımı ve sağlayıcı hatası (ör. InvalidCredentials)
//   4. Expo kimlikleri   — @trabzone/trabzone için APNs anahtarı ve FCM v1 anahtarı
//
// Kullanım: npm run push:doctor
// Gizli değer yazdırmaz: token'lar kısaltılır, anahtarların yalnızca varlığı yazılır.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
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

const token = process.env.SUPABASE_ACCESS_TOKEN ?? env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.SUPABASE_PROJECT_REF ?? env.SUPABASE_PROJECT_REF;
const projectId = env.EXPO_PROJECT_ID || '2512ac5f-ba99-4d56-90ee-079b4211b77c';

if (!token || !ref) {
  console.error('SUPABASE_ACCESS_TOKEN ve SUPABASE_PROJECT_REF gerekli (.env).');
  process.exit(1);
}

const ok = (v) => `\x1b[32m${v}\x1b[0m`;
const bad = (v) => `\x1b[31m${v}\x1b[0m`;
const warn = (v) => `\x1b[33m${v}\x1b[0m`;

async function runSql(query) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ query }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${text.slice(0, 400)}`);
  return JSON.parse(text);
}

const DB_QUERY = `
select jsonb_build_object(
  'settings', (
    select jsonb_build_object(
      'enabled', s.enabled,
      'worker_url', s.worker_url,
      'last_tick_at', s.last_tick_at,
      'last_error', s.last_error)
      from public.push_settings s where s.id = 1),
  'cron', (
    select coalesce(jsonb_agg(jsonb_build_object('job', j.jobname, 'schedule', j.schedule,
                                                 'active', j.active)), '[]'::jsonb)
      from cron.job j where j.jobname like '%push%'),
  'devices', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'platform', d.platform,
             'token', d.push_token is not null,
             'token_prefix', left(coalesce(d.push_token, ''), 22),
             'invalidated_at', d.invalidated_at,
             'invalid_reason', d.invalid_reason,
             'last_error', d.last_error,
             'notifications_enabled', d.notifications_enabled,
             'social_enabled', d.social_enabled,
             'app_version', d.app_version,
             'os_version', d.os_version,
             'last_seen_at', d.last_seen_at)
           order by d.last_seen_at desc nulls last), '[]'::jsonb)
      from public.user_devices d),
  'deliveries', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'status', t.status,
             'platform', t.platform,
             'error', t.error,
             'n', t.n,
             'last_at', t.last_at)), '[]'::jsonb)
      from (
        select d.status,
               ud.platform,
               coalesce(d.provider_result ->> 'error', '') as error,
               count(*) as n,
               max(d.created_at) as last_at
          from public.push_deliveries d
          join public.user_devices ud on ud.id = d.device_id
         where d.created_at > now() - interval '7 days'
         group by 1, 2, 3
         order by 5 desc) t)
) as data;
`;

function expoSession() {
  try {
    const state = JSON.parse(readFileSync(join(homedir(), '.expo', 'state.json'), 'utf8'));
    return state?.auth?.sessionSecret ?? null;
  } catch {
    return null;
  }
}

const EXPO_QUERY = `
query ($appId: String!) {
  app {
    byId(appId: $appId) {
      fullName
      iosAppCredentials {
        appleAppIdentifier { bundleIdentifier }
        pushKey { keyIdentifier updatedAt }
      }
      androidAppCredentials {
        applicationIdentifier
        googleServiceAccountKeyForFcmV1 { projectIdentifier updatedAt }
        androidFcm { id }
      }
    }
  }
}
`;

async function expoCredentials() {
  const session = expoSession();
  if (!session) return { skipped: 'expo oturumu yok (npx expo login)' };
  const response = await fetch('https://api.expo.dev/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'expo-session': session },
    body: JSON.stringify({ query: EXPO_QUERY, variables: { appId: projectId } }),
  });
  const payload = await response.json();
  if (payload.errors?.length) return { error: payload.errors[0].message };
  return payload.data?.app?.byId ?? null;
}

const data = (await runSql(DB_QUERY))[0]?.data ?? {};
const expo = await expoCredentials();

const sections = [];
const problems = [];

// 1. Sunucu hattı -----------------------------------------------------------
{
  const s = data.settings ?? {};
  const jobs = data.cron ?? [];
  const tick = jobs.find((j) => j.job === 'push-dispatch');
  const lines = [
    `worker_url     : ${s.worker_url ?? bad('yok')}`,
    `hat açık       : ${s.enabled ? ok('evet') : bad('hayır (push_settings.enabled = false)')}`,
    `son tick       : ${s.last_tick_at ?? warn('hiç çalışmadı')}`,
    `son hata       : ${s.last_error ?? ok('yok')}`,
    `cron           : ${tick ? `${tick.schedule} (${tick.active ? 'aktif' : 'pasif'})` : bad('push-dispatch işi yok')}`,
  ];
  if (!s.enabled) problems.push('push_settings.enabled = false → kuyruk işlenmiyor.');
  if (!s.worker_url) problems.push('push_settings.worker_url boş → cron hiçbir yere istek atmıyor.');
  if (!tick) problems.push('push-dispatch cron işi kayıp (0205 migration yeniden çalıştırılmalı).');
  sections.push(['1) Sunucu hattı', lines]);
}

// 2. Cihazlar ---------------------------------------------------------------
{
  const devices = data.devices ?? [];
  const lines = devices.length
    ? devices.map((d) => {
        const state = d.token
          ? ok('token var')
          : d.invalidated_at
            ? bad(`token yok (${d.invalid_reason ?? 'geçersiz'})`)
            : bad('token yok');
        return `${(d.platform ?? '?').padEnd(8)} ${state.padEnd(46)} os=${d.os_version ?? '-'} app=${d.app_version ?? '-'} son=${d.last_seen_at ?? '-'}`;
      })
    : [bad('kayıtlı cihaz yok — uygulama hiç push token kaydetmemiş')];

  for (const d of devices) {
    if (d.token && !d.notifications_enabled) problems.push(`${d.platform}: cihazda bildirimler kapalı (notifications_enabled = false).`);
    if (d.token && !d.social_enabled) problems.push(`${d.platform}: cihaz sosyal bildirimleri kapalı (social_enabled = false).`);
  }
  sections.push(['2) Kayıtlı cihazlar', lines]);
}

// 3. Teslimatlar ------------------------------------------------------------
{
  const rows = data.deliveries ?? [];
  const lines = rows.length
    ? rows.map(
        (r) =>
          `${(r.platform ?? '?').padEnd(8)} ${r.status.padEnd(14)} ${String(r.n).padStart(3)}x  ${
            r.error ? bad(r.error) : ok('—')
          }  son=${r.last_at ?? '-'}`,
      )
    : [warn('son 7 günde teslimat kaydı yok (hiç push denenmemiş)')];

  for (const r of rows) {
    if (r.status === 'failed' && r.error === 'InvalidCredentials') {
      problems.push(
        `${r.platform}: sağlayıcı kimliği eksik (${r.error}) → Expo projesinde ${r.platform === 'ios' ? 'APNs anahtarı' : 'FCM v1 anahtarı'} yok/yanlış.`,
      );
    }
    if (r.status === 'invalid_token') problems.push(`${r.platform}: token sağlayıcıda geçersiz (DeviceNotRegistered) → uygulama yeniden açılıp token tazelemeli.`);
    if (r.status === 'suppressed') problems.push(`${r.platform}: bildirim bastırıldı (sessiz saatler / günlük sınır / tercih).`);
  }
  sections.push(['3) Son 7 günün teslimatları', lines]);
}

// 4. Expo sağlayıcı kimlikleri ---------------------------------------------
{
  if (expo?.skipped || expo?.error) {
    sections.push(['4) Expo kimlikleri', [warn(expo.skipped ?? expo.error)]]);
  } else {
    const lines = [`proje: ${expo.fullName}`];
    for (const c of expo.iosAppCredentials ?? []) {
      const bundle = c.appleAppIdentifier?.bundleIdentifier ?? '?';
      if (c.pushKey) {
        lines.push(`iOS  ${bundle.padEnd(28)} APNs anahtarı: ${ok(`${c.pushKey.keyIdentifier} (${c.pushKey.updatedAt})`)}`);
      } else {
        lines.push(`iOS  ${bundle.padEnd(28)} APNs anahtarı: ${bad('YOK')}`);
        problems.push(`iOS ${bundle}: APNs anahtarı yok → Expo'dan hiçbir iOS push'u gönderilemez (uygulama açıkken de).`);
      }
    }
    for (const c of expo.androidAppCredentials ?? []) {
      const pkg = c.applicationIdentifier ?? '?';
      const fcm = c.googleServiceAccountKeyForFcmV1 ?? c.androidFcm;
      lines.push(
        `Android ${pkg.padEnd(24)} FCM v1: ${fcm ? ok(`var (${fcm.projectIdentifier ?? fcm.id})`) : bad('YOK')}`,
      );
      if (!fcm) problems.push(`Android ${pkg}: FCM v1 anahtarı yok → Android push'u gönderilemez.`);
    }
    sections.push(['4) Expo sağlayıcı kimlikleri', lines]);
  }
}

// Yerel yapılandırma: Android cihazın FCM token alabilmesi için gerekli dosya.
{
  const rel = process.env.GOOGLE_SERVICES_JSON?.trim() || 'assets/google-services.json';
  const lines = [];
  let config = null;
  try {
    config = JSON.parse(readFileSync(join(root, rel), 'utf8'));
  } catch {
    lines.push(`google-services.json: ${bad(`YOK (${rel}) — Android cihaz FCM token üretemez`)}`);
    lines.push('  → Firebase konsolundan indirip GOOGLE_SERVICES_JSON ile build\'e verin (app.config.ts).');
    problems.push(
      'google-services.json yok: Android derlemesinde FirebaseApp başlatılamaz → push token alınamaz (Expo anahtarı doğru olsa bile).',
    );
  }

  if (config) {
    const projectId = config.project_info?.project_id ?? null;
    const clients = Array.isArray(config.client) ? config.client : Array.isArray(config.clients) ? config.clients : [];
    lines.push(`google-services.json: ${ok(`var (${rel})`)}`);
    lines.push(`  firebase projesi : ${projectId ?? bad('project_id yok')}`);

    if (clients.length === 0) {
      lines.push(`  istemci kaydı    : ${bad('yok — "client" dizisi boş')}`);
      problems.push('google-services.json içinde "client" kaydı yok → Gradle google-services eklentisi derlemeyi durdurur.');
    }

    const packages = clients.map((c) => c.client_info?.android_client_info?.package_name).filter(Boolean);
    const matches = packages.filter((p) => p === 'com.litxtech.trabzone');
    for (const pkg of packages) {
      lines.push(`  paket            : ${pkg}${pkg === 'com.litxtech.trabzone' ? ` ${ok('(eşleşiyor)')}` : ` ${bad('(beklenen com.litxtech.trabzone)')}`}`);
    }
    if (clients.length > 0 && matches.length === 0) {
      problems.push(
        `google-services.json paketi com.litxtech.trabzone içermiyor (${packages.join(', ') || 'paket yok'}) → FCM token alınamaz.`,
      );
    }
    if (clients.length > 0 && clients.every((c) => !c.api_key?.length)) {
      problems.push('google-services.json içinde api_key yok → FCM kaydı 403 döner.');
    }

    // FCM v1 sunucu anahtarı aynı Firebase projesine ait olmalı.
    const serverProject = (expo?.androidAppCredentials ?? [])
      .map((c) => c.googleServiceAccountKeyForFcmV1?.projectIdentifier)
      .find(Boolean);
    if (projectId && serverProject && projectId !== serverProject) {
      problems.push(
        `Firebase projesi uyuşmuyor: uygulama "${projectId}", Expo'daki FCM v1 sunucu anahtarı "${serverProject}".`,
      );
    } else if (projectId && serverProject) {
      lines.push(`  sunucu anahtarı  : ${ok(`aynı proje (${serverProject})`)}`);
    }
  }

  sections.push(['5) Firebase yapılandırması (Android)', lines]);
}

for (const [title, lines] of sections) {
  console.log(`\n${title}`);
  console.log('─'.repeat(Math.max(40, title.length + 4)));
  for (const line of lines) console.log(`  ${line}`);
}

console.log('\nSONUÇ');
console.log('─'.repeat(40));
if (problems.length === 0) {
  console.log(`  ${ok('Engel görünmüyor.')} Test bildirimi gönderip teslimat satırının "delivered" olduğunu doğrulayın.`);
} else {
  for (const p of [...new Set(problems)]) console.log(`  ${bad('•')} ${p}`);
}
console.log('');
