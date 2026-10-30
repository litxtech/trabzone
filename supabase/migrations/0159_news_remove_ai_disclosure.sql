-- ---------------------------------------------------------------------------
-- 0159 — Haberlerde "yapay zekâ ile hazırlandı" bilgisi kaldırıldı
--
-- Belirti:
--   Haber detayındaki künye ve haber sayfası, metnin yapay zekâ desteğiyle
--   yazıldığını söylüyordu. Okuyucunun görmesi gereken bilgi haberin kendisi
--   ve kaynaklarıdır; üretim yöntemi değildir.
--
-- Çözüm:
--   1) `news_disclosure_clean` künye metninden yapay zekâ/AI ifadelerini
--      ayıklar; geriye anlamlı bir metin kalmazsa nötr künye döner.
--   2) Haber detayı ve kaynak haber sayfası fonksiyonları, mevcut gövdeleri
--      korunarak ince bir sarmalayıcıya alınır; künye okuma anında temizlenir.
--      Böylece daha önce yayımlanmış haberler de düzeltilir.
-- ---------------------------------------------------------------------------

create or replace function public.news_disclosure_clean(p_text text)
returns text
language sql
immutable
as $$
  select coalesce(
    nullif(
      btrim(
          regexp_replace(
            regexp_replace(
              regexp_replace(coalesce(p_text, ''), 'Metin yapay zek[aâ][^.]*\.', '', 'gi'),
              '[Yy]apay zek[aâ][^.]*\.', '', 'g'
            ),
            'AI Haber Merkezi', 'Haber', 'gi'
          )
      ),
      ''
    ),
    'Bu haber, kamuya açık kaynaklardan derlenen doğrulanmış bilgilerle Trabzone Haber editoryası tarafından hazırlanmıştır.'
  );
$$;

revoke all on function public.news_disclosure_clean(text) from public, anon;
grant execute on function public.news_disclosure_clean(text) to authenticated, service_role;

do $$
begin
  if to_regprocedure('public._news_post_detail_ai_clean(uuid)') is null then
    alter function public.news_post_detail(uuid) rename to _news_post_detail_ai_clean;
  end if;
  if to_regprocedure('public._news_source_public_post_ai_clean(text)') is null then
    alter function public.news_source_public_post_by_slug(text)
      rename to _news_source_public_post_ai_clean;
  end if;
end $$;

revoke all on function public._news_post_detail_ai_clean(uuid) from public, anon, authenticated;
revoke all on function public._news_source_public_post_ai_clean(text) from public, anon, authenticated;

create or replace function public.news_post_detail(p_post_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  v := public._news_post_detail_ai_clean(p_post_id);
  if v is null then
    return null;
  end if;
  return jsonb_set(
    v,
    '{disclosure}',
    to_jsonb(public.news_disclosure_clean(v ->> 'disclosure')),
    true
  );
end;
$$;

create or replace function public.news_source_public_post_by_slug(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  v := public._news_source_public_post_ai_clean(p_slug);
  if v is null then
    return null;
  end if;
  return jsonb_set(
    v,
    '{disclosure}',
    to_jsonb(public.news_disclosure_clean(v ->> 'disclosure')),
    true
  );
end;
$$;

revoke all on function public.news_post_detail(uuid) from public, anon;
grant execute on function public.news_post_detail(uuid) to authenticated, service_role;

revoke all on function public.news_source_public_post_by_slug(text) from public, anon;
grant execute on function public.news_source_public_post_by_slug(text) to authenticated, service_role;

insert into supabase_migrations.schema_migrations (version, name)
values ('0159', 'news_remove_ai_disclosure')
on conflict (version) do nothing;
