-- 0110 — AI haberlerinde görünür yapay zekâ izlerini kaldır, ilçe fotoğraflarını kullan.
--
--  * Gövde metnindeki "AI destekli haber", "Trabzone AI Haber Merkezi" ve
--    kategori görseli açıklamaları temizlenir.
--  * Yayındaki haberlerin görseli o ilçenin gerçek fotoğrafıyla değiştirilir.
--  * Yayıncı profili ve kamuya açık haber JSON'u yapay zekâ bilgisi döndürmez.
--  * Yeni yayınlarda görsel altına fotoğraf atfı eklenir.

begin;

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. İlçe adı -> görsel anahtarı
-- ---------------------------------------------------------------------------
create or replace function public.ai_news_district_slug(p_district text)
returns text
language sql
immutable
set search_path = public
as $$
  select case lower(translate(trim(coalesce(p_district, '')), 'çğıöşüÇĞİÖŞÜ', 'cgiosuCGIOSU'))
    when 'akcaabat' then 'akcaabat'
    when 'arakli' then 'arakli'
    when 'arsin' then 'arsin'
    when 'besikduzu' then 'besikduzu'
    when 'carsibasi' then 'carsibasi'
    when 'caykara' then 'caykara'
    when 'dernekpazari' then 'dernekpazari'
    when 'duzkoy' then 'duzkoy'
    when 'hayrat' then 'hayrat'
    when 'koprubasi' then 'koprubasi'
    when 'macka' then 'macka'
    when 'of' then 'of'
    when 'ortahisar' then 'ortahisar'
    when 'surmene' then 'surmene'
    when 'salpazari' then 'salpazari'
    when 'tonya' then 'tonya'
    when 'vakfikebir' then 'vakfikebir'
    when 'yomra' then 'yomra'
    else 'ortahisar'
  end;
$$;

revoke all on function public.ai_news_district_slug(text) from public, anon, authenticated;
grant execute on function public.ai_news_district_slug(text) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Gövde biçimi: yapay zekâ etiketi ve kategori görseli açıklaması yok.
-- ---------------------------------------------------------------------------
drop function if exists public.ai_news_compose_body(text, text, text, text, text, text, boolean);

create or replace function public.ai_news_compose_body(
  p_title text,
  p_spot text,
  p_body text,
  p_district text,
  p_category_name text,
  p_sources text,
  p_placeholder boolean,
  p_media_credit text default null
)
returns text
language sql
immutable
set search_path = public
as $$
  select left(
    p_title || E'\n\n' || p_spot || E'\n\n' || p_body
    || E'\n\nKonum: ' || coalesce(nullif(p_district, ''), 'Trabzon') || ', Trabzon'
    || E'\nKategori: ' || coalesce(nullif(p_category_name, ''), 'Trabzon Gündem')
    || case
         when nullif(btrim(coalesce(p_media_credit, '')), '') is not null
           then E'\nFotoğraf: ' || btrim(p_media_credit)
         else ''
       end
    || case when coalesce(p_sources, '') <> ''
         then E'\nKaynaklar: ' || p_sources else '' end,
    2000
  );
$$;

revoke all on function public.ai_news_compose_body(text, text, text, text, text, text, boolean, text)
  from public, anon, authenticated;
grant execute on function public.ai_news_compose_body(text, text, text, text, text, text, boolean, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 3. Yayındaki haberler: metni temizle, ilçe fotoğrafına geçir.
-- ---------------------------------------------------------------------------
with mapping(district, slug, credit, license_code, source_url) as (
  values
    ('Akçaabat', 'akcaabat', 'Muhammed6169 · CC BY-SA 4.0 · Wikimedia Commons', 'cc_by_sa_4', 'https://commons.wikimedia.org/wiki/File:Ortamahalle.jpg'),
    ('Araklı', 'arakli', 'Amjad Turky · CC BY-SA 4.0 · Wikimedia Commons', 'cc_by_sa_4', 'https://commons.wikimedia.org/wiki/File:Arakl%C4%B1_-_Trabzon_(Denize_bakan_tabiat_manzaras%C4%B1).jpg'),
    ('Arsin', 'arsin', 'Tarih · CC BY-SA 4.0 · Wikimedia Commons', 'cc_by_sa_4', 'https://commons.wikimedia.org/wiki/File:Ye%C5%9Filyal%C4%B1_Arsin.jpg'),
    ('Beşikdüzü', 'besikduzu', 'Serhat Baştan · CC BY-SA 4.0 · Wikimedia Commons', 'cc_by_sa_4', 'https://commons.wikimedia.org/wiki/File:Vakf%C4%B1kebir_Be%C5%9Fikd%C3%BCz%C3%BC.jpg'),
    ('Çarşıbaşı', 'carsibasi', 'Sinan Şahin · CC BY 3.0 · Wikimedia Commons', 'cc_by_3', 'https://commons.wikimedia.org/wiki/File:Trabzon_Sahil..._-_panoramio.jpg'),
    ('Çaykara', 'caykara', 'Ozbakanelwan · CC BY-SA 4.0 · Wikimedia Commons', 'cc_by_sa_4', 'https://commons.wikimedia.org/wiki/File:Uzung%C3%B6l,_Trabzon.jpg'),
    ('Dernekpazarı', 'dernekpazari', 'Muhammet Dilmaç · CC BY-SA 4.0 · Wikimedia Commons', 'cc_by_sa_4', 'https://commons.wikimedia.org/wiki/File:Trabzon_Kazank%C4%B1ran_Yaylas%C4%B1.jpg'),
    ('Düzköy', 'duzkoy', 'Francesco Bini · CC BY-SA 4.0 · Wikimedia Commons', 'cc_by_sa_4', 'https://commons.wikimedia.org/wiki/File:D%C3%BCzkoy,_villaggio_B%C3%BCy%C3%BCk,_campi_coltivati_con_covoni_di_granoturco.jpg'),
    ('Hayrat', 'hayrat', 'DesertEagle · Public domain · Wikimedia Commons', 'cc0', 'https://commons.wikimedia.org/wiki/File:A_view_from_Yarl%C4%B1,_Hayrat.JPG'),
    ('Köprübaşı', 'koprubasi', 'Murat Sancak · CC BY 3.0 · Wikimedia Commons', 'cc_by_3', 'https://commons.wikimedia.org/wiki/File:(25.08.2012)_-_(TRABZON_-_K%C3%96PR%C3%9CBA%C5%9EI_-_K%C3%B6%C5%9Fk_Yaylas%C4%B1)_-_panoramio.jpg'),
    ('Maçka', 'macka', 'Ben Bender · CC BY-SA 3.0 · Wikimedia Commons', 'cc_by_sa_3', 'https://commons.wikimedia.org/wiki/File:61750_Hamsik%C3%B6y-Ma%C3%A7ka-Trabzon,_Turkey_-_panoramio_(1).jpg'),
    ('Of', 'of', 'Selehattin Sezeroglu · CC BY 3.0 · Wikimedia Commons', 'cc_by_3', 'https://commons.wikimedia.org/wiki/File:61830_Dar%C4%B1l%C4%B1-Of-Trabzon,_Turkey_-_panoramio.jpg'),
    ('Ortahisar', 'ortahisar', 'Dosseman · CC BY-SA 4.0 · Wikimedia Commons', 'cc_by_sa_4', 'https://commons.wikimedia.org/wiki/File:Trabzon_view_from_K%C4%B1zlar_Manast%C4%B1r%C4%B1_4839.jpg'),
    ('Sürmene', 'surmene', 'Muhammet Dilmaç · CC BY-SA 4.0 · Wikimedia Commons', 'cc_by_sa_4', 'https://commons.wikimedia.org/wiki/File:Trabzon_Kazang%C4%B1ran_Yaylas%C4%B1_Yolu.jpg'),
    ('Şalpazarı', 'salpazari', 'Zeynel Cebeci · CC BY-SA 4.0 · Wikimedia Commons', 'cc_by_sa_4', 'https://commons.wikimedia.org/wiki/File:Geyikli,_%C5%9Ealpazar%C4%B1_01.jpg'),
    ('Tonya', 'tonya', 'Serhat Baştan · CC BY-SA 4.0 · Wikimedia Commons', 'cc_by_sa_4', 'https://commons.wikimedia.org/wiki/File:Tonya_(Kad%C4%B1ralak_Yaylas%C4%B1ndan_G%C3%B6r%C3%BCn%C3%BCm)-3.jpg'),
    ('Vakfıkebir', 'vakfikebir', 'zekeriya karkaç · CC BY 3.0 · Wikimedia Commons', 'cc_by_3', 'https://commons.wikimedia.org/wiki/File:Trabzon_Vakf%C4%B1kebir_ishakl%C4%B1_K%C3%B6y%C3%BCnden_Vakf%C4%B1kebire_Bak%C4%B1%C5%9F_-_panoramio.jpg'),
    ('Yomra', 'yomra', 'Sezer357 · CC BY 4.0 · Wikimedia Commons', 'cc_by_4', 'https://commons.wikimedia.org/wiki/File:%C3%96zdil,Yomra.jpg')
),
targets as (
  select
    pub.post_id,
    pub.event_id,
    m.slug,
    m.credit,
    m.license_code,
    m.source_url,
    public.ai_news_district_slug(coalesce(d.district, e.district)) as resolved_slug
  from public.ai_news_publications pub
    join public.ai_news_drafts d on d.id = pub.draft_id
    join public.ai_news_events e on e.id = pub.event_id
    join mapping m on m.slug = public.ai_news_district_slug(coalesce(d.district, e.district))
  where pub.status = 'published'
)
update public.posts p
set body = left(
    nullif(
      regexp_replace(
        regexp_replace(
          trim(p.body),
          '^.*(AI Haber Merkezi|AI destekli|yapay zekâ|Yapay zekâ|Görsel:|kategori tasarımı|olay fotoğrafı değildir|Foto.*raf:).*$',
          '',
          'gni'
        ),
        E'\n[ \t]*\n[ \t]*\n+',
        E'\n\n',
        'g'
      ),
      ''
    ) || E'\n\nFotoğraf: ' || t.credit,
    2000
  )
from targets t
where p.id = t.post_id;

with mapping(district, slug, credit, license_code, source_url) as (
  values
    ('Akçaabat', 'akcaabat', 'Muhammed6169 · CC BY-SA 4.0 · Wikimedia Commons', 'cc_by_sa_4', 'https://commons.wikimedia.org/wiki/File:Ortamahalle.jpg'),
    ('Araklı', 'arakli', 'Amjad Turky · CC BY-SA 4.0 · Wikimedia Commons', 'cc_by_sa_4', 'https://commons.wikimedia.org/wiki/File:Arakl%C4%B1_-_Trabzon_(Denize_bakan_tabiat_manzaras%C4%B1).jpg'),
    ('Arsin', 'arsin', 'Tarih · CC BY-SA 4.0 · Wikimedia Commons', 'cc_by_sa_4', 'https://commons.wikimedia.org/wiki/File:Ye%C5%9Filyal%C4%B1_Arsin.jpg'),
    ('Beşikdüzü', 'besikduzu', 'Serhat Baştan · CC BY-SA 4.0 · Wikimedia Commons', 'cc_by_sa_4', 'https://commons.wikimedia.org/wiki/File:Vakf%C4%B1kebir_Be%C5%9Fikd%C3%BCz%C3%BC.jpg'),
    ('Çarşıbaşı', 'carsibasi', 'Sinan Şahin · CC BY 3.0 · Wikimedia Commons', 'cc_by_3', 'https://commons.wikimedia.org/wiki/File:Trabzon_Sahil..._-_panoramio.jpg'),
    ('Çaykara', 'caykara', 'Ozbakanelwan · CC BY-SA 4.0 · Wikimedia Commons', 'cc_by_sa_4', 'https://commons.wikimedia.org/wiki/File:Uzung%C3%B6l,_Trabzon.jpg'),
    ('Dernekpazarı', 'dernekpazari', 'Muhammet Dilmaç · CC BY-SA 4.0 · Wikimedia Commons', 'cc_by_sa_4', 'https://commons.wikimedia.org/wiki/File:Trabzon_Kazank%C4%B1ran_Yaylas%C4%B1.jpg'),
    ('Düzköy', 'duzkoy', 'Francesco Bini · CC BY-SA 4.0 · Wikimedia Commons', 'cc_by_sa_4', 'https://commons.wikimedia.org/wiki/File:D%C3%BCzkoy,_villaggio_B%C3%BCy%C3%BCk,_campi_coltivati_con_covoni_di_granoturco.jpg'),
    ('Hayrat', 'hayrat', 'DesertEagle · Public domain · Wikimedia Commons', 'cc0', 'https://commons.wikimedia.org/wiki/File:A_view_from_Yarl%C4%B1,_Hayrat.JPG'),
    ('Köprübaşı', 'koprubasi', 'Murat Sancak · CC BY 3.0 · Wikimedia Commons', 'cc_by_3', 'https://commons.wikimedia.org/wiki/File:(25.08.2012)_-_(TRABZON_-_K%C3%96PR%C3%9CBA%C5%9EI_-_K%C3%B6%C5%9Fk_Yaylas%C4%B1)_-_panoramio.jpg'),
    ('Maçka', 'macka', 'Ben Bender · CC BY-SA 3.0 · Wikimedia Commons', 'cc_by_sa_3', 'https://commons.wikimedia.org/wiki/File:61750_Hamsik%C3%B6y-Ma%C3%A7ka-Trabzon,_Turkey_-_panoramio_(1).jpg'),
    ('Of', 'of', 'Selehattin Sezeroglu · CC BY 3.0 · Wikimedia Commons', 'cc_by_3', 'https://commons.wikimedia.org/wiki/File:61830_Dar%C4%B1l%C4%B1-Of-Trabzon,_Turkey_-_panoramio.jpg'),
    ('Ortahisar', 'ortahisar', 'Dosseman · CC BY-SA 4.0 · Wikimedia Commons', 'cc_by_sa_4', 'https://commons.wikimedia.org/wiki/File:Trabzon_view_from_K%C4%B1zlar_Manast%C4%B1r%C4%B1_4839.jpg'),
    ('Sürmene', 'surmene', 'Muhammet Dilmaç · CC BY-SA 4.0 · Wikimedia Commons', 'cc_by_sa_4', 'https://commons.wikimedia.org/wiki/File:Trabzon_Kazang%C4%B1ran_Yaylas%C4%B1_Yolu.jpg'),
    ('Şalpazarı', 'salpazari', 'Zeynel Cebeci · CC BY-SA 4.0 · Wikimedia Commons', 'cc_by_sa_4', 'https://commons.wikimedia.org/wiki/File:Geyikli,_%C5%9Ealpazar%C4%B1_01.jpg'),
    ('Tonya', 'tonya', 'Serhat Baştan · CC BY-SA 4.0 · Wikimedia Commons', 'cc_by_sa_4', 'https://commons.wikimedia.org/wiki/File:Tonya_(Kad%C4%B1ralak_Yaylas%C4%B1ndan_G%C3%B6r%C3%BCn%C3%BCm)-3.jpg'),
    ('Vakfıkebir', 'vakfikebir', 'zekeriya karkaç · CC BY 3.0 · Wikimedia Commons', 'cc_by_3', 'https://commons.wikimedia.org/wiki/File:Trabzon_Vakf%C4%B1kebir_ishakl%C4%B1_K%C3%B6y%C3%BCnden_Vakf%C4%B1kebire_Bak%C4%B1%C5%9F_-_panoramio.jpg'),
    ('Yomra', 'yomra', 'Sezer357 · CC BY 4.0 · Wikimedia Commons', 'cc_by_4', 'https://commons.wikimedia.org/wiki/File:%C3%96zdil,Yomra.jpg')
)
update public.post_media pm
set storage_path = 'ai-news/districts/' || t.slug || '.jpg',
    thumbnail_path = null
from (
  select distinct
    pub.post_id,
    m.slug
  from public.ai_news_publications pub
    join public.ai_news_drafts d on d.id = pub.draft_id
    join public.ai_news_events e on e.id = pub.event_id
    join mapping m on m.slug = public.ai_news_district_slug(coalesce(d.district, e.district))
  where pub.status = 'published'
) t
where pm.post_id = t.post_id;

with mapping(district, slug, credit, license_code, source_url) as (
  values
    ('Akçaabat', 'akcaabat', 'Muhammed6169 · CC BY-SA 4.0 · Wikimedia Commons', 'cc_by_sa_4', 'https://commons.wikimedia.org/wiki/File:Ortamahalle.jpg'),
    ('Araklı', 'arakli', 'Amjad Turky · CC BY-SA 4.0 · Wikimedia Commons', 'cc_by_sa_4', 'https://commons.wikimedia.org/wiki/File:Arakl%C4%B1_-_Trabzon_(Denize_bakan_tabiat_manzaras%C4%B1).jpg'),
    ('Arsin', 'arsin', 'Tarih · CC BY-SA 4.0 · Wikimedia Commons', 'cc_by_sa_4', 'https://commons.wikimedia.org/wiki/File:Ye%C5%9Filyal%C4%B1_Arsin.jpg'),
    ('Beşikdüzü', 'besikduzu', 'Serhat Baştan · CC BY-SA 4.0 · Wikimedia Commons', 'cc_by_sa_4', 'https://commons.wikimedia.org/wiki/File:Vakf%C4%B1kebir_Be%C5%9Fikd%C3%BCz%C3%BC.jpg'),
    ('Çarşıbaşı', 'carsibasi', 'Sinan Şahin · CC BY 3.0 · Wikimedia Commons', 'cc_by_3', 'https://commons.wikimedia.org/wiki/File:Trabzon_Sahil..._-_panoramio.jpg'),
    ('Çaykara', 'caykara', 'Ozbakanelwan · CC BY-SA 4.0 · Wikimedia Commons', 'cc_by_sa_4', 'https://commons.wikimedia.org/wiki/File:Uzung%C3%B6l,_Trabzon.jpg'),
    ('Dernekpazarı', 'dernekpazari', 'Muhammet Dilmaç · CC BY-SA 4.0 · Wikimedia Commons', 'cc_by_sa_4', 'https://commons.wikimedia.org/wiki/File:Trabzon_Kazank%C4%B1ran_Yaylas%C4%B1.jpg'),
    ('Düzköy', 'duzkoy', 'Francesco Bini · CC BY-SA 4.0 · Wikimedia Commons', 'cc_by_sa_4', 'https://commons.wikimedia.org/wiki/File:D%C3%BCzkoy,_villaggio_B%C3%BCy%C3%BCk,_campi_coltivati_con_covoni_di_granoturco.jpg'),
    ('Hayrat', 'hayrat', 'DesertEagle · Public domain · Wikimedia Commons', 'cc0', 'https://commons.wikimedia.org/wiki/File:A_view_from_Yarl%C4%B1,_Hayrat.JPG'),
    ('Köprübaşı', 'koprubasi', 'Murat Sancak · CC BY 3.0 · Wikimedia Commons', 'cc_by_3', 'https://commons.wikimedia.org/wiki/File:(25.08.2012)_-_(TRABZON_-_K%C3%96PR%C3%9CBA%C5%9EI_-_K%C3%B6%C5%9Fk_Yaylas%C4%B1)_-_panoramio.jpg'),
    ('Maçka', 'macka', 'Ben Bender · CC BY-SA 3.0 · Wikimedia Commons', 'cc_by_sa_3', 'https://commons.wikimedia.org/wiki/File:61750_Hamsik%C3%B6y-Ma%C3%A7ka-Trabzon,_Turkey_-_panoramio_(1).jpg'),
    ('Of', 'of', 'Selehattin Sezeroglu · CC BY 3.0 · Wikimedia Commons', 'cc_by_3', 'https://commons.wikimedia.org/wiki/File:61830_Dar%C4%B1l%C4%B1-Of-Trabzon,_Turkey_-_panoramio.jpg'),
    ('Ortahisar', 'ortahisar', 'Dosseman · CC BY-SA 4.0 · Wikimedia Commons', 'cc_by_sa_4', 'https://commons.wikimedia.org/wiki/File:Trabzon_view_from_K%C4%B1zlar_Manast%C4%B1r%C4%B1_4839.jpg'),
    ('Sürmene', 'surmene', 'Muhammet Dilmaç · CC BY-SA 4.0 · Wikimedia Commons', 'cc_by_sa_4', 'https://commons.wikimedia.org/wiki/File:Trabzon_Kazang%C4%B1ran_Yaylas%C4%B1_Yolu.jpg'),
    ('Şalpazarı', 'salpazari', 'Zeynel Cebeci · CC BY-SA 4.0 · Wikimedia Commons', 'cc_by_sa_4', 'https://commons.wikimedia.org/wiki/File:Geyikli,_%C5%9Ealpazar%C4%B1_01.jpg'),
    ('Tonya', 'tonya', 'Serhat Baştan · CC BY-SA 4.0 · Wikimedia Commons', 'cc_by_sa_4', 'https://commons.wikimedia.org/wiki/File:Tonya_(Kad%C4%B1ralak_Yaylas%C4%B1ndan_G%C3%B6r%C3%BCn%C3%BCm)-3.jpg'),
    ('Vakfıkebir', 'vakfikebir', 'zekeriya karkaç · CC BY 3.0 · Wikimedia Commons', 'cc_by_3', 'https://commons.wikimedia.org/wiki/File:Trabzon_Vakf%C4%B1kebir_ishakl%C4%B1_K%C3%B6y%C3%BCnden_Vakf%C4%B1kebire_Bak%C4%B1%C5%9F_-_panoramio.jpg'),
    ('Yomra', 'yomra', 'Sezer357 · CC BY 4.0 · Wikimedia Commons', 'cc_by_4', 'https://commons.wikimedia.org/wiki/File:%C3%96zdil,Yomra.jpg')
)
update public.ai_news_media_assets ma
set storage_path = 'ai-news/districts/' || t.slug || '.jpg',
    source_url = t.source_url,
    creator = split_part(t.credit, ' · ', 1),
    credit = t.credit,
    attribution = t.credit,
    license_code = t.license_code,
    license_reference = t.source_url,
    is_placeholder = false,
    status = 'published',
    alt_text = t.district || ' ilçesinden bir görünüm',
    mime_type = 'image/jpeg'
from (
  select distinct
    pub.event_id,
    m.slug,
    m.district,
    m.credit,
    m.license_code,
    m.source_url
  from public.ai_news_publications pub
    join public.ai_news_drafts d on d.id = pub.draft_id
    join public.ai_news_events e on e.id = pub.event_id
    join mapping m on m.slug = public.ai_news_district_slug(coalesce(d.district, e.district))
  where pub.status = 'published'
) t
where ma.event_id = t.event_id
  and ma.status in ('approved', 'published');

-- ---------------------------------------------------------------------------
-- 4. Yeni yayınlarda fotoğraf atfını gövdeye ekle.
-- ---------------------------------------------------------------------------
create or replace function public.ai_news_media_credit_body()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_credit text;
begin
  if new.storage_path is null or new.storage_path not like 'ai-news/%' then
    return new;
  end if;

  select nullif(btrim(coalesce(m.attribution, m.credit, '')), '')
  into v_credit
  from public.ai_news_media_assets m
  where m.storage_path = new.storage_path
  order by m.created_at desc
  limit 1;

  if v_credit is null then
    return new;
  end if;

  update public.posts p
  set body = left(p.body || E'\n\nFotoğraf: ' || v_credit, 2000)
  where p.id = new.post_id
    and p.body not like '%Fotoğraf:%';

  return new;
end;
$$;

drop trigger if exists ai_news_media_credit on public.post_media;
create trigger ai_news_media_credit
  after insert on public.post_media
  for each row execute function public.ai_news_media_credit_body();

revoke all on function public.ai_news_media_credit_body() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Kamuya açık haber verisi: yapay zekâ alanları dönmez.
-- ---------------------------------------------------------------------------
create or replace function public.ai_news_public_post(p_post_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_event public.ai_news_events%rowtype;
  v_draft public.ai_news_drafts%rowtype;
  v_publication public.ai_news_publications%rowtype;
  v_category public.ai_news_categories%rowtype;
  v_sources jsonb;
  v_media public.ai_news_media_assets%rowtype;
  v_post public.posts%rowtype;
begin
  select * into v_post from public.posts where id = p_post_id;
  if not found or v_post.moderation_status <> 'visible' then
    return null;
  end if;

  select * into v_publication
  from public.ai_news_publications
  where post_id = p_post_id and status = 'published';
  if not found then
    return null;
  end if;

  select * into v_event from public.ai_news_events where id = v_publication.event_id;
  select * into v_draft from public.ai_news_drafts where id = v_publication.draft_id;
  select * into v_category from public.ai_news_categories
  where slug = coalesce(v_draft.category_slug, v_event.category_slug);
  select * into v_media from public.ai_news_media_assets
  where event_id = v_event.id and status = 'published'
  order by created_at desc limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
    'domain', v.source_domain::text,
    'kind', v.source_kind,
    'url', v.url,
    'title', v.title,
    'retrieved_at', v.retrieved_at
  ) order by v.source_kind = 'official' desc, v.retrieved_at), '[]'::jsonb)
  into v_sources
  from public.ai_news_evidence v
  where v.event_id = v_event.id;

  return jsonb_build_object(
    'event_id', v_event.id,
    'post_id', p_post_id,
    'slug', v_publication.slug,
    'title', v_draft.title,
    'spot', v_draft.spot,
    'body', v_draft.body,
    'category_slug', coalesce(v_draft.category_slug, v_event.category_slug),
    'category_name', coalesce(v_category.name_tr, 'Trabzon Gündem'),
    'district', coalesce(v_draft.district, v_event.district),
    'event_date', coalesce(v_draft.event_date, v_event.event_date),
    'risk_level', v_event.risk_level,
    'sources', v_sources,
    'source_count', jsonb_array_length(v_sources),
    'independent_sources', v_event.independent_sources,
    'primary_source', v_event.primary_source,
    'published_at', v_publication.published_at,
    'updated_at', v_draft.updated_at,
    'last_checked_at', v_publication.published_at,
    'correction_path', '/support',
    'published_by', 'Trabzone Haber',
    'media', case when v_media.id is null then null else jsonb_build_object(
      'storage_path', v_media.storage_path,
      'is_placeholder', v_media.is_placeholder,
      'alt_text', v_media.alt_text,
      'credit', v_media.credit,
      'license_code', v_media.license_code,
      'attribution', v_media.attribution
    ) end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Yayıncı profili: yapay zekâ ifadesi yok.
-- ---------------------------------------------------------------------------
update public.profiles
set bio = 'Trabzone’un resmî haber hesabı. Trabzon ve 18 ilçesinden güncel gelişmeler, resmî duyurular ve yerel yaşam haberleri.',
    updated_at = now()
where username = 'trabzonehaber';

commit;
