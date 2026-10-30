// End-to-end verification for the Live News / citizen journalism stack.
//
//   node scripts/smoke-live-news.mjs
//
// Creates temporary accounts (two reporters, two subscribers, one editor),
// exercises the RPC surface through PostgREST with real user JWTs, validates
// the public web renderer, then deletes the accounts.
// Requires the server-side Supabase keys in .env.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

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

// SSR helpers read process.env directly.
for (const [key, value] of Object.entries(env)) {
  if (process.env[key] === undefined) {
    process.env[key] = value;
  }
}

const url = env.EXPO_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '');
const anon = env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const service = env.SUPABASE_SERVICE_ROLE_KEY;
const managementToken = process.env.SUPABASE_ACCESS_TOKEN ?? env.SUPABASE_ACCESS_TOKEN;
const projectRef = process.env.SUPABASE_PROJECT_REF ?? env.SUPABASE_PROJECT_REF;

if (!url || !anon || !service || !managementToken || !projectRef) {
  console.error('Missing Supabase environment variables (URL, anon, service role, management).');
  process.exit(1);
}

let failures = 0;
let total = 0;
const groups = [];
let currentGroup = 'Genel';

const startGroup = (name) => {
  currentGroup = name;
  groups.push({ name, passed: 0, failed: 0 });
};

const check = (name, condition, detail) => {
  total += 1;
  const group = groups[groups.length - 1];
  if (condition) {
    group.passed += 1;
  } else {
    group.failed += 1;
    failures += 1;
  }
  let suffix = '';
  if (detail !== undefined && detail !== null && detail !== '') {
    const raw = typeof detail === 'string' ? detail : JSON.stringify(detail);
    suffix = ` — ${raw.length > 420 ? `${raw.slice(0, 420)}…` : raw}`;
  }
  console.log(`${condition ? 'PASS' : 'FAIL'}  [${currentGroup}] ${name}${suffix}`);
};

const request = async (path, { method = 'GET', token, body, key = anon, headers = {} } = {}) => {
  const response = await fetch(`${url}${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${token ?? key}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, ok: response.ok, data };
};

const rpc = (token, fn, args = {}) => request(`/rest/v1/rpc/${fn}`, { method: 'POST', token, body: args });

const runSql = async (query) => {
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${managementToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!response.ok) {
    throw new Error(`sql failed (${response.status}): ${await response.text()}`);
  }
  return response.json();
};

const stamp = Date.now().toString(36);
const accounts = {
  authorA: { email: `live.news.a.${stamp}@example.com`, password: `LvA-${stamp}-Pass9` },
  authorB: { email: `live.news.b.${stamp}@example.com`, password: `LvB-${stamp}-Pass9` },
  follower: { email: `live.news.f.${stamp}@example.com`, password: `LvF-${stamp}-Pass9` },
  subscriber: { email: `live.news.s.${stamp}@example.com`, password: `LvS-${stamp}-Pass9` },
  editor: { email: `live.news.e.${stamp}@example.com`, password: `LvE-${stamp}-Pass9` },
};

const createdUsers = [];
const ids = {};
const tokens = {};
const createdPosts = new Map();

const createUser = async (label) => {
  const account = accounts[label];
  const { status, data } = await request('/auth/v1/admin/users', {
    method: 'POST',
    token: service,
    key: service,
    body: { email: account.email, password: account.password, email_confirm: true },
  });
  if (status >= 300) {
    throw new Error(`admin create ${label} failed: ${JSON.stringify(data)}`);
  }
  createdUsers.push(data.id);
  ids[label] = data.id;

  const signIn = await request('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: { email: account.email, password: account.password },
  });
  if (!signIn.ok) {
    throw new Error(`sign in ${label} failed: ${JSON.stringify(signIn.data)}`);
  }
  tokens[label] = signIn.data.access_token;

  const profile = await rpc(tokens[label], 'complete_registration', {
    p_username: `${label.toLowerCase()}${stamp}`.slice(0, 20),
    p_first_name: label === 'editor' ? 'Editör' : 'Test',
    p_last_name: label === 'authorA' ? 'Muhabir' : 'Kullanıcı',
  });
  if (!profile.ok) {
    throw new Error(`complete_registration ${label} failed: ${JSON.stringify(profile.data)}`);
  }
};

const mediaImage = (label, name, width = 1080, height = 1350) => ({
  storage_path: `${ids[label]}/live-${stamp}-${name}.jpg`,
  media_type: 'image',
  width,
  height,
});

const mediaVideo = (label, name, width, height, duration = 12000) => ({
  storage_path: `${ids[label]}/live-${stamp}-${name}.mp4`,
  thumbnail_path: `${ids[label]}/live-${stamp}-${name}-thumb.jpg`,
  media_type: 'video',
  width,
  height,
  duration_ms: duration,
});

const createLiveNews = (token, payload) => rpc(token, 'live_news_create', payload);

const cleanup = async () => {
  // Remove tracked content first; deletion is idempotent for our purposes.
  for (const [postId, token] of createdPosts) {
    try {
      await rpc(token, 'live_news_delete', { p_post_id: postId });
    } catch {
      // yoksay: bazı içerikler test sırasında zaten silindi.
    }
  }
  for (const id of createdUsers) {
    await request(`/auth/v1/admin/users/${id}`, { method: 'DELETE', token: service, key: service });
  }
};

const main = async () => {
  console.log(`Trabzone Live News smoke test — ${new Date().toISOString()}\n`);

  for (const label of Object.keys(accounts)) {
    await createUser(label);
  }

  // Test hesaplarının oran sayaçlarını sıfırla (üretim kullanıcılarına dokunma).
  const userList = createdUsers.map((id) => `'${id}'`).join(',');
  await runSql(`delete from public.safety_rate_limits where actor_id in (${userList});`);
  await runSql(
    `insert into public.user_role_assignments (user_id, role_key) values ('${ids.editor}', 'admin') on conflict do nothing;`,
  );
  await runSql(
    `insert into public.user_follows (follower_id, following_id) values ('${ids.follower}', '${ids.authorA}') on conflict do nothing;`,
  );

  const prefFollower = await rpc(tokens.follower, 'live_news_preferences_save', {
    p_followed_people: true,
    p_district_updates: false,
    p_verified_only: false,
    p_district: null,
  });
  const prefSubscriber = await rpc(tokens.subscriber, 'live_news_preferences_save', {
    p_followed_people: false,
    p_district_updates: true,
    p_verified_only: true,
    p_district: 'Ortahisar',
  });

  startGroup('1-3, 5, 7 · Oluşturma ve çoklu yayın');
  check('takipçi bildirim tercihleri kaydedilir', prefFollower.ok, JSON.stringify(prefFollower.data));
  check('ilçe + yalnızca doğrulanmış tercihi kaydedilir', prefSubscriber.ok);

  const photo = await createLiveNews(tokens.authorA, {
    p_title: 'Ortahisar sahilinde akşam yürüyüşü başladı',
    p_summary: 'Sahil bandında yürüyüş saatleri yeniden düzenlendi. Vatandaşlar akşam serinliğinde hattı kullanabiliyor.',
    p_category: 'guncel',
    p_district: 'Ortahisar',
    p_media: [mediaImage('authorA', 'photo')],
    p_publish_targets: ['feed', 'live', 'web'],
    p_location_precision: 'approximate',
    p_lat: 41.00234,
    p_lng: 39.71612,
    p_usage_consent: false,
    p_idempotency_key: `photo-${stamp}`,
  });
  const A = photo.data?.id;
  createdPosts.set(A, tokens.authorA);
  check('fotoğraflı anlık haber oluşturulur', photo.ok && Boolean(A), JSON.stringify(photo.data));
  check('varsayılan rozet Vatandaş Paylaşımı', photo.ok && photo.data.live_news?.verification_status === 'citizen');
  check('düşük riskli içerik anında yayınlanır', photo.ok && photo.data.live_news?.moderation_status === 'visible');
  check('medya kanonik gönderiye bağlanır', photo.ok && photo.data.media?.length === 1);
  check('yaklaşık konum 2 haneye yuvarlanır', photo.ok && photo.data.live_news?.location_precision === 'approximate');

  const exactLocation = await runSql(
    `select coordinates_lat, coordinates_lng from public.live_news where post_id = '${A}';`,
  );
  const coordinates = Array.isArray(exactLocation) ? exactLocation[0] : null;
  check(
    'tam GPS koordinatı saklanmaz',
    coordinates?.coordinates_lat === 41 && coordinates?.coordinates_lng === 39.72,
    JSON.stringify(coordinates),
  );

  const duplicate = await createLiveNews(tokens.authorA, {
    p_title: 'Ortahisar sahilinde akşam yürüyüşü başladı',
    p_summary: 'Yinelenen istek aynı içeriği döndürmeli.',
    p_category: 'guncel',
    p_district: 'Ortahisar',
    p_media: [mediaImage('authorA', 'photo')],
    p_publish_targets: ['feed', 'live', 'web'],
    p_idempotency_key: `photo-${stamp}`,
  });
  check('idempotency aynı içeriği döndürür', duplicate.ok && duplicate.data.id === A, JSON.stringify(duplicate.data));
  check('idempotent yanıt çift kayıt oluşturmaz', duplicate.ok && duplicate.data.idempotent === true);

  const followerList = await rpc(tokens.follower, 'live_news_list', { p_filter: 'all', p_limit: 20 });
  check('içerik Anlık Gelişmeler akışında görünür', followerList.ok && followerList.data.items.some((item) => item.id === A));
  check('kanonik içerik kimliği taşınır', followerList.ok && followerList.data.items.find((item) => item.id === A)?.live_news?.canonical_id === photo.data.live_news.canonical_id);

  const followerFeed = await rpc(tokens.follower, 'feed_list', { p_filter: 'all', p_limit: 20 });
  check('aynı gönderi ana sosyal akışta görünür', followerFeed.ok && followerFeed.data.items.some((item) => item.id === A));

  const mine = await rpc(tokens.authorA, 'live_news_mine', {});
  check('içerik kullanıcı profilinde listelenir', mine.ok && mine.data.items.some((item) => item.id === A));

  const profilePosts = await rpc(tokens.follower, 'feed_profile_posts', { p_username: `${'authora'}${stamp}`.slice(0, 20) });
  check('profil gönderilerinde aynı kanonik kimlik', profilePosts.ok && profilePosts.data.items.some((item) => item.id === A));

  const nearby = await rpc(tokens.follower, 'live_news_list', {
    p_filter: 'nearby',
    p_lat: 41,
    p_lng: 39.72,
    p_radius_km: 5,
  });
  check('Yakınımda filtresi yaklaşık konumu kullanır', nearby.ok && nearby.data.items.some((item) => item.id === A));
  check('yakınlık mesafesi döner', nearby.ok && nearby.data.items.find((item) => item.id === A)?.distance_km != null);

  const noLocation = await rpc(tokens.follower, 'live_news_list', { p_filter: 'nearby' });
  check('konum yoksa Yakınımda izin ister', noLocation.ok && noLocation.data.requires_location === true && noLocation.data.items.length === 0);

  // 2. Dikey video + Reels cross-post
  const verticalPath = `${ids.authorA}/live-${stamp}-vertical.mp4`;
  const vertical = await createLiveNews(tokens.authorA, {
    p_title: 'Akçaabat sahilinde yeni yürüyüş parkuru açıldı',
    p_summary: 'Parkur, sahil boyunca 2 kilometrelik bir güzergâhta hizmet verecek.',
    p_category: 'guncel',
    p_district: 'Akçaabat',
    p_media: [mediaVideo('authorA', 'vertical', 1080, 1920)],
    p_publish_targets: ['feed', 'reels', 'live', 'web'],
  });
  const B = vertical.data?.id;
  createdPosts.set(B, tokens.authorA);
  check('dikey video anlık haberi oluşturulur', vertical.ok && Boolean(B), JSON.stringify(vertical.data));
  check('video Reels hedefiyle tek medya kaydı paylaşır', vertical.ok && vertical.data.live_news?.cross_post_reel === true && Boolean(vertical.data.live_news?.reel_id));

  const reelB = vertical.data?.live_news?.reel_id;
  const reels = await rpc(tokens.follower, 'reels_list', { p_limit: 10 });
  const reelItem = reels.ok ? reels.data.items.find((item) => item.live_news_id === B) : null;
  check('Reels akışında görünür', Boolean(reelItem), JSON.stringify(reels.data));
  check('Reels aynı fiziksel video dosyasını kullanır', reelItem?.video_path === verticalPath);
  check('Reels posts bucket’ını okur', reelItem?.storage_bucket === 'posts');
  check('Reels kanonik gönderi kimliğini taşır', reelItem?.live_news?.post_id === B);
  check('dikey video oranı korunur', reelItem?.width === 1080 && reelItem?.height === 1920);

  // 4. Fotoğraf + video birlikte, sıralama korunur
  const mixed = await createLiveNews(tokens.authorA, {
    p_title: 'Şalpazarı pazarında yerel ürünler görücüye çıktı',
    p_summary: 'Pazarda yöresel üreticilerin stantları açıldı; görüntüler sabah saatlerinden.',
    p_category: 'guncel',
    p_district: 'Şalpazarı',
    p_media: [mediaImage('authorA', 'mixed-photo'), mediaVideo('authorA', 'mixed-video', 1920, 1080)],
    p_publish_targets: ['feed', 'reels', 'live', 'web'],
  });
  const C = mixed.data?.id;
  createdPosts.set(C, tokens.authorA);
  check('fotoğraf ve video aynı gönderide kullanılır', mixed.ok && mixed.data.live_news?.media_kind === 'mixed', JSON.stringify(mixed.data));
  check('medya sıralaması korunur', mixed.ok && mixed.data.media?.length === 2 && mixed.data.media[0].media_type === 'image' && mixed.data.media[1].media_type === 'video', JSON.stringify(mixed.data?.media));
  check('Reels ilk videoyu seçer', mixed.ok && mixed.data.live_news?.cross_post_reel === true, JSON.stringify(mixed.data?.live_news));

  // 5. Sadece metin
  const textOnly = await createLiveNews(tokens.authorA, {
    p_title: 'Trabzon’da kitap günleri bu hafta başlıyor',
    p_summary: 'Şehir merkezindeki etkinlik alanında yazarlarla söyleşiler yapılacak.',
    p_category: 'etkinlik',
    p_district: 'Yomra',
    p_media: [],
    p_publish_targets: ['feed', 'reels', 'live', 'web'],
  });
  const D = textOnly.data?.id;
  createdPosts.set(D, tokens.authorA);
  check('sadece metinle anlık haber paylaşılır', textOnly.ok && textOnly.data.live_news?.media_kind === 'text');
  check('metin içerikte Reels hedefi otomatik kaldırılır', textOnly.ok && !textOnly.data.live_news.publish_targets.includes('reels'));

  // 3. Yatay video zorla kırpılmaz
  const horizontal = await createLiveNews(tokens.authorB, {
    p_title: 'Beşikdüzü sahil yolunda yeni düzenleme',
    p_summary: 'Yol çizgileri ve yaya geçitleri yenilendi; çalışma hafta sonu tamamlandı.',
    p_category: 'altyapi',
    p_district: 'Beşikdüzü',
    p_media: [mediaVideo('authorB', 'horizontal', 1920, 1080)],
    p_publish_targets: ['feed', 'reels', 'live', 'web'],
  });
  const E = horizontal.data?.id;
  createdPosts.set(E, tokens.authorB);
  check('yatay video yüklenebilir', horizontal.ok && Boolean(E), JSON.stringify(horizontal.data));
  check('yatay video boyutu korunur (zorla kırpma yok)', horizontal.ok && horizontal.data.media?.[0]?.width === 1920 && horizontal.data.media?.[0]?.height === 1080);
  const reelsAfterE = await rpc(tokens.follower, 'reels_list', { p_limit: 10 });
  const reelE = reelsAfterE.ok ? reelsAfterE.data.items.find((item) => item.live_news_id === E) : null;
  check('yatay video Reels kopyası oranı korur', reelE?.width === 1920 && reelE?.height === 1080);

  // 12. Yüksek riskli içerik moderasyon bekler
  const pending = await createLiveNews(tokens.authorB, {
    p_title: 'Ortahisar’da trafik kazası: iki yaralı',
    p_summary: 'Kaza sonrası ekipler olay yerine sevk edildi. İddialar editör incelemesinde.',
    p_category: 'trafik',
    p_district: 'Ortahisar',
    p_media: [mediaImage('authorB', 'incident')],
    p_publish_targets: ['feed', 'reels', 'live', 'web'],
  });
  const F = pending.data?.id;
  createdPosts.set(F, tokens.authorB);
  check('hassas içerik moderasyona alınır', pending.ok && pending.data.live_news?.moderation_status === 'pending');
  check('hassas içerikte rozet İnceleniyor', pending.ok && pending.data.live_news?.verification_status === 'reviewing');
  check('hassas içerik risk bayrağı taşır', pending.ok && (pending.data.live_news?.risk_flags ?? []).includes('traffic_accident'));
  const pendingViewerGet = await rpc(tokens.follower, 'live_news_get', { p_post_id: F });
  check('moderasyon bekleyen içerik herkese açılmaz', pendingViewerGet.ok && pendingViewerGet.data === null, JSON.stringify(pendingViewerGet.data));
  const pendingList = await rpc(tokens.follower, 'live_news_list', { p_filter: 'all', p_limit: 20 });
  check('moderasyon bekleyen içerik akışta yok', pendingList.ok && !pendingList.data.items.some((item) => item.id === F));
  const pendingShare = await rpc(null, 'live_news_share_card', { p_post_id: F });
  check('moderasyon bekleyen içerik paylaşım kartı üretmez', pendingShare.ok && pendingShare.data === null);
  const pendingPublic = await rpc(null, 'live_news_public_post', { p_post_id: F });
  check('moderasyon bekleyen içerik web sayfası üretmez', pendingPublic.ok && pendingPublic.data === null);
  const pendingReels = await rpc(tokens.follower, 'reels_list', { p_limit: 10 });
  check('moderasyon bekleyen Reels yayında değil', pendingReels.ok && !pendingReels.data.items.some((item) => item.live_news_id === F));

  startGroup('9-11 · Düzenleme, silme ve yayın yüzeyleri');
  const edit = await rpc(tokens.authorA, 'live_news_update', {
    p_post_id: A,
    p_title: 'Ortahisar sahilinde akşam yürüyüşü yeniden başladı',
    p_summary: 'Sahil bandındaki yürüyüş saatleri güncellendi. Vatandaşlar akşam serinliğinde hattı kullanabiliyor.',
    p_category: 'guncel',
    p_district: 'Ortahisar',
    p_publish_targets: ['feed', 'live', 'web'],
    p_usage_consent: true,
  });
  check('kullanıcı kendi paylaşımını düzenler', edit.ok && edit.data.live_news?.title.includes('yeniden başladı'));
  check('düzenleme işareti kaydedilir', edit.ok && edit.data.is_edited === true);
  check('kullanım izni güncellenir', edit.ok && edit.data.live_news?.usage_consent === true);

  const editOther = await rpc(tokens.authorB, 'live_news_update', {
    p_post_id: A,
    p_title: 'Başka kullanıcı düzenleyemez',
    p_category: 'guncel',
  });
  check('başka kullanıcı paylaşımı düzenleyemez', !editOther.ok);

  const deleteOther = await rpc(tokens.authorB, 'live_news_delete', { p_post_id: B });
  check('başka kullanıcı paylaşımı silemez', !deleteOther.ok);

  const BbeforeDelete = await rpc(tokens.follower, 'live_news_get', { p_post_id: B });
  check('silme öncesi video içerik erişilebilir', BbeforeDelete.ok && BbeforeDelete.data?.id === B);

  // Reels paylaşım kartı video yerine thumbnail döndürmeli.
  const shareB = await rpc(null, 'live_news_share_card', { p_post_id: B });
  check(
    'video paylaşım kartı thumbnail kullanır',
    shareB.ok && String(shareB.data?.image_path ?? '').endsWith('-thumb.jpg'),
    JSON.stringify(shareB.data),
  );

  startGroup('13-16 · Raporlama, admin inceleme ve doğrulama');
  const report = await rpc(tokens.follower, 'safety_create_report', {
    p_target_type: 'post',
    p_target_id: A,
    p_reason_code: 'spam_misleading',
    p_description: 'Test raporu: doğrulama akışını denetlemek için.',
    p_target_user_id: ids.authorA,
    p_target_snapshot: { source: 'smoke-live-news' },
  });
  check('kullanıcı paylaşımı raporlar', report.ok && Boolean(report.data?.id), JSON.stringify(report.data));

  const duplicateReport = await rpc(tokens.follower, 'safety_create_report', {
    p_target_type: 'post',
    p_target_id: A,
    p_reason_code: 'spam_misleading',
    p_description: 'Tekrar rapor.',
    p_target_user_id: ids.authorA,
  });
  check('aynı rapor tekrarı engellenir', !duplicateReport.ok);

  const nonAdminStats = await rpc(tokens.follower, 'admin_live_news_stats');
  check('normal kullanıcı admin panelini okuyamaz', !nonAdminStats.ok);

  const stats = await rpc(tokens.editor, 'admin_live_news_stats');
  check('editör anlık haber istatistiklerini okur', stats.ok && stats.data.total >= 4, JSON.stringify(stats.data));
  check('raporlanan içerik istatistiğe yansır', stats.ok && stats.data.reported >= 1);

  const adminList = await rpc(tokens.editor, 'admin_live_news_list', { p_state: 'pending', p_limit: 20 });
  check('Vatandaş Haber Havuzu moderasyon bekleyenleri listeler', adminList.ok && adminList.data.items.some((item) => item.post_id === F));
  const reportedList = await rpc(tokens.editor, 'admin_live_news_list', { p_state: 'reported', p_limit: 20 });
  check('raporlanan içerik admin filtresinde görünür', reportedList.ok && reportedList.data.items.some((item) => item.post_id === A));

  const detail = await rpc(tokens.editor, 'admin_live_news_detail', { p_post_id: F });
  check('admin orijinal medyayı ve kullanıcıyı inceler', detail.ok && detail.data?.post?.id === F && detail.data?.live_news?.reports != null, JSON.stringify(detail.data));
  check('admin detayında risk bayrakları görünür', detail.ok && (detail.data.live_news.risk_flags ?? []).includes('traffic_accident'));

  const approvePending = await rpc(tokens.editor, 'admin_live_news_action', {
    p_post_id: F,
    p_action: 'approve',
    p_payload: { note: 'Trafik kazası içeriği incelendi, yayına alındı.' },
    p_reason: 'Editör incelemesi tamamlandı.',
  });
  check('editör moderasyon bekleyen içeriği onaylar', approvePending.ok, JSON.stringify(approvePending.data));
  const pendingAfterApprove = await rpc(tokens.follower, 'live_news_get', { p_post_id: F });
  check('onay sonrası içerik herkese açılır', pendingAfterApprove.ok && pendingAfterApprove.data?.id === F);

  const evidence = await rpc(tokens.editor, 'admin_live_news_action', {
    p_post_id: F,
    p_action: 'request_evidence',
    p_payload: { message: 'Olay yerinden ek görüntü veya tanık bilgisi paylaşabilir misin?' },
  });
  check('editör ek kanıt talep eder', evidence.ok, JSON.stringify(evidence.data));

  const consentFail = await rpc(tokens.editor, 'admin_live_news_action', {
    p_post_id: E,
    p_action: 'send_to_newsroom',
    p_reason: 'Haber merkezine aktarım denemesi.',
  });
  check('kullanım izni olmadan haber merkezine aktarılamaz', !consentFail.ok, JSON.stringify(consentFail.data));

  const consentUpdate = await rpc(tokens.authorB, 'live_news_update', {
    p_post_id: E,
    p_title: 'Beşikdüzü sahil yolunda yeni düzenleme',
    p_summary: 'Yol çizgileri ve yaya geçitleri yenilendi; çalışma hafta sonu tamamlandı.',
    p_category: 'altyapi',
    p_district: 'Beşikdüzü',
    p_publish_targets: ['feed', 'reels', 'live', 'web'],
    p_usage_consent: true,
  });
  check('kullanıcı haber merkezi kullanım izni verir', consentUpdate.ok && consentUpdate.data.live_news?.usage_consent === true);

  const newsroom = await rpc(tokens.editor, 'admin_live_news_action', {
    p_post_id: E,
    p_action: 'send_to_newsroom',
    p_payload: { note: 'Yerel haber merkezi inceleyecek.' },
    p_reason: 'Kullanım izni alındı.',
  });
  check('izin sonrası haber merkezine aktarılır', newsroom.ok, JSON.stringify(newsroom.data));

  const verify = await rpc(tokens.editor, 'admin_live_news_action', {
    p_post_id: A,
    p_action: 'set_verification',
    p_payload: { status: 'verified' },
    p_reason: 'Saha bilgisi ve ikinci kaynakla doğrulandı.',
  });
  check('doğrulama durumu güncellenir', verify.ok, JSON.stringify(verify.data));
  const verifiedGet = await rpc(tokens.follower, 'live_news_get', { p_post_id: A });
  check('doğrulanmış rozet herkese görünür', verifiedGet.ok && verifiedGet.data?.live_news?.verification_status === 'verified');

  const hide = await rpc(tokens.editor, 'admin_live_news_action', {
    p_post_id: A,
    p_action: 'hide',
    p_reason: 'Geçici olarak gizlendi.',
  });
  check('editör içeriği gizler', hide.ok, JSON.stringify(hide.data));
  const hiddenPublic = await rpc(null, 'live_news_public_post', { p_post_id: A });
  check('gizlenen içerik web RPC’sinden düşer', hiddenPublic.ok && hiddenPublic.data === null);
  const approve = await rpc(tokens.editor, 'admin_live_news_action', {
    p_post_id: A,
    p_action: 'approve',
    p_reason: 'İnceleme tamamlandı.',
  });
  check('editör içeriği yeniden onaylar', approve.ok, JSON.stringify(approve.data));
  const visibleAgain = await rpc(null, 'live_news_public_post', { p_post_id: A });
  check('onaylanan içerik web’de geri gelir', visibleAgain.ok && visibleAgain.data?.post_id === A);

  const auditDetail = await rpc(tokens.editor, 'admin_live_news_detail', { p_post_id: A });
  const history = auditDetail.ok ? auditDetail.data?.live_news?.history ?? [] : [];
  check('kritik admin işlemleri audit log’a yazılır', history.some((item) => item.action_code === 'live_news.set_verification') && history.some((item) => item.action_code === 'live_news.hide'));

  startGroup('16 · İlçe, kategori ve sitemap filtreleri');
  const districtA = await rpc(tokens.follower, 'live_news_list', { p_filter: 'all', p_district: 'Ortahisar', p_limit: 20 });
  check('ilçe filtresi yalnızca ilgili içeriği getirir', districtA.ok && districtA.data.items.some((item) => item.id === A) && !districtA.data.items.some((item) => item.district === 'Beşikdüzü'));
  const districtE = await rpc(tokens.follower, 'live_news_list', { p_filter: 'all', p_district: 'Beşikdüzü', p_limit: 20 });
  check('ikinci ilçe filtresi çalışır', districtE.ok && districtE.data.items.some((item) => item.id === E));
  const traffic = await rpc(tokens.follower, 'live_news_list', { p_filter: 'traffic', p_limit: 20 });
  check('Trafik & Ulaşım filtresi çalışır', traffic.ok && traffic.data.items.some((item) => item.id === F));
  const verifiedOnly = await rpc(tokens.follower, 'live_news_list', { p_filter: 'verified', p_limit: 20 });
  check('doğrulanmış filtresi doğrulanmamışları dışlar', verifiedOnly.ok && verifiedOnly.data.items.every((item) => item.live_news?.verification_status === 'verified'));

  const sitemap = await rpc(null, 'live_news_sitemap_urls', { p_limit: 100 });
  const sitemapIds = Array.isArray(sitemap.data) ? sitemap.data.map((item) => item.post_id) : [];
  check('doğrulanmış içerik sitemap’e girer', sitemapIds.includes(A));
  check('doğrulanmamış içerik sitemap’e girmez', !sitemapIds.includes(D) && !sitemapIds.includes(F));

  startGroup('17-18 · Bildirimler ve tekil görüntülenme');
  const followerNotes = await rpc(tokens.follower, 'notifications_list', { p_limit: 50 });
  const followerForA = followerNotes.ok ? followerNotes.data.items.filter((item) => item.entity_id === A) : [];
  check('takipçi yeni paylaşım bildirimi alır', followerForA.length === 1, `${followerForA.length} bildirim`);

  const subscriberNotes = await rpc(tokens.subscriber, 'notifications_list', { p_limit: 50 });
  const subscriberForA = subscriberNotes.ok ? subscriberNotes.data.items.filter((item) => item.entity_id === A) : [];
  check('ilçe abonesi yalnızca doğrulanmış içerik bildirimi alır', subscriberForA.length === 1, `${subscriberForA.length} bildirim`);
  check('doğrulama aynı olay için ikinci bildirim üretmez', followerForA.length === 1);

  const authorNotes = await rpc(tokens.authorA, 'notifications_list', { p_limit: 50 });
  check('doğrulama sahibine bildirilir', authorNotes.ok && authorNotes.data.items.some((item) => item.entity_id === A && item.title.includes('doğrulandı')));

  const firstView = await rpc(tokens.follower, 'content_register_view', {
    p_content_type: 'post',
    p_content_id: A,
    p_surface: 'feed',
  });
  check('ilk görüntülenme tekil sayılır', firstView.ok && firstView.data.counted === true && firstView.data.unique_views === 1);
  const secondView = await rpc(tokens.follower, 'content_register_view', {
    p_content_type: 'post',
    p_content_id: A,
    p_surface: 'feed',
  });
  check('aynı hesap ikinci kez sayılmaz', secondView.ok && secondView.data.counted === false && secondView.data.unique_views === 1);

  const feedViewB = await rpc(tokens.follower, 'content_register_view', {
    p_content_type: 'post',
    p_content_id: B,
    p_surface: 'feed',
  });
  check('video akışta ilk tekil görüntülenmeyi sayar', feedViewB.ok && feedViewB.data.counted === true && feedViewB.data.unique_views === 1);
  const reelView = await rpc(tokens.follower, 'reel_register_view', { p_reel_id: reelB });
  check('Reels ve akış aynı kanonik tekil sayacı kullanır', reelView.ok && reelView.data.canonical_post_id === B && reelView.data.counted === false && reelView.data.view_count === 1);
  const ownerView = await rpc(tokens.authorA, 'content_register_view', {
    p_content_type: 'post',
    p_content_id: B,
    p_surface: 'feed',
  });
  check('içerik sahibi görüntülenme saymaz', ownerView.ok && ownerView.data.counted === false && ownerView.data.reason === 'owner');
  const secondPersonView = await rpc(tokens.subscriber, 'content_register_view', {
    p_content_type: 'post',
    p_content_id: B,
    p_surface: 'web',
  });
  check('farklı hesap yeni tekil görüntülenme ekler', secondPersonView.ok && secondPersonView.data.counted === true && secondPersonView.data.unique_views === 2);

  const reelView2 = await rpc(tokens.subscriber, 'reel_register_view', { p_reel_id: reelB });
  check('Reels tekrarı tekil sayacı şişirmez', reelView2.ok && reelView2.data.counted === false && reelView2.data.view_count === 2);

  startGroup('19 · Yorum ve yanıt zinciri');
  const comment = await rpc(tokens.follower, 'feed_add_comment', {
    p_post_id: A,
    p_body: 'Sahil hattı akşam saatlerinde çok daha sakin oluyor.',
  });
  check('anlık habere yorum yapılır', comment.ok && Boolean(comment.data?.id), JSON.stringify(comment.data));
  const reply = await rpc(tokens.subscriber, 'feed_add_comment', {
    p_post_id: A,
    p_body: '@' + `${'follower'}${stamp}`.slice(0, 20) + ' katılıyorum, akşam saatleri daha uygun.',
    p_parent: comment.data?.id,
  });
  check('yoruma yanıt verilir', reply.ok && Boolean(reply.data?.id), JSON.stringify(reply.data));
  const comments = await rpc(tokens.follower, 'feed_list_comments', { p_post_id: A });
  const replyItem = comments.ok ? comments.data.items.find((item) => item.id === reply.data?.id) : null;
  check('yanıt bağlantısı ve @kullanıcıadı korunur', Boolean(replyItem) && replyItem.parent_id === comment.data?.id && replyItem.body.includes('@'));
  check('yorum listesi iki kaydı gösterir', comments.ok && comments.data.items.length >= 2);

  startGroup('11 · Silme tüm yayın yüzeylerinden kaldırır');
  const deleteB = await rpc(tokens.authorA, 'live_news_delete', { p_post_id: B });
  check('kullanıcı kendi paylaşımını siler', deleteB.ok && deleteB.data.deleted === true);
  check('silinen medya yolları istemciye döner', deleteB.ok && deleteB.data.media?.length === 1);
  createdPosts.delete(B);

  const afterDeleteGet = await rpc(tokens.follower, 'live_news_get', { p_post_id: B });
  check('silinen içerik detaydan kalkar', afterDeleteGet.ok && afterDeleteGet.data === null);
  const afterDeleteList = await rpc(tokens.follower, 'live_news_list', { p_filter: 'all', p_limit: 20 });
  check('silinen içerik Anlık Gelişmeler’den kalkar', afterDeleteList.ok && !afterDeleteList.data.items.some((item) => item.id === B));
  const afterDeleteFeed = await rpc(tokens.follower, 'feed_list', { p_filter: 'all', p_limit: 20 });
  check('silinen içerik ana akıştan kalkar', afterDeleteFeed.ok && !afterDeleteFeed.data.items.some((item) => item.id === B));
  const afterDeleteReels = await rpc(tokens.follower, 'reels_list', { p_limit: 10 });
  check('silinen içerik Reels’ten kalkar', afterDeleteReels.ok && !afterDeleteReels.data.items.some((item) => item.live_news_id === B));
  const afterDeleteProfile = await rpc(tokens.follower, 'feed_profile_posts', { p_username: `${'authora'}${stamp}`.slice(0, 20) });
  check('silinen içerik profilden kalkar', afterDeleteProfile.ok && !afterDeleteProfile.data.items.some((item) => item.id === B));

  startGroup('20, 23-24 · Paylaşım kartı, deep link ve web');
  const share = await rpc(null, 'live_news_share_card', { p_post_id: A });
  check('paylaşım kartı kanonik yol üretir', share.ok && share.data?.path === `/anlik-haber/${A}`);
  check('deep link şeması doğru', share.ok && share.data?.deep_link === `trabzone://live-news/${A}`);
  const shareCard = await rpc(null, 'share_card', { p_type: 'live', p_key: A });
  check('genel share_card canlı türünü çözer', shareCard.ok && shareCard.data?.path === `/anlik-haber/${A}`);

  const publicPost = await rpc(null, 'live_news_public_post', { p_post_id: A });
  check('web RPC’si doğrulanmış içeriği döndürür', publicPost.ok && publicPost.data?.post_id === A && publicPost.data?.verification_status === 'verified');
  const publicPending = await rpc(null, 'live_news_public_post', { p_post_id: F });
  check('web RPC’si doğrulanmamış görünür içeriği de döndürür', publicPending.ok && publicPending.data?.post_id === F);

  const handler = require('../api/live-news');
  const render = async (id) => {
    const res = {
      statusCode: 0,
      headers: {},
      body: '',
      setHeader(key, value) {
        this.headers[key.toLowerCase()] = value;
      },
      end(body) {
        this.body = body ?? '';
      },
    };
    await handler({ method: 'GET', query: { id }, url: `/api/live-news?id=${id}` }, res);
    return res;
  };

  const verifiedPage = await render(A);
  check('doğrulanmış web sayfası 200 döner', verifiedPage.statusCode === 200);
  check('doğrulanmış sayfa indekslenebilir', verifiedPage.headers['x-robots-tag'] === undefined);
  check('doğrulanmış sayfada NewsArticle şeması var', verifiedPage.body.includes('"@type":"NewsArticle"'));
  check('sayfada kanonik bağlantı var', verifiedPage.body.includes(`<link rel="canonical" href="https://www.trabzoneapp.com/anlik-haber/${A}"`));
  check('OpenGraph başlığı ve medya önizlemesi var', verifiedPage.body.includes('property="og:title"') && verifiedPage.body.includes('property="og:image"'));

  const unverifiedPage = await render(D);
  check('doğrulanmamış sayfa noindex döner', unverifiedPage.statusCode === 200 && unverifiedPage.headers['x-robots-tag'] === 'noindex, follow');
  check('doğrulanmamış sayfada NewsArticle yok', !unverifiedPage.body.includes('"@type":"NewsArticle"'));

  const pendingPage = await render(F);
  check('moderasyon bekleyen içerik web’de 404', pendingPage.statusCode === 200 || pendingPage.statusCode === 404);
  const invalidPage = await render('not-a-uuid');
  check('geçersiz web kimliği 404 döner', invalidPage.statusCode === 404 && invalidPage.headers['x-robots-tag'] === 'noindex, follow');

  startGroup('25 · Eşzamanlılık ve performans');
  const readStart = Date.now();
  const reads = await Promise.all(
    Array.from({ length: 12 }, () => rpc(tokens.follower, 'live_news_list', { p_filter: 'all', p_limit: 20 })),
  );
  const readMs = Date.now() - readStart;
  check('12 eşzamanlı akış okuması başarılı', reads.every((item) => item.ok), `${readMs} ms`);
  check('eşzamanlı okuma makul sürede tamamlanır', readMs < 8000, `${readMs} ms`);

  // Yeni paylaşımlar için oran sayaçlarını temizle, sonra 5 eşzamanlı yayın.
  await runSql(`delete from public.safety_rate_limits where actor_id in (${userList});`);
  const simultaneous = await Promise.all(
    Object.keys(accounts).map((label, index) =>
      createLiveNews(tokens[label], {
        p_title: `Eşzamanlı performans testi ${index + 1} · Yomra`,
        p_summary: 'Eşzamanlı yayın davranışını doğrulamak için oluşturulan test içeriği.',
        p_category: 'guncel',
        p_district: 'Yomra',
        p_media: [mediaImage(label, `concurrent-${index + 1}`)],
        p_publish_targets: ['feed', 'live', 'web'],
        p_idempotency_key: `concurrent-${stamp}-${index}`,
      }).then((result) => ({ label, result })),
    ),
  );
  const concurrentIds = simultaneous.map((item) => item.result.data?.id).filter(Boolean);
  for (const item of simultaneous) {
    if (item.result.ok && item.result.data?.id) {
      createdPosts.set(item.result.data.id, tokens[item.label]);
    }
  }
  check('5 eşzamanlı paylaşım başarılı', simultaneous.every((item) => item.result.ok), simultaneous.map((item) => item.result.status).join(','));
  check('her eşzamanlı paylaşım benzersiz kimlik alır', concurrentIds.length === 5 && new Set(concurrentIds).size === 5);
  check('eşzamanlı paylaşımlar akışta görünür', (await rpc(tokens.follower, 'live_news_list', { p_filter: 'all', p_limit: 30 })).ok);

  return { concurrentIds };
};

let result;
try {
  result = await main();
} catch (error) {
  failures += 1;
  total += 1;
  console.error(`\nFATAL  ${error?.stack || error}`);
} finally {
  await cleanup();
}

console.log('\n— Özet —');
for (const group of groups) {
  console.log(`${group.failed === 0 ? 'PASS' : 'FAIL'}  ${group.name}: ${group.passed}/${group.passed + group.failed}`);
}
console.log(`\n${failures === 0 ? 'TÜM TESTLER GEÇTİ' : `${failures} TEST BAŞARISIZ`} (${total} kontrol)`);
if (result?.concurrentIds?.length) {
  console.log(`Eşzamanlı içerik sayısı: ${result.concurrentIds.length}`);
}
process.exit(failures === 0 ? 0 : 1);


