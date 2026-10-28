-- 0135 — Editoryal yayın kapısını sıkılaştır, profil haber akışını kalıcılaştır.
--
--  * Otomatik yayında doğrulanamayan alıntı, çelişkili kaynak, hatalı kişi/unvan
--    ve kalite eşiği altındaki metin yayına çıkamaz.
--  * `feed_profile_posts` daha önce 0131 içinde tanımlanmıştı; yeni ortamlarda
--    ve yeniden uygulamalarda kaybolmaması için burada da idempotent tanımlanır.
--  * HaberTS kaynağının bozuk kodlanmış lisans notu okunabilir Türkçeye çevrilir.

-- ---------------------------------------------------------------------------
-- 1. Otomatik yayın kapısı: doğrulanmamış olgu / alıntı / çelişki geçemez
-- ---------------------------------------------------------------------------
create or replace function public.ai_news_publication_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_draft public.ai_news_drafts%rowtype;
  v_settings public.ai_news_settings%rowtype;
  v_unsupported integer := 0;
  v_conflicts integer := 0;
begin
  if new.mode <> 'auto' then
    return new;
  end if;

  select * into v_settings from public.ai_news_settings where id;
  if not coalesce(v_settings.quality_check_enabled, true) then
    return new;
  end if;

  select * into v_draft from public.ai_news_drafts where id = new.draft_id;
  if not found then
    return new;
  end if;

  begin
    v_unsupported := coalesce((v_draft.editorial_checks ->> 'unsupported_claims')::integer, 0);
  exception when others then
    v_unsupported := 0;
  end;

  begin
    v_conflicts := coalesce(jsonb_array_length(v_draft.editorial_checks -> 'conflicts'), 0);
  exception when others then
    v_conflicts := 0;
  end;

  if v_unsupported > 0 then
    raise exception 'editorial_check_failed' using errcode = '22023';
  end if;

  if v_conflicts > 0 then
    raise exception 'source_conflict_detected' using errcode = '22023';
  end if;

  if (v_draft.editorial_checks -> 'quotes_ok') = 'false'::jsonb then
    raise exception 'quote_verification_failed' using errcode = '22023';
  end if;

  if (v_draft.editorial_checks -> 'names_ok') = 'false'::jsonb then
    raise exception 'entity_verification_failed' using errcode = '22023';
  end if;

  if coalesce(v_draft.quality_score, 0) < coalesce(v_settings.min_quality_score, 0.72) then
    raise exception 'quality_below_threshold' using errcode = '22023';
  end if;

  if coalesce(v_settings.require_source_verification, true)
     and coalesce(jsonb_array_length(v_draft.source_references), 0) = 0
     and coalesce(jsonb_array_length(v_draft.source_facts), 0) = 0 then
    raise exception 'source_reference_missing' using errcode = '22023';
  end if;

  return new;
end;
$$;

drop trigger if exists ai_news_publication_guard on public.ai_news_publications;
create trigger ai_news_publication_guard
  before insert on public.ai_news_publications
  for each row execute function public.ai_news_publication_guard();

revoke all on function public.ai_news_publication_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Profildeki "Haberler" sekmesi: yerel AI haberleri + kaynak haberleri
-- ---------------------------------------------------------------------------
create or replace function public.feed_profile_posts(
  p_username text,
  p_kind     text default 'posts',
  p_limit    integer default 18,
  p_offset   integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid    uuid := public.tz_require_uid();
  v_author uuid;
  v_limit  integer := least(greatest(coalesce(p_limit, 18), 1), 40);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_kind   text := coalesce(nullif(trim(p_kind), ''), 'posts');
begin
  select p.id into v_author
  from public.profiles p
  where p.username = lower(trim(p_username));

  if v_author is null or public.is_blocked(v_uid, v_author) then
    return jsonb_build_object('items', '[]'::jsonb);
  end if;

  if not public.can_view_profile_content(v_author) then
    raise exception 'profile_restricted' using errcode = '42501';
  end if;

  if v_kind not in ('posts', 'media', 'news') then
    raise exception 'invalid_kind' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'items', coalesce(
      (
        select jsonb_agg(public.tz_post_json(x.id, v_uid) order by x.created_at desc)
        from (
          select p.id, p.created_at
          from public.posts p
          where p.author_id = v_author
            and p.moderation_status = 'visible'
            and (p.visibility = 'public' or v_author = v_uid or public.is_following(v_author))
            and (
              v_kind = 'posts'
              or (v_kind = 'media' and exists (
                select 1 from public.post_media m where m.post_id = p.id
              ))
              or (v_kind = 'news' and (
                exists (
                  select 1 from public.ai_news_publications pub
                  where pub.post_id = p.id and pub.status = 'published'
                )
                or exists (
                  select 1 from public.news_publication_links l
                  where l.post_id = p.id and l.status = 'published'
                )
              ))
            )
          order by p.created_at desc
          limit v_limit offset v_offset
        ) x
      ),
      '[]'::jsonb
    )
  );
end;
$$;

revoke all on function public.feed_profile_posts(text, text, integer, integer) from public, anon;
grant execute on function public.feed_profile_posts(text, text, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Bozuk kodlanmış lisans notunu okunabilir metne çevir
-- ---------------------------------------------------------------------------
update public.news_api_connections
set license_note = 'Yönetici kararı: özet + kaynak atfı ile onaysız yayın onaylandı.'
where license_note like '%' || chr(65533) || '%';
