-- ---------------------------------------------------------------------------
-- 0134 — Editoryal okuma süresi, kısa haber biçimi ve kaynak metni onarımı
--
-- Neden gerekli?
--   * 0133 canlıya uygulanırken yalnızca fonksiyon içindeki birkaç Türkçe
--     metin bozuldu (mojibake). Tablolardaki veriler sağlam.
--   * `reading_min_words` yanlışlıkla "en az okuma dakikası" gibi
--     kullanılıyordu; 116 kelimelik haber "3 dk" görünüyordu.
--   * Kısa yayımlanan haberler `standard` etiketiyle görünebiliyordu.
--     Artık biçim, gerçek kelime sayısı ve admin eşiklerinden türetilir.
--   * Kısa haberlerde şeffaflık notu gösterilir; metin asla uzatılmaz.
--
-- Bu migration mevcut fonksiyonları yeniden adlandırıp ince bir onarım
-- katmanı ekler. Böylece 0133'ün tamamını tekrar çalıştırmaya gerek kalmaz.
-- ---------------------------------------------------------------------------

-- 1) Eski gövdeleri bir kez yedeğe al -------------------------------------
do $$
begin
  if to_regprocedure('public.ai_news_public_post(uuid)') is not null
     and to_regprocedure('public._ai_news_public_post_legacy(uuid)') is null then
    alter function public.ai_news_public_post(uuid)
      rename to _ai_news_public_post_legacy;
  end if;

  if to_regprocedure('public.news_post_detail(uuid)') is not null
     and to_regprocedure('public._news_post_detail_legacy(uuid)') is null then
    alter function public.news_post_detail(uuid)
      rename to _news_post_detail_legacy;
  end if;

  if to_regprocedure('public.news_source_public_post_by_slug(text)') is not null
     and to_regprocedure('public._news_source_public_post_by_slug_legacy(text)') is null then
    alter function public.news_source_public_post_by_slug(text)
      rename to _news_source_public_post_by_slug_legacy;
  end if;

  if to_regprocedure('public.news_source_post_meta(uuid)') is not null
     and to_regprocedure('public._news_source_post_meta_legacy(uuid)') is null then
    alter function public.news_source_post_meta(uuid)
      rename to _news_source_post_meta_legacy;
  end if;

  if to_regprocedure('public.share_card(text, text)') is not null
     and to_regprocedure('public._share_card_legacy(text, text)') is null then
    alter function public.share_card(text, text)
      rename to _share_card_legacy;
  end if;
end $$;

-- 2) Biçim türetimi -------------------------------------------------------
create or replace function public.news_effective_format(
  p_word_count integer,
  p_declared text default null
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.ai_news_settings%rowtype;
  v_words integer := greatest(coalesce(p_word_count, 0), 0);
begin
  select * into s from public.ai_news_settings order by (id = true) desc limit 1;
  if s.id is null then
    return coalesce(p_declared, 'short');
  end if;

  -- Kelime sayısı eşiklerin altındaysa etiket gerçeği yansıtmalıdır.
  if v_words <= s.short_max_words then
    return 'short';
  end if;
  if v_words < s.standard_min_words then
    return 'short';
  end if;
  if v_words < s.extended_min_words then
    return 'standard';
  end if;
  return 'extended';
end;
$$;

revoke all on function public.news_effective_format(integer, text) from public, anon;
grant execute on function public.news_effective_format(integer, text)
  to authenticated, service_role;

-- Eski kayıtların biçim etiketi gerçek kelime sayısını yansıtsın. Metin
-- değiştirilmez; yalnızca short/standard/extended sınıflandırması düzeltilir.
update public.ai_news_drafts
   set body_format = public.news_effective_format(
     coalesce(word_count, public.news_word_count(body)), body_format)
 where body_format is distinct from public.news_effective_format(
     coalesce(word_count, public.news_word_count(body)), body_format);

update public.news_source_items
   set body_format = public.news_effective_format(
     public.news_word_count(body), body_format)
 where body_format is distinct from public.news_effective_format(
     public.news_word_count(body), body_format);

-- 3) Akış kartı meta'sı: doğru okuma süresi ve biçim ----------------------
create or replace function public.ai_news_public_post(p_post_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
  v_words integer;
  v_format text;
  s public.ai_news_settings%rowtype;
begin
  v := public._ai_news_public_post_legacy(p_post_id);
  if v is null then
    return null;
  end if;

  select * into s from public.ai_news_settings order by (id = true) desc limit 1;

  v_words := greatest(coalesce((v ->> 'word_count')::integer, 0), 0);
  v_format := public.news_effective_format(v_words, v ->> 'body_format');

  v := jsonb_set(v, '{reading_minutes}',
    to_jsonb(greatest(1, ceil(greatest(v_words, 1) / 200.0)::integer)), true);
  v := jsonb_set(v, '{body_format}', to_jsonb(v_format), true);
  v := jsonb_set(v, '{preview_lines}',
    to_jsonb(least(greatest(coalesce(s.preview_lines, 4), 2), 6)), true);
  v := jsonb_set(v, '{body_notice}', to_jsonb(
    case
      when v_format <> 'short' then null
      when s.short_min_words is not null and v_words < s.short_min_words then
        'Kısa haber: Kaynaklarda doğrulanmış bilgi sınırlı olduğu için haber kısa formatta yayımlanmıştır. Metni uzatmak için doğrulanmamış bilgi eklenmemiştir.'
      else
        'Kısa haber: Bu metin yalnızca kaynaklarla doğrulanmış bilgilerle hazırlanmıştır. Doğrulanmamış ayrıntı eklenmemiştir.'
    end
  ), true);

  return v;
end;
$$;

revoke all on function public.ai_news_public_post(uuid) from public;
grant execute on function public.ai_news_public_post(uuid)
  to anon, authenticated, service_role;

-- 4) Tam haber detayı: okuma süresi, biçim, şeffaflık notu, düzgün Türkçe -
create or replace function public.news_post_detail(p_post_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
  v_kind text;
  v_words integer;
  v_format text;
  v_notice text;
  v_source_name text;
  s public.ai_news_settings%rowtype;
begin
  v := public._news_post_detail_legacy(p_post_id);
  if v is null then
    return null;
  end if;

  select * into s from public.ai_news_settings order by (id = true) desc limit 1;

  v_kind := coalesce(v ->> 'kind', 'source');
  v_words := greatest(coalesce((v ->> 'word_count')::integer, 0), 0);
  v_format := public.news_effective_format(v_words, v ->> 'body_format');
  v_source_name := coalesce(
    nullif(v -> 'source_card' ->> 'name', ''),
    nullif(v ->> 'published_by', ''),
    'haber kaynağı'
  );

  -- Okuma süresi: 200 kelime/dk, en az 1 dk. Admin ayarı burada dakika
  -- olarak değil, biçim eşikleri olarak kullanılır.
  v := jsonb_set(v, '{reading_minutes}',
    to_jsonb(greatest(1, ceil(greatest(v_words, 1) / 200.0)::integer)), true);
  v := jsonb_set(v, '{body_format}', to_jsonb(v_format), true);

  if v_kind = 'source' then
    -- Kaynak metni onarımı: 0133'te bozulan Türkçe karakterlerin yerine
    -- doğrudan UTF-8 metin üretilir.
    v := jsonb_set(v, '{disclosure}', to_jsonb(
      'Bu haber, ' || v_source_name ||
      ' tarafından kamuya açıklanan bilgilerden yararlanılarak Trabzone Haber editoryası tarafından yeniden yazılmıştır. ' ||
      'Orijinal kaynağa ve kaynak bilgisine sayfanın altından ulaşabilirsiniz.'
    ), true);

    if v_format = 'short' then
      v_notice := 'Kısa haber: Bu metin, kaynakta yayımlanan doğrulanmış bilgilerle özetlenmiştir. Doğrulanmamış ayrıntı eklenmemiş, metin uzatılmamıştır. Tam metin için orijinal kaynağa gidebilirsiniz.';
    else
      v_notice := null;
    end if;
  else
    if v_format = 'short' then
      v_notice := case
        when s.short_min_words is not null and v_words < s.short_min_words then
          'Kısa haber: Kaynaklarda doğrulanmış bilgi sınırlı olduğu için haber kısa formatta yayımlanmıştır. Metni uzatmak için doğrulanmamış bilgi eklenmemiştir.'
        else
          'Kısa haber: Bu metin yalnızca kaynaklarla doğrulanmış bilgilerle hazırlanmıştır. Doğrulanmamış ayrıntı eklenmemiştir.'
      end;
    else
      v_notice := null;
    end if;
  end if;

  v := jsonb_set(v, '{body_notice}', to_jsonb(v_notice), true);

  return v;
end;
$$;

revoke all on function public.news_post_detail(uuid) from public, anon;
grant execute on function public.news_post_detail(uuid)
  to authenticated, service_role;

-- 5) Kaynak haber web sayfası: düzgün Türkçe, biçim ve okuma süresi -------
create or replace function public.news_source_public_post_by_slug(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
  v_publisher text;
  v_words integer;
  v_format text;
  v_notice text;
begin
  v := public._news_source_public_post_by_slug_legacy(p_slug);
  if v is null then
    return null;
  end if;

  v_publisher := coalesce(nullif(v ->> 'published_by', ''), 'haber kaynağı');
  v_words := greatest(coalesce((v ->> 'word_count')::integer, 0), 0);
  v_format := public.news_effective_format(v_words, v ->> 'body_format');

  v := jsonb_set(v, '{reading_minutes}',
    to_jsonb(greatest(1, ceil(greatest(v_words, 1) / 200.0)::integer)), true);
  v := jsonb_set(v, '{body_format}', to_jsonb(v_format), true);

  -- 0133 uygulanırken bozulan Türkçe karakterlerin yerine doğrudan UTF-8.
  v := jsonb_set(v, '{disclosure}', to_jsonb(
    case
      when coalesce((v ->> 'ai_generated')::boolean, false) then
        'Bu haber, kaynağın kamuya açıkladığı bilgilerden yararlanılarak Trabzone Haber editoryası tarafından özgün biçimde yazılmıştır. Orijinal kaynak bağlantısı sayfanın altındadır.'
      else
        'Bu haber, ' || v_publisher ||
        ' tarafından yayımlanan içerikten, kaynağın izin verdiği kapsamda aktarılmıştır. ' ||
        'Orijinal habere ve kaynak bilgisine sayfanın altından ulaşabilirsiniz.'
    end
  ), true);

  if v -> 'media' is not null and jsonb_typeof(v -> 'media') = 'object' then
    v := jsonb_set(v, '{media,attribution}',
      to_jsonb('Fotoğraf: ' || v_publisher), true);
  end if;

  if v_format = 'short' then
    v_notice := 'Kısa haber: Bu metin, kaynakta yayımlanan doğrulanmış bilgilerle özetlenmiştir. Doğrulanmamış ayrıntı eklenmemiş, metin uzatılmamıştır. Tam metin için orijinal kaynağa gidebilirsiniz.';
  else
    v_notice := null;
  end if;
  v := jsonb_set(v, '{body_notice}', to_jsonb(v_notice), true);

  return v;
end;
$$;

revoke all on function public.news_source_public_post_by_slug(text) from public;
grant execute on function public.news_source_public_post_by_slug(text)
  to anon, authenticated, service_role;

-- 6) Akış kartı meta'sı: admin önizleme satırı sayısı ---------------------
create or replace function public.news_source_post_meta(p_post_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when m.meta is null then null
    else m.meta || jsonb_build_object(
      'preview_lines',
      least(greatest(coalesce(
        (select s.preview_lines from public.ai_news_settings s order by (s.id = true) desc limit 1),
        4
      ), 2), 6)
    )
  end
  from (select public._news_source_post_meta_legacy(p_post_id) as meta) m;
$$;

revoke all on function public.news_source_post_meta(uuid) from public, anon, authenticated;
grant execute on function public.news_source_post_meta(uuid) to service_role;

-- 7) Paylaşım kartı: haberlerde başlık, spot ve kapak --------------------
create or replace function public.share_card(p_type text, p_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_card jsonb;
  v_detail jsonb;
  v_slug text;
begin
  v_card := public._share_card_legacy(p_type, p_key);
  if v_card is null or coalesce(v_card ->> 'type', '') <> 'post' then
    return v_card;
  end if;

  begin
    v_detail := public.news_post_detail(p_key::uuid);
  exception when others then
    v_detail := null;
  end;

  if v_detail is null then
    return v_card;
  end if;

  select coalesce(
    (select slug from public.ai_news_publications
      where post_id = p_key::uuid and status = 'published' limit 1),
    (select 'kaynak-' || post_id::text from public.news_publication_links
      where post_id = p_key::uuid and status = 'published' limit 1)
  ) into v_slug;

  return v_card || jsonb_build_object(
    'title', v_detail ->> 'title',
    'label', 'Haber',
    'description', coalesce(nullif(v_detail ->> 'summary', ''), v_detail ->> 'title'),
    'path', case when v_slug is not null then '/haber/' || v_slug else v_card ->> 'path' end,
    'bucket', 'posts',
    'image_path', v_detail -> 'media' -> 0 ->> 'storage_path',
    'author_name', coalesce(v_detail -> 'publisher' ->> 'display_name', 'Trabzone Haber'),
    'author_username', v_detail -> 'publisher' ->> 'username',
    'published_at', v_detail ->> 'published_at',
    'location', v_detail ->> 'district',
    'metrics', concat(
      coalesce((v_detail -> 'counts' ->> 'like')::integer, 0), ' beğeni · ',
      coalesce((v_detail -> 'counts' ->> 'comment')::integer, 0), ' yorum'
    ),
    'news', true
  );
end;
$$;

revoke all on function public.share_card(text, text) from public;
grant execute on function public.share_card(text, text)
  to anon, authenticated, service_role;

-- 8) Eski yedek fonksiyonlar dışarıya kapalı ------------------------------
revoke all on function public._ai_news_public_post_legacy(uuid) from public, anon, authenticated;
revoke all on function public._news_post_detail_legacy(uuid) from public, anon, authenticated;
revoke all on function public._news_source_public_post_by_slug_legacy(text) from public, anon, authenticated;
revoke all on function public._news_source_post_meta_legacy(uuid) from public, anon, authenticated;
revoke all on function public._share_card_legacy(text, text) from public, anon, authenticated;

comment on function public.news_effective_format(integer, text) is
  'Kelime sayısı ve admin eşiklerinden short/standard/extended biçimini türetir.';
