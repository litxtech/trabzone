-- 0139: Anlık Haber V1 sertleştirme
--
-- 1) `tz_live_news_brief` risk sinyallerini ve editör notunu yalnızca içerik
--    sahibine ve yöneticiye gösterir. Akıştaki diğer kullanıcılar yalnızca
--    doğrulama durumunu görür; böylece moderasyon sinyalleri sızmaz.
-- 2) `live_news_get`, canlı kayıt görünür olsa bile bağlı gönderi gizliyse
--    içeriği sahibi/yönetici dışında kimseye döndürmez.
-- 3) Site haritası sorgusu için doğrulanmış + görünür + yayınlanmış kayıtlar
--    üzerinde kısmi indeks ekler.

begin;

set search_path = public, extensions;

create index if not exists live_news_sitemap_idx
  on public.live_news (published_at desc)
  where moderation_status = 'visible'
    and verification_status = 'verified'
    and published_at is not null;

create or replace function public.tz_live_news_brief(p_post_id uuid, p_me uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'post_id', ln.post_id,
    'canonical_id', ln.canonical_id,
    'title', ln.title,
    'summary', ln.summary,
    'category', ln.category,
    'city', ln.city,
    'district', ln.district,
    'location_precision', ln.location_precision,
    'media_kind', ln.media_kind,
    'publish_targets', ln.publish_targets,
    'cross_post_reel', ln.cross_post_reel,
    'reel_id', ln.reel_id,
    'verification_status', ln.verification_status,
    'verification_note', case
      when ln.author_id = p_me or public.is_admin() then ln.verification_note
      else null
    end,
    'verified_at', ln.verified_at,
    'moderation_status', ln.moderation_status,
    'risk_level', case
      when ln.author_id = p_me or public.is_admin() then ln.risk_level
      else null
    end,
    'risk_flags', case
      when ln.author_id = p_me or public.is_admin() then ln.risk_flags
      else '[]'::jsonb
    end,
    'usage_consent', ln.usage_consent,
    'newsroom_state', ln.newsroom_state,
    'published_at', ln.published_at,
    'reports_count', ln.reports_count,
    'is_mine', ln.author_id = p_me,
    'is_admin', public.is_admin(),
    'created_at', ln.created_at,
    'updated_at', ln.updated_at
  )
  from public.live_news ln
  where ln.post_id = p_post_id;
$$;

revoke all on function public.tz_live_news_brief(uuid, uuid) from public, anon, authenticated;

create or replace function public.live_news_get(p_post_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.live_news%rowtype;
  v_post_visible boolean;
begin
  select * into v_row from public.live_news where post_id = p_post_id;
  if not found then
    return null;
  end if;

  select exists (
    select 1 from public.posts p
    where p.id = p_post_id and p.moderation_status = 'visible'
  ) into v_post_visible;

  -- Sahibi ve yönetici kendi/bekleyen kaydını görebilir. Diğer kullanıcılar
  -- için hem canlı kayıt hem bağlı gönderi görünür olmalıdır.
  if (v_row.moderation_status <> 'visible' or not v_post_visible)
     and v_row.author_id <> v_uid
     and not public.is_admin() then
    return null;
  end if;

  return public.tz_post_json(p_post_id, v_uid);
end;
$$;

revoke all on function public.live_news_get(uuid) from public, anon;
grant execute on function public.live_news_get(uuid) to authenticated;

commit;
