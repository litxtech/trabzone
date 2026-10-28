-- Günlük otomatik blog üretimi (DeepSeek + pg_cron + pg_net).
--
-- Amaç: her gün 2 uzun, gerçek veriye dayanan Trabzon yazısı yayınlamak.
-- DeepSeek anahtarı yalnızca edge function ortamında durur. Bu migration:
--   * konu havuzunu (blog_ai_topics) ve ayarları (blog_ai_settings) kurar,
--   * cron çağrısını doğrulayan vault anahtarını üretir,
--   * blog_ai_tick() ile 15 dakikada bir "yazılacak yazı var mı?" kontrolü yapar,
--   * edge function'ın konu sahiplenmesi / bitirmesi için RPC'leri tanımlar.
--
-- Yazıların yazarı trabzonapp, durumu published olur.

begin;

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- 1. Konu havuzu
-- ---------------------------------------------------------------------------
create table if not exists public.blog_ai_topics (
  id           bigserial primary key,
  topic        text not null unique,
  category     text not null default 'Yaşam',
  keywords     text[] not null default '{}'::text[],
  audience     text,
  notes        text,
  image_url    text,
  image_alt    text,
  sort_order   integer not null default 100,
  status       text not null default 'pending'
                 check (status in ('pending', 'running', 'used', 'failed')),
  attempts     integer not null default 0,
  last_error   text,
  claimed_at   timestamptz,
  used_post_id uuid references public.blog_posts (id) on delete set null,
  used_at      timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists blog_ai_topics_status_idx
  on public.blog_ai_topics (status, sort_order, id);

alter table public.blog_ai_topics enable row level security;

drop policy if exists blog_ai_topics_admin on public.blog_ai_topics;
create policy blog_ai_topics_admin on public.blog_ai_topics
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant all on public.blog_ai_topics to service_role;
grant select on public.blog_ai_topics to authenticated;
grant usage, select on sequence public.blog_ai_topics_id_seq to service_role;

-- ---------------------------------------------------------------------------
-- 2. Ayarlar (tek satır)
-- ---------------------------------------------------------------------------
create table if not exists public.blog_ai_settings (
  id             boolean primary key default true check (id),
  enabled        boolean not null default true,
  posts_per_day  integer not null default 2 check (posts_per_day between 1 and 6),
  min_gap_minutes integer not null default 240 check (min_gap_minutes between 30 and 1440),
  worker_url     text not null default 'https://nzvoufcywppavaioirac.supabase.co',
  author_name    text not null default 'trabzonapp',
  model          text not null default 'deepseek-chat',
  target_words   integer not null default 1500 check (target_words between 900 and 2600),
  timezone       text not null default 'Europe/Istanbul',
  last_tick_at   timestamptz,
  last_post_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

insert into public.blog_ai_settings (id) values (true)
on conflict (id) do nothing;

alter table public.blog_ai_settings enable row level security;

drop policy if exists blog_ai_settings_admin on public.blog_ai_settings;
create policy blog_ai_settings_admin on public.blog_ai_settings
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant all on public.blog_ai_settings to service_role;
grant select on public.blog_ai_settings to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Konu havuzu tohumu (mevcut yazılarla çakışmayan, derinlemesine konular)
-- ---------------------------------------------------------------------------
insert into public.blog_ai_topics (topic, category, keywords, audience, notes, image_url, image_alt, sort_order)
select
  x.topic, x.category, x.keywords, x.audience, x.notes, x.image_url, x.image_alt, x.sort_order
from jsonb_to_recordset($topics$[
  {"topic":"Trabzon'da semt semt oturma rehberi: Beşirli, Yıldızlı, Konaklar ve Bostancı karşılaştırması","category":"Yaşam","keywords":["trabzon semtleri","beşirli","yıldızlı","konaklar","trabzon'da oturulacak yerler"],"audience":"Trabzon'a taşınmayı düşünen aileler ve çalışanlar","notes":"Her semt için ulaşım, kira bandı, gürültü, sahil erişimi ve markete yürüme mesafesi gibi somut kriterler kullan. Fiyatları 'yaklaşık' olarak ver, uydurma rakam üretme. Karşılaştırma tablosu şart.","image_url":"https://upload.wikimedia.org/wikipedia/commons/thumb/9/9c/Trabzon_Meydan_Park_%281%29.jpg/1280px-Trabzon_Meydan_Park_%281%29.jpg","image_alt":"Trabzon Meydan Parkı ve çevresindeki şehir dokusu","sort_order":10},
  {"topic":"Trabzon'da toplu taşıma nasıl çalışır? Dolmuş, otobüs, Trabzonkart ve aktarma pratikleri","category":"Ulaşım","keywords":["trabzon toplu taşıma","trabzon dolmuş","trabzonkart","trabzon otobüs saatleri"],"audience":"Araçsız yaşayan öğrenciler ve yeni taşınanlar","notes":"Hat numarası uydurma; hat gruplarını ve yönleri tarif et. Kart dolumu, aktarma ve gece saatleri gibi pratik konulara gir. Güncel tarife için resmi kanalı işaret et.","image_url":"https://upload.wikimedia.org/wikipedia/commons/thumb/0/01/Trabzon_Meydan.jpg/1280px-Trabzon_Meydan.jpg","image_alt":"Trabzon Meydan'da şehir içi ulaşımın merkezi","sort_order":20},
  {"topic":"Trabzon'da araç kullanmak: trafik, park, radar ve kış lastiği gerçeği","category":"Ulaşım","keywords":["trabzon trafik","trabzon park yeri","trabzon radar","kış lastiği trabzon"],"audience":"Trabzon'da araç sahibi olan veya olacak sürücüler","notes":"Sahil yolu, Meydan çevresi ve ilçe bağlantıları üzerinden somut örnekler ver. Cezai tutar uydurma; 'güncel tarife kontrol edilmeli' de.","image_url":"https://upload.wikimedia.org/wikipedia/commons/thumb/0/03/Trabzon_cityscape.jpg/1280px-Trabzon_cityscape.jpg","image_alt":"Trabzon şehir merkezinin yamaçlara yayılan görünümü","sort_order":30},
  {"topic":"Trabzon'da kış: nem, yağmur, ısınma ve günlük hayatı kolaylaştıran alışkanlıklar","category":"Yaşam","keywords":["trabzon kış","trabzon nem","trabzon ısınma","karadeniz kışı"],"audience":"Trabzon'a yeni taşınanlar ve öğrenciler","notes":"Karadeniz ikliminin nem etkisini somut anlat: çamaşır, küf, ayakkabı, ulaşım. Abartıya kaçma, korku dili kullanma.","image_url":"https://upload.wikimedia.org/wikipedia/commons/thumb/0/0f/Trabzon_City_Centre.jpg/1280px-Trabzon_City_Centre.jpg","image_alt":"Trabzon şehir merkezinde yağmurlu bir gün","sort_order":40},
  {"topic":"Trabzon'da deprem gerçeği ve bina güvenliği: kiracı ve ev alıcısı neye bakmalı?","category":"Emlak","keywords":["trabzon deprem","trabzon bina güvenliği","trabzon zemin","deprem yönetmeliği"],"audience":"Trabzon'da ev kiralayan veya satın alan herkes","notes":"AFAD ve Türkiye Bina Deprem Yönetmeliği 2018 çerçevesinde konuş. Korku yayma, somut kontrol listesi ver: yapı yaşı, zemin, kolon, ruhsat. Uydurma risk skoru verme.","image_url":"https://upload.wikimedia.org/wikipedia/commons/thumb/0/03/Trabzon_cityscape.jpg/1280px-Trabzon_cityscape.jpg","image_alt":"Trabzon'da yamaçlara kurulmuş konut dokusu","sort_order":50},
  {"topic":"Trabzon'da sağlık hizmetleri: hastaneler, randevu, acil ve eczane pratikleri","category":"Şehir","keywords":["trabzon hastane","trabzon acil","trabzon eczane","mhrs trabzon"],"audience":"Trabzon'da yaşayanlar ve yeni taşınanlar","notes":"Kurum adlarını doğru kullan (Kanuni Eğitim ve Araştırma Hastanesi, KTÜ Farabi, ilçe devlet hastaneleri). Hekim adı veya randevu garantisi verme.","image_url":"https://upload.wikimedia.org/wikipedia/commons/thumb/0/0f/Trabzon_City_Centre.jpg/1280px-Trabzon_City_Centre.jpg","image_alt":"Trabzon şehir merkezi","sort_order":60},
  {"topic":"Trabzon'da okullar ve eğitim: devlet okulu, özel okul ve LGS sürecinde aileler ne bilmeli?","category":"Eğitim","keywords":["trabzon okulları","trabzon özel okul","lgs trabzon","trabzon eğitim"],"audience":"Trabzon'da çocuğu okula gidecek aileler","notes":"Okul adı ve başarı sıralaması uydurma. Kayıt bölgesi, servis, yemek, rehberlik gibi pratik başlıklara odaklan.","image_url":"https://upload.wikimedia.org/wikipedia/commons/thumb/0/0f/Trabzon_City_Centre.jpg/1280px-Trabzon_City_Centre.jpg","image_alt":"Trabzon şehir merkezinde günlük yaşam","sort_order":70},
  {"topic":"Trabzon'da genç olmak: kafe kültürü, spor, etkinlik ve sosyalleşme rotaları","category":"Yaşam","keywords":["trabzon gençlik","trabzon kafe","trabzon etkinlik","trabzon sosyal hayat"],"audience":"18-30 yaş arası Trabzonlular ve öğrenciler","notes":"Mekân adı uydurma; bilinen bölgeleri (Meydan, Beşirli, KTÜ çevresi) tarif et. Bütçe dostu ve ücretli seçenekleri ayır.","image_url":"https://upload.wikimedia.org/wikipedia/commons/thumb/9/9c/Trabzon_Meydan_Park_%281%29.jpg/1280px-Trabzon_Meydan_Park_%281%29.jpg","image_alt":"Trabzon Meydan Parkı'nda günlük hayat","sort_order":80},
  {"topic":"Trabzon'da emeklilik hayatı: sahil, sağlık, maliyet ve sosyal çevre","category":"Yaşam","keywords":["trabzon emekli","trabzon'da emeklilik","trabzon yaşam maliyeti","trabzon sahil"],"audience":"Emekliliğini Trabzon'da geçirmeyi düşünenler","notes":"Sağlık erişimi, yürüyüş alanları, kira bandı ve kış koşullarını dengeli anlat. Fiyat uydurma, yaklaşık aralık kullan.","image_url":"https://upload.wikimedia.org/wikipedia/commons/thumb/9/9c/Trabzon_Meydan_Park_%281%29.jpg/1280px-Trabzon_Meydan_Park_%281%29.jpg","image_alt":"Trabzon Meydan Parkı","sort_order":90},
  {"topic":"Trabzon'da balık tezgahı rehberi: hamsi, mezgit, istavrit ve taze balık nasıl seçilir?","category":"Yemek ve Lezzet","keywords":["trabzon balık","trabzon hamsi","trabzon balık pazarı","taze balık nasıl anlaşılır"],"audience":"Trabzon'da balık alacak ve pişirecek herkes","notes":"Mevsim ve tazelik işaretlerine odaklan. Fiyat verme; balık fiyatı günlük değişir. İç temizleme ve saklama pratikleri ekle.","image_url":"https://upload.wikimedia.org/wikipedia/commons/b/b7/Trabzon%2Charbour.jpg","image_alt":"Trabzon limanında balıkçı tekneleri","sort_order":100},
  {"topic":"Trabzon'da kahve ve çay kültürü: üçüncü nesil kafeler, çay bahçeleri ve çalışma köşeleri","category":"Yemek ve Lezzet","keywords":["trabzon kafe","trabzon kahve","trabzon çay bahçesi","trabzon'da çalışılacak kafe"],"audience":"Trabzon'da sosyalleşen ve uzaktan çalışanlar","notes":"İşletme adı uydurma. Bölge ve konsept tarif et; fiyat bandı yerine 'bütçe dostu / orta / yüksek' ayrımı yap.","image_url":"https://upload.wikimedia.org/wikipedia/commons/thumb/0/01/Trabzon_Meydan.jpg/1280px-Trabzon_Meydan.jpg","image_alt":"Trabzon Meydan çevresindeki kafe ve dükkânlar","sort_order":110},
  {"topic":"Trabzon'da semt pazarları: hangi gün, ne alınır, pazarlık nasıl yapılır?","category":"Alışveriş","keywords":["trabzon pazar","trabzon semt pazarı","trabzon pazartesi pazarı","karadeniz pazar kültürü"],"audience":"Trabzon'da günlük alışveriş yapan aileler","notes":"Pazar günü ve yeri uydurma; 'semtten semte değişir, belediye duyurularını kontrol edin' de. Mevsim ürünleri, fiyat-kalite dengesi ve pazarlık kültürüne gir.","image_url":"https://upload.wikimedia.org/wikipedia/commons/thumb/e/ed/Trabzon_Ak%C3%A7aabat.jpg/1280px-Trabzon_Ak%C3%A7aabat.jpg","image_alt":"Akçaabat'ta günlük yaşam","sort_order":120},
  {"topic":"Trabzon'da fındık ekonomisi: hasat, fiyat, kooperatif ve üreticinin gerçekleri","category":"Kariyer ve Girişim","keywords":["trabzon fındık","fındık fiyatı","fındık hasadı","trabzon tarım ekonomisi"],"audience":"Trabzon'da tarımla ilgilenenler ve ekonomi meraklıları","notes":"Fındık fiyatı verme; fiyatın serbest piyasa ve TMO alımlarına göre değiştiğini söyle. Hasat işçiliği, bahçe bakımı ve kooperatifleşme başlıklarını işle.","image_url":"https://upload.wikimedia.org/wikipedia/commons/thumb/4/49/Village_near_%C3%87aykara%2C_Trabzon.jpg/1280px-Village_near_%C3%87aykara%2C_Trabzon.jpg","image_alt":"Çaykara kırsalında yayla ve tarım arazileri","sort_order":130},
  {"topic":"Trabzon'da çay tarımı: Of ve Çaykara çevresinde çay bahçeleri, hasat ve günlük iş akışı","category":"Kariyer ve Girişim","keywords":["trabzon çay","of çay","çaykara çay","çay hasadı"],"audience":"Trabzon'un doğusunu ve tarım ekonomisini merak edenler","notes":"Çay tarımının Rize ağırlıklı olduğunu, Trabzon'un doğusunda da bahçeler bulunduğunu doğru anlat. Kota ve fiyat uydurma.","image_url":"https://upload.wikimedia.org/wikipedia/commons/thumb/8/86/Old_house_in_%C3%87aykara.jpg/1280px-Old_house_in_%C3%87aykara.jpg","image_alt":"Çaykara'da geleneksel bir köy evi","sort_order":140},
  {"topic":"Trabzon'da inşaat ve mühendislik kariyeri: sahadan ofise iş bulma yolları","category":"Kariyer ve Girişim","keywords":["trabzon inşaat iş","trabzon mühendis iş ilanları","trabzon teknik kariyer"],"audience":"İnşaat, harita ve makine mühendisliği mezunları","notes":"Firma adı uydurma. Proje türleri (yol, tünel, konut, liman), sertifikalar ve saha deneyiminin önemine odaklan. Maaş için geniş aralık ver.","image_url":"https://upload.wikimedia.org/wikipedia/commons/thumb/0/03/Trabzon_cityscape.jpg/1280px-Trabzon_cityscape.jpg","image_alt":"Trabzon'da yamaçlarda süren kentsel yapılaşma","sort_order":150},
  {"topic":"Trabzon'da sağlık sektöründe iş: hastane, klinik ve sağlık turizmi fırsatları","category":"Kariyer ve Girişim","keywords":["trabzon hastane iş ilanları","trabzon sağlık turizmi","trabzon hemşire iş"],"audience":"Sağlık çalışanları ve kariyer değiştirmek isteyenler","notes":"Kurum adı uydurma, ilan garantisi verme. Dil yeterliliği, vardiya, sertifika ve sağlık turizmi dinamiklerini anlat.","image_url":"https://upload.wikimedia.org/wikipedia/commons/thumb/0/0f/Trabzon_City_Centre.jpg/1280px-Trabzon_City_Centre.jpg","image_alt":"Trabzon şehir merkezi","sort_order":160},
  {"topic":"Trabzon'da yazılım ve bilişim kariyeri: uzaktan iş, yerel firma ve serbest çalışma","category":"Kariyer ve Girişim","keywords":["trabzon yazılım iş","trabzon bilişim","trabzon uzaktan çalışma","trabzon yazılımcı maaş"],"audience":"Yazılım öğrenenler ve Trabzon'da remote çalışanlar","notes":"Maaş için geniş aralık ve 'deneyime göre' vurgusu yap. Portföy, İngilizce, GitHub ve yerel topluluk önerileri ver.","image_url":"https://upload.wikimedia.org/wikipedia/commons/thumb/6/64/Karadeniz_Teknik_%C3%9Cniversitesi_01_%D0%A2%D0%B5%D1%85%D0%BD%D0%B8%D1%87%D0%BA%D0%B8_%D1%83%D0%BD%D0%B8%D0%B2%D0%B5%D1%80%D0%B7%D0%B8%D1%82%D0%B5%D1%82_%D0%BD%D0%B0_%D0%A6%D1%80%D0%BD%D0%BE%D0%BC_%D0%BC%D0%BE%D1%80%D1%83.jpg/1280px-Karadeniz_Teknik_%C3%9Cniversitesi_01_%D0%A2%D0%B5%D1%85%D0%BD%D0%B8%D1%87%D0%BA%D0%B8_%D1%83%D0%BD%D0%B8%D0%B2%D0%B5%D1%80%D0%B7%D0%B8%D1%82%D0%B5%D1%82_%D0%BD%D0%B0_%D0%A6%D1%80%D0%BD%D0%BE%D0%BC_%D0%BC%D0%BE%D1%80%D1%83.jpg","image_alt":"Karadeniz Teknik Üniversitesi Kanuni Kampüsü","sort_order":170},
  {"topic":"Trabzon'da öğrenci bütçesi: KTÜ çevresinde yurt, kafe, ulaşım ve harçlık planı","category":"Yaşam","keywords":["ktü öğrenci bütçesi","trabzon öğrenci yaşamı","trabzon yurt","ktü kampüs"],"audience":"KTÜ öğrencileri ve aileleri","notes":"Kalem kalem aylık bütçe tablosu kur ama rakamları 'yaklaşık' ver. Yurt, özel yurt, paylaşımlı ev ve yemek seçeneklerini karşılaştır.","image_url":"https://upload.wikimedia.org/wikipedia/commons/thumb/6/64/Karadeniz_Teknik_%C3%9Cniversitesi_01_%D0%A2%D0%B5%D1%85%D0%BD%D0%B8%D1%87%D0%BA%D0%B8_%D1%83%D0%BD%D0%B8%D0%B2%D0%B5%D1%80%D0%B7%D0%B8%D1%82%D0%B5%D1%82_%D0%BD%D0%B0_%D0%A6%D1%80%D0%BD%D0%BE%D0%BC_%D0%BC%D0%BE%D1%80%D1%83.jpg/1280px-Karadeniz_Teknik_%C3%9Cniversitesi_01_%D0%A2%D0%B5%D1%85%D0%BD%D0%B8%D1%87%D0%BA%D0%B8_%D1%83%D0%BD%D0%B8%D0%B2%D0%B5%D1%80%D0%B7%D0%B8%D1%82%D0%B5%D1%82_%D0%BD%D0%B0_%D0%A6%D1%80%D0%BD%D0%BE%D0%BC_%D0%BC%D0%BE%D1%80%D1%83.jpg","image_alt":"KTÜ kampüsü","sort_order":180},
  {"topic":"Trabzon'dan yurt dışına gitmek: havalimanı, aktarmalı uçuş ve vize pratikleri","category":"Ulaşım","keywords":["trabzon havalimanı","trabzon yurt dışı uçuş","trabzon aktarma","trabzon vize"],"audience":"Trabzon'dan yurt dışına seyahat edecekler","notes":"Trabzon Havalimanı'ndan doğrudan uçuş ağının sınırlı olduğunu, İstanbul aktarmasının yaygınlığını anlat. Havayolu adı ve saat uydurma.","image_url":"https://upload.wikimedia.org/wikipedia/commons/thumb/0/03/Trabzon_cityscape.jpg/1280px-Trabzon_cityscape.jpg","image_alt":"Trabzon şehir görünümü","sort_order":190},
  {"topic":"Trabzon'da ikinci el araba piyasası: galeri, ekspertiz ve pazarlıkta dikkat edilecekler","category":"Alışveriş","keywords":["trabzon ikinci el araba","trabzon galeri","araç ekspertiz","trabzon araba fiyatları"],"audience":"Trabzon'da araç alacaklar","notes":"Fiyat uydurma. Ekspertiz, tramer, km kontrolü, kış koşullarının araç yıpranmasına etkisi ve ödeme güvenliği başlıklarını işle.","image_url":"https://upload.wikimedia.org/wikipedia/commons/thumb/0/03/Trabzon_cityscape.jpg/1280px-Trabzon_cityscape.jpg","image_alt":"Trabzon şehir merkezi ve sahil yolu","sort_order":200},
  {"topic":"Trabzon'da denize girmek: plajlar, dalga, sezon ve güvenlik kuralları","category":"Gezi ve Keşif","keywords":["trabzon plaj","trabzon deniz","akçakale plajı","trabzon'da denize girilir mi"],"audience":"Yaz aylarında Trabzon'da denize girecekler","notes":"Karadeniz'in dalga ve akıntı gerçeğini vurgula; cankurtaran ve bayrak işaretleri. Plaj adlarını doğru kullan, tesis garantisi verme.","image_url":"https://upload.wikimedia.org/wikipedia/commons/thumb/e/ed/Trabzon_Ak%C3%A7aabat.jpg/1280px-Trabzon_Ak%C3%A7aabat.jpg","image_alt":"Akçaabat sahil hattı","sort_order":210},
  {"topic":"Trabzon yayla yolları: araç seçimi, yol durumu, navigasyon ve kış riskleri","category":"Doğa ve Yayla","keywords":["trabzon yayla yolu","trabzon yaylaya nasıl gidilir","yayla araç","trabzon dağ yolu"],"audience":"Kendi aracıyla yaylaya çıkacaklar","notes":"Yol genişliği, viraj, sis, telefon çekimi ve yakıt planı gibi somut konular. Yol kapalılığı için resmi duyuru kontrolü öner.","image_url":"https://upload.wikimedia.org/wikipedia/commons/thumb/d/d1/Trabzon_Kazang%C4%B1ran_Yaylas%C4%B1_Yolu.jpg/1280px-Trabzon_Kazang%C4%B1ran_Yaylas%C4%B1_Yolu.jpg","image_alt":"Trabzon'da yayla yolundan vadinin görünümü","sort_order":220},
  {"topic":"Sümela Manastırı ve Altındere: ziyaret planı, ulaşım ve bilinmeyen ayrıntılar","category":"Gezi ve Keşif","keywords":["sümela manastırı","altındere vadisi","sümela ziyaret","maçka trabzon"],"audience":"Trabzon'a gelen yerli ve yabancı gezginler","notes":"Manastırın Maçka'ya bağlı Altındere köyünde olduğunu doğru yaz. Giriş ücreti ve açılış saati uydurma; resmi site kontrolü öner. Fotoğraf kurallarına değin.","image_url":"https://upload.wikimedia.org/wikipedia/commons/thumb/4/49/Village_near_%C3%87aykara%2C_Trabzon.jpg/1280px-Village_near_%C3%87aykara%2C_Trabzon.jpg","image_alt":"Trabzon kırsalında ormanlık vadi","sort_order":230},
  {"topic":"Trabzon'da tarih rotası: Ayasofya, surlar ve eski şehir sokaklarında bir gün","category":"Tarih ve Kültür","keywords":["trabzon ayasofya","trabzon kalesi","trabzon tarihi yerler","trabzon eski şehir"],"audience":"Trabzon'un tarihini merak eden gezginler","notes":"Trabzon Ayasofya'sının Fatih'teki Ayasofya'dan farklı olduğunu netleştir. Yürüyüş rotası, süre ve fotoğraf noktaları ekle.","image_url":"https://upload.wikimedia.org/wikipedia/commons/thumb/7/7c/Trebisonda%2C_veduta_verso_la_Trabzon_%C5%9Eehir_Camii_da_yenicuma.jpg/1280px-Trebisonda%2C_veduta_verso_la_Trabzon_%C5%9Eehir_Camii_da_yenicuma.jpg","image_alt":"Trabzon'un tarihi şehir dokusuna bakan bir görünüm","sort_order":240},
  {"topic":"Trabzon müzeleri: Trabzon Müzesi, Atatürk Köşkü ve küçük koleksiyonlar rehberi","category":"Tarih ve Kültür","keywords":["trabzon müzesi","atatürk köşkü trabzon","trabzon müze giriş","trabzon kültür"],"audience":"Müzeleri seven gezginler ve aileler","notes":"Giriş ücreti ve saat uydurma; MüzeKart ve resmi duyuru önerisi ekle. Her müze için 'neden görülmeli' ve 'ne kadar süre' bilgisi ver.","image_url":"https://upload.wikimedia.org/wikipedia/commons/thumb/6/6f/Atat%C3%BCrk_K%C3%B6%C5%9Fk%C3%BC_Trabzon.jpg/1280px-Atat%C3%BCrk_K%C3%B6%C5%9Fk%C3%BC_Trabzon.jpg","image_alt":"Trabzon Atatürk Köşkü","sort_order":250},
  {"topic":"Trabzon'da çocukla kış günü: kapalı mekânlar, atölyeler ve evde oyun fikirleri","category":"Aile","keywords":["trabzon çocuk aktivite","trabzon kış çocuk","trabzon aile","trabzon kapalı mekan"],"audience":"Küçük çocuklu Trabzonlu aileler","notes":"Mekân adı uydurma; belediye kültür merkezleri, kütüphane ve AVM gibi genel kategoriler üzerinden anlat. Bütçesiz seçenekler ekle.","image_url":"https://upload.wikimedia.org/wikipedia/commons/thumb/9/9c/Trabzon_Meydan_Park_%281%29.jpg/1280px-Trabzon_Meydan_Park_%281%29.jpg","image_alt":"Trabzon Meydan Parkı","sort_order":260},
  {"topic":"Trabzon'da evcil hayvanla yaşam: veteriner, gezi alanı ve kiralık ev gerçeği","category":"Yaşam","keywords":["trabzon veteriner","trabzon evcil hayvan","trabzon park köpek","trabzon kedi"],"audience":"Kedi veya köpeğiyle Trabzon'da yaşayanlar","notes":"Klinik adı uydurma. Kiralık ev bulmada yaşanan zorlukları, site kurallarını ve sahil yürüyüş pratiklerini anlat.","image_url":"https://upload.wikimedia.org/wikipedia/commons/thumb/9/9c/Trabzon_Meydan_Park_%281%29.jpg/1280px-Trabzon_Meydan_Park_%281%29.jpg","image_alt":"Trabzon Meydan Parkı'nda yürüyüş alanı","sort_order":270},
  {"topic":"Trabzon'da engelli erişimi: ulaşım, kaldırım, kamu binaları ve pratik çözümler","category":"Şehir","keywords":["trabzon engelli erişimi","trabzon tekerlekli sandalye","trabzon erişilebilirlik"],"audience":"Engelli bireyler ve bakım veren aileler","notes":"Yamaçlı şehir yapısının erişime etkisini somut anlat. Kurum adı uydurma; belediye ve ALO 153 gibi genel kanalları öner.","image_url":"https://upload.wikimedia.org/wikipedia/commons/thumb/0/01/Trabzon_Meydan.jpg/1280px-Trabzon_Meydan.jpg","image_alt":"Trabzon Meydan ve çevresi","sort_order":280},
  {"topic":"Trabzon'da abonelik rehberi: elektrik, su, doğalgaz ve internet açtırma adımları","category":"Yaşam","keywords":["trabzon elektrik abonelik","trabzon su abonelik","trabzon doğalgaz","trabzon internet başvuru"],"audience":"Trabzon'da ilk kez ev tutanlar","notes":"Adım adım kontrol listesi ver. Depozito ve tarife tutarı uydurma; güncel bilgi için dağıtım şirketi kanalını işaret et.","image_url":"https://upload.wikimedia.org/wikipedia/commons/thumb/0/0f/Trabzon_City_Centre.jpg/1280px-Trabzon_City_Centre.jpg","image_alt":"Trabzon şehir merkezinde apartman ve dükkânlar","sort_order":290},
  {"topic":"Trabzon'da internet ve fiber: hangi mahallede ne beklenir, uzaktan çalışan ne yapmalı?","category":"Şehir","keywords":["trabzon fiber","trabzon internet altyapısı","trabzon uzaktan çalışma internet"],"audience":"Uzaktan çalışanlar ve online eğitim alanlar","notes":"Altyapı sorgulama adımları, yedek bağlantı ve kesinti planı. Sağlayıcı hız garantisi verme.","image_url":"https://upload.wikimedia.org/wikipedia/commons/thumb/0/03/Trabzon_cityscape.jpg/1280px-Trabzon_cityscape.jpg","image_alt":"Trabzon şehir görünümü","sort_order":300},
  {"topic":"Trabzon'da kargo ve online alışveriş: teslimat, iade ve köy adreslemesi sorunları","category":"Alışveriş","keywords":["trabzon kargo","trabzon online alışveriş","trabzon iade","köy adres kargo"],"audience":"Trabzon merkez ve ilçelerde online alışveriş yapanlar","notes":"Kargo firması adı uydurma. Adres tarifi, teslim noktası, iade süresi ve hasarlı ürün için fotoğraf kanıtı gibi pratikleri anlat.","image_url":"https://upload.wikimedia.org/wikipedia/commons/thumb/0/03/Trabzon_cityscape.jpg/1280px-Trabzon_cityscape.jpg","image_alt":"Trabzon şehir merkezi","sort_order":310},
  {"topic":"Trabzon'da ilçe ilçe lezzet haritası: Akçaabat'tan Of'a ne yenir?","category":"Yemek ve Lezzet","keywords":["trabzon lezzet","akçaabat köfte","trabzon yöresel yemek","of yemekleri"],"audience":"Trabzon'u yemek üzerinden keşfetmek isteyenler","notes":"Yöresel yemek adlarını doğru yaz (Akçaabat köftesi, kuymak, mıhlama, hamsili pilav). İşletme adı uydurma, ilçe bazlı tablo kur.","image_url":"https://upload.wikimedia.org/wikipedia/commons/thumb/e/ed/Trabzon_Ak%C3%A7aabat.jpg/1280px-Trabzon_Ak%C3%A7aabat.jpg","image_alt":"Akçaabat'ta sahil ve yerleşim","sort_order":320},
  {"topic":"Trabzon'da akşam hayatı: canlı müzik, sahne ve geç saatte güvenli dönüş","category":"Etkinlik","keywords":["trabzon gece hayatı","trabzon canlı müzik","trabzon bar","trabzon akşam"],"audience":"Trabzon'da akşam dışarı çıkmak isteyen yetişkinler","notes":"Mekân adı uydurma; bölge ve konsept tarif et. Taksi, toplu taşıma son saat ve güvenlik pratikleri ekle.","image_url":"https://upload.wikimedia.org/wikipedia/commons/thumb/9/9c/Trabzon_Meydan_Park_%281%29.jpg/1280px-Trabzon_Meydan_Park_%281%29.jpg","image_alt":"Trabzon Meydan Parkı akşam saatlerinde","sort_order":330},
  {"topic":"Trabzon'da sinema, tiyatro ve kültür sanat: sezon takvimi nasıl takip edilir?","category":"Etkinlik","keywords":["trabzon tiyatro","trabzon sinema","trabzon kültür sanat","trabzon etkinlik takvimi"],"audience":"Kültür sanat etkinliklerini takip edenler","notes":"Kurum ve salon adı uydurma; belediye, üniversite ve özel salon kategorileri üzerinden anlat. Bilet ve sezon bilgisi için resmi kanal öner.","image_url":"https://upload.wikimedia.org/wikipedia/commons/thumb/0/0f/Trabzon_City_Centre.jpg/1280px-Trabzon_City_Centre.jpg","image_alt":"Trabzon şehir merkezi","sort_order":340},
  {"topic":"Trabzonspor maç günü rehberi: bilet, ulaşım, stadyum çevresi ve şehir ritmi","category":"Spor ve Outdoor","keywords":["trabzonspor maç günü","şenol güneş stadyumu","trabzonspor bilet","trabzon stadyum ulaşım"],"audience":"Trabzonspor maçına gidecek taraftarlar","notes":"Stadyumun adını doğru kullan. Bilet fiyatı uydurma; resmi bilet kanalını işaret et. Maç öncesi/sonrası ulaşım ve kalabalık yönetimi pratikleri ver.","image_url":"https://upload.wikimedia.org/wikipedia/commons/thumb/0/03/Trabzon_cityscape.jpg/1280px-Trabzon_cityscape.jpg","image_alt":"Trabzon şehir görünümü","sort_order":350},
  {"topic":"Trabzon çevresinde kamp alanları: çadır, karavan ve doğa izni pratikleri","category":"Doğa ve Yayla","keywords":["trabzon kamp","trabzon karavan","trabzon doğa kampı","yayla kampı"],"audience":"Doğada kamp yapmak isteyenler","notes":"Kamp alanı adı uydurma; Uzungöl, Maçka ve yayla çevresi gibi bölgeleri tarif et. Hava, izin, ateş ve çöp kurallarına değin.","image_url":"https://upload.wikimedia.org/wikipedia/commons/thumb/7/7e/Uzung%C3%B6l_lake_and_town.jpg/1280px-Uzung%C3%B6l_lake_and_town.jpg","image_alt":"Uzungöl ve çevresindeki ormanlık alan","sort_order":360},
  {"topic":"Trabzon'da arsa ve tarla yatırımı: imar, yola cephe ve köy arazisi gerçekleri","category":"Emlak","keywords":["trabzon arsa","trabzon tarla","trabzon imar","köy arazisi almak"],"audience":"Trabzon'da arsa veya tarla almayı düşünen yatırımcılar","notes":"İmar durumu, kadastro, yola cephe, hisseli tapu ve su hakkı gibi somut kontrol listesi ver. Getiri garantisi verme.","image_url":"https://upload.wikimedia.org/wikipedia/commons/thumb/c/ce/Tonya_town_Trabzon_Turkey.jpg/1280px-Tonya_town_Trabzon_Turkey.jpg","image_alt":"Tonya çevresinde kırsal arazi ve yerleşim","sort_order":370},
  {"topic":"Trabzon'da tersane ve gemi inşa sanayi: iş kolları, sertifikalar ve kariyer yolu","category":"Kariyer ve Girişim","keywords":["trabzon tersane","gemi inşa iş","trabzon sanayi iş","kaynakçı iş trabzon"],"audience":"Teknik meslek sahipleri ve sanayi kariyeri düşünenler","notes":"Tersane bölgesini doğru tarif et. Sertifika (kaynak, iş güvenliği) ve vardiya düzenine odaklan; firma adı uydurma.","image_url":"https://upload.wikimedia.org/wikipedia/commons/thumb/2/2a/Trabzon_Hafen.JPG/1280px-Trabzon_Hafen.JPG","image_alt":"Trabzon Limanı'nda yük ve gemi trafiği","sort_order":380},
  {"topic":"Trabzon limanı ve lojistik: ihracat, depo ve gümrük süreçlerinde iş fırsatları","category":"Kariyer ve Girişim","keywords":["trabzon limanı iş","trabzon lojistik","trabzon gümrük","trabzon ihracat"],"audience":"Lojistik, dış ticaret ve operasyon alanında çalışanlar","notes":"Limanın bölge ekonomisindeki yerini anlat. Gümrük ve evrak süreçlerini genel hatlarıyla ver; mevzuat detayı için resmi kaynak öner.","image_url":"https://upload.wikimedia.org/wikipedia/commons/thumb/2/2a/Trabzon_Hafen.JPG/1280px-Trabzon_Hafen.JPG","image_alt":"Trabzon Limanı'nda konteyner ve yük elleçleme","sort_order":390},
  {"topic":"Trabzon'da turizm sezonu ve otel işleri: sezonluk çalışmanın artıları ve riskleri","category":"Kariyer ve Girişim","keywords":["trabzon otel iş","trabzon turizm sezonu","trabzon sezonluk iş","turizmde çalışmak"],"audience":"Turizmde çalışmak isteyen gençler ve sezonluk iş arayanlar","notes":"Sezon yoğunluğu, dil, vardiya ve konaklama desteği gibi konular. Otel adı uydurma, ücret garantisi verme.","image_url":"https://upload.wikimedia.org/wikipedia/commons/thumb/9/9f/Uzung%C3%B6l_14.jpg/1280px-Uzung%C3%B6l_14.jpg","image_alt":"Uzungöl çevresinde turizm işletmeleri ve göl","sort_order":400},
  {"topic":"Trabzon'da tek başına yaşam: kira, güvenlik, sosyalleşme ve günlük rutin","category":"Yaşam","keywords":["trabzon tek yaşam","trabzon bekar ev","trabzon güvenlik","trabzon yalnız yaşam"],"audience":"Tek başına yaşayan genç çalışanlar","notes":"1+1 daire seçenekleri, semt güvenliği, markete yürüme ve akşam dönüşü gibi pratikler. Kira için yaklaşık aralık kullan.","image_url":"https://upload.wikimedia.org/wikipedia/commons/thumb/9/9c/Trabzon_Meydan_Park_%281%29.jpg/1280px-Trabzon_Meydan_Park_%281%29.jpg","image_alt":"Trabzon Meydan Parkı çevresinde günlük hayat","sort_order":410},
  {"topic":"Trabzon'da yeni evli çiftler için ilk ev: kiralık mı satın alma mı?","category":"Yaşam","keywords":["trabzon ilk ev","trabzon yeni evli","trabzon kiralık mı satın alma","trabzon ev bütçesi"],"audience":"Trabzon'da yeni ev kuracak çiftler","notes":"Peşinat, kredi, depozito ve eşya bütçesi tablosu kur; rakamları yaklaşık ver. Semt önerilerini ulaşım ve işe yakınlık üzerinden gerekçelendir.","image_url":"https://upload.wikimedia.org/wikipedia/commons/thumb/e/ed/Trabzon_Ak%C3%A7aabat.jpg/1280px-Trabzon_Ak%C3%A7aabat.jpg","image_alt":"Akçaabat'ta konut ve sahil","sort_order":420},
  {"topic":"Trabzon'da arıcılık ve bal: yayla balı, hasat ve satışta güven meselesi","category":"Kariyer ve Girişim","keywords":["trabzon bal","yayla balı","trabzon arıcılık","karadeniz balı"],"audience":"Arıcılığa başlamayı düşünenler ve yerel ürün alıcıları","notes":"Bal çeşitlerini ve yayla çiçek örtüsünü anlat. Sahte bal tartışmasında dengeli ol; analiz ve izlenebilirlik öner. Fiyat uydurma.","image_url":"https://upload.wikimedia.org/wikipedia/commons/thumb/9/9c/Ke%C3%A7iler_Trabzon_Yaylas%C4%B1.jpg/1280px-Ke%C3%A7iler_Trabzon_Yaylas%C4%B1.jpg","image_alt":"Trabzon yaylalarında otlak ve doğal bitki örtüsü","sort_order":430},
  {"topic":"Trabzon'da koşu ve bisiklet: sahil hattı, eğim ve mevsim planı","category":"Spor ve Outdoor","keywords":["trabzon koşu","trabzon bisiklet","trabzon sahil yürüyüş","trabzon spor rotası"],"audience":"Düzenli spor yapmak isteyen Trabzonlular","notes":"Sahil hattının düzlüğü ile iç kesimlerin eğimini karşılaştır. Rota tarifini semt adlarıyla ver; mesafe uydurma.","image_url":"https://upload.wikimedia.org/wikipedia/commons/thumb/9/9c/Trabzon_Meydan_Park_%281%29.jpg/1280px-Trabzon_Meydan_Park_%281%29.jpg","image_alt":"Trabzon sahil ve park hattı","sort_order":440},
  {"topic":"Trabzon'da iş görüşmesi: yerel işverenin beklediği cevaplar ve maaş pazarlığı","category":"Kariyer ve Girişim","keywords":["trabzon iş görüşmesi","trabzon maaş pazarlığı","trabzon mülakat","trabzon kariyer"],"audience":"Trabzon'da iş görüşmesine hazırlananlar","notes":"Somut örnek cevap iskeletleri ver. Maaş pazarlığında aralık söyleme, yan hak ve ulaşım desteği gibi yerel gerçeklere değin.","image_url":"https://upload.wikimedia.org/wikipedia/commons/thumb/0/0f/Trabzon_City_Centre.jpg/1280px-Trabzon_City_Centre.jpg","image_alt":"Trabzon şehir merkezinde iş ve ticaret bölgesi","sort_order":450}
]$topics$::jsonb) as x(
  topic text, category text, keywords text[], audience text, notes text,
  image_url text, image_alt text, sort_order integer
)
on conflict (topic) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Cron anahtarı
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'blog_ai_cron_secret') then
    perform vault.create_secret(
      encode(gen_random_bytes(32), 'hex'),
      'blog_ai_cron_secret',
      'Günlük blog yazımı cron çağrı anahtarı'
    );
  end if;
end $$;

create or replace function public.blog_ai_token_ok(p_token text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_expected text;
begin
  select decrypted_secret into v_expected
  from vault.decrypted_secrets
  where name = 'blog_ai_cron_secret';

  if v_expected is null or coalesce(p_token, '') = '' then
    return false;
  end if;

  return encode(digest(p_token, 'sha256'), 'hex') = encode(digest(v_expected, 'sha256'), 'hex');
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Konu sahiplenme / bitirme
-- ---------------------------------------------------------------------------
create or replace function public.blog_ai_claim_topics(p_count integer default 1)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := least(greatest(coalesce(p_count, 1), 1), 4);
  v_rows jsonb;
begin
  with picked as (
    select id
    from public.blog_ai_topics
    where status = 'pending' and attempts < 5
    order by sort_order, id
    limit v_count
    for update skip locked
  ),
  claimed as (
    update public.blog_ai_topics t
       set status = 'running',
           claimed_at = now(),
           attempts = t.attempts + 1
      from picked
     where t.id = picked.id
    returning t.*
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', c.id,
        'topic', c.topic,
        'category', c.category,
        'keywords', c.keywords,
        'audience', c.audience,
        'notes', c.notes,
        'image_url', c.image_url,
        'image_alt', c.image_alt
      ) order by c.sort_order, c.id
    ),
    '[]'::jsonb
  )
  into v_rows
  from claimed c;

  return v_rows;
end;
$$;

create or replace function public.blog_ai_finish_topic(
  p_id bigint,
  p_ok boolean,
  p_post_id uuid default null,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(p_ok, false) then
    update public.blog_ai_topics
       set status = 'used',
           used_at = now(),
           used_post_id = p_post_id,
           last_error = null
     where id = p_id;

    update public.blog_ai_settings
       set last_post_at = now(),
           updated_at = now()
     where id;
  else
    update public.blog_ai_topics
       set status = case when attempts >= 5 then 'failed' else 'pending' end,
           last_error = left(coalesce(p_error, ''), 1000),
           claimed_at = null
     where id = p_id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Zamanlayıcı
-- ---------------------------------------------------------------------------
create or replace function public.blog_ai_tick()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_settings public.blog_ai_settings%rowtype;
  v_token text;
  v_today integer := 0;
  v_hour integer := 0;
  v_pending integer := 0;
  v_response bigint;
begin
  select * into v_settings from public.blog_ai_settings where id;

  if v_settings.id is null then
    return jsonb_build_object('queued', false, 'reason', 'settings_missing');
  end if;

  if v_settings.enabled is not true then
    return jsonb_build_object('queued', false, 'reason', 'disabled');
  end if;

  -- 30 dakikadan uzun süre "running" kalan konuları serbest bırak.
  update public.blog_ai_topics
     set status = 'pending', claimed_at = null
   where status = 'running'
     and claimed_at < now() - interval '30 minutes';

  v_hour := extract(hour from (now() at time zone v_settings.timezone))::integer;
  if v_hour < 7 or v_hour >= 22 then
    return jsonb_build_object('queued', false, 'reason', 'outside_window');
  end if;

  if v_settings.last_post_at is not null
     and v_settings.last_post_at > now() - make_interval(mins => v_settings.min_gap_minutes) then
    return jsonb_build_object('queued', false, 'reason', 'gap',
                              'last_post_at', v_settings.last_post_at);
  end if;

  select count(*) into v_today
  from public.blog_posts p
  where p.status = 'published'
    and p.ai_generated is true
    and p.author_name = v_settings.author_name
    and p.published_at is not null
    and (p.published_at at time zone v_settings.timezone)::date
        = (now() at time zone v_settings.timezone)::date;

  if v_today >= v_settings.posts_per_day then
    return jsonb_build_object('queued', false, 'reason', 'daily_quota',
                              'today', v_today, 'target', v_settings.posts_per_day);
  end if;

  select count(*) into v_pending
  from public.blog_ai_topics
  where status = 'pending' and attempts < 5;

  if v_pending = 0 then
    return jsonb_build_object('queued', false, 'reason', 'no_topics');
  end if;

  select decrypted_secret into v_token
  from vault.decrypted_secrets
  where name = 'blog_ai_cron_secret';

  if v_token is null then
    return jsonb_build_object('queued', false, 'reason', 'secret_missing');
  end if;

  update public.blog_ai_settings
     set last_tick_at = now()
   where id;

  select net.http_post(
    url := rtrim(v_settings.worker_url, '/') || '/functions/v1/blog-autowrite',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-blog-token', v_token
    ),
    body := jsonb_build_object('count', 1, 'trigger', 'cron'),
    timeout_milliseconds := 150000
  ) into v_response;

  return jsonb_build_object(
    'queued', true,
    'request_id', v_response,
    'today', v_today,
    'target', v_settings.posts_per_day
  );
end;
$$;

create or replace function public.blog_ai_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_settings public.blog_ai_settings%rowtype;
  v_today integer := 0;
  v_pending integer := 0;
  v_used integer := 0;
  v_failed integer := 0;
  v_last jsonb;
begin
  select * into v_settings from public.blog_ai_settings where id;

  select count(*) into v_today
  from public.blog_posts p
  where p.status = 'published'
    and p.ai_generated is true
    and p.author_name = v_settings.author_name
    and p.published_at is not null
    and (p.published_at at time zone v_settings.timezone)::date
        = (now() at time zone v_settings.timezone)::date;

  select
    count(*) filter (where status = 'pending'),
    count(*) filter (where status = 'used'),
    count(*) filter (where status = 'failed')
  into v_pending, v_used, v_failed
  from public.blog_ai_topics;

  select to_jsonb(p) into v_last
  from (
    select id, slug, title, published_at
    from public.blog_posts
    where author_name = v_settings.author_name and ai_generated is true
    order by published_at desc nulls last
    limit 1
  ) p;

  return jsonb_build_object(
    'enabled', v_settings.enabled,
    'posts_per_day', v_settings.posts_per_day,
    'today', v_today,
    'topics_pending', v_pending,
    'topics_used', v_used,
    'topics_failed', v_failed,
    'last_post_at', v_settings.last_post_at,
    'last_tick_at', v_settings.last_tick_at,
    'last_post', v_last
  );
end;
$$;

revoke all on function public.blog_ai_claim_topics(integer) from public;
revoke all on function public.blog_ai_claim_topics(integer) from anon, authenticated;
revoke all on function public.blog_ai_finish_topic(bigint, boolean, uuid, text) from public;
revoke all on function public.blog_ai_finish_topic(bigint, boolean, uuid, text) from anon, authenticated;
revoke all on function public.blog_ai_tick() from public;
revoke all on function public.blog_ai_tick() from anon, authenticated;
revoke all on function public.blog_ai_status() from public;
revoke all on function public.blog_ai_token_ok(text) from public;

grant execute on function public.blog_ai_claim_topics(integer) to service_role;
grant execute on function public.blog_ai_finish_topic(bigint, boolean, uuid, text) to service_role;
grant execute on function public.blog_ai_tick() to service_role;
grant execute on function public.blog_ai_status() to service_role, authenticated;
grant execute on function public.blog_ai_token_ok(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Cron: 15 dakikada bir kontrol; asıl yazım edge function'da
-- ---------------------------------------------------------------------------
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'blog-ai-tick';
exception
  when others then null;
end $$;

select cron.schedule(
  'blog-ai-tick',
  '*/15 * * * *',
  $cron$select public.blog_ai_tick();$cron$
);

commit;
