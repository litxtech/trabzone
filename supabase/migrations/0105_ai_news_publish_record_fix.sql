-- 0105 — AI Haber Merkezi yayınlama fonksiyonu kayıt tipi düzeltmesi
--
-- 0097'de `ai_news_publish_event` içinde yayıncı profili `uuid` olarak
-- tanımlanmış ancak `v_publisher.id`, `.username` ve `.account_status`
-- alanları kullanılmıştı. PL/pgSQL bunu "missing FROM-clause entry" hatasıyla
-- reddediyor, dolayısıyla hem manuel hem otomatik yayın çalışmıyordu.
--
-- Ayrıca kayıt (record) değişkenleri atanmadığında `.id` erişimi aynı hatayı
-- üretiyordu. Taslak, medya, lisans ve yayıncı kontrolleri artık kayıt
-- bütünlüğü üzerinden yapılır. İş kuralları değişmedi.

begin;

set search_path = public, extensions;

create or replace function public.ai_news_publish_event(
  p_event_id uuid,
  p_mode text default 'auto',
  p_actor uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings public.ai_news_settings%rowtype;
  v_event public.ai_news_events%rowtype;
  v_draft public.ai_news_drafts%rowtype;
  v_media public.ai_news_media_assets%rowtype;
  v_license public.ai_news_media_licenses%rowtype;
  v_category public.ai_news_categories%rowtype;
  v_publisher public.profiles%rowtype;
  v_existing public.ai_news_publications%rowtype;
  v_post_id uuid;
  v_publication_id uuid;
  v_body text;
  v_sources text;
  v_slot integer;
  v_hour integer;
  v_last timestamptz;
  v_day date := public.ai_news_istanbul_day(now());
  v_mode text := case when p_mode = 'manual' then 'manual' else 'auto' end;
  v_placeholder boolean := false;
  v_notified integer := 0;
begin
  select * into v_settings from public.ai_news_settings where id;

  select * into v_event from public.ai_news_events where id = p_event_id for update;
  if not found then
    raise exception 'event_not_found' using errcode = 'P0002';
  end if;

  select * into v_existing from public.ai_news_publications where event_id = p_event_id;
  if found then
    return jsonb_build_object(
      'published', true,
      'already_published', true,
      'post_id', v_existing.post_id,
      'publication_id', v_existing.id,
      'status', v_existing.status
    );
  end if;

  if v_event.status not in ('ready', 'awaiting_review', 'verified') then
    raise exception 'event_not_publishable' using errcode = '22023';
  end if;

  select * into v_draft from public.ai_news_drafts
  where event_id = p_event_id and is_current
  order by version desc limit 1;

  if v_draft is null then
    raise exception 'draft_missing' using errcode = '22023';
  end if;

  select * into v_publisher from public.profiles
  where id = coalesce(
    v_settings.publisher_user_id,
    (select p.id from public.profiles p where p.username = v_settings.publisher_username)
  );

  if v_publisher is null then
    raise exception 'publisher_missing' using errcode = '22023';
  end if;
  if v_publisher.account_status <> 'active' then
    raise exception 'publisher_inactive' using errcode = '22023';
  end if;

  if v_mode = 'auto' then
    if v_settings.auto_publish_enabled is not true then
      raise exception 'auto_publish_disabled' using errcode = '22023';
    end if;
    if v_settings.dry_run then
      raise exception 'dry_run_active' using errcode = '22023';
    end if;
    if v_event.risk_level <> 'A' then
      raise exception 'risk_blocked' using errcode = '22023';
    end if;
    if coalesce(v_event.conflict, false) then
      raise exception 'source_conflict' using errcode = '22023';
    end if;
    if cardinality(v_event.auto_block_reasons) > 0 then
      raise exception 'auto_block_reasons' using errcode = '22023';
    end if;
    if not coalesce(v_event.primary_source, false)
       and coalesce(v_event.independent_sources, 0) < 2 then
      raise exception 'insufficient_independent_sources' using errcode = '22023';
    end if;
    if v_draft.quality_score < v_settings.min_quality_score then
      raise exception 'quality_too_low' using errcode = '22023';
    end if;

    -- Yayınları gün içine yay: pencere dışında ve çok sık yayımlama.
    v_hour := extract(hour from (now() at time zone 'Europe/Istanbul'))::integer;
    if v_settings.publish_window_start < v_settings.publish_window_end then
      if v_hour < v_settings.publish_window_start or v_hour >= v_settings.publish_window_end then
        raise exception 'publish_deferred' using errcode = '22023';
      end if;
    elsif v_settings.publish_window_start > v_settings.publish_window_end then
      if v_hour < v_settings.publish_window_start and v_hour >= v_settings.publish_window_end then
        raise exception 'publish_deferred' using errcode = '22023';
      end if;
    end if;

    select max(p.published_at) into v_last
    from public.ai_news_publications p
    where p.mode = 'auto' and p.status = 'published';

    if v_last is not null
       and v_last > now() - make_interval(mins => v_settings.auto_min_gap_minutes) then
      raise exception 'publish_deferred' using errcode = '22023';
    end if;
  end if;

  select * into v_media
  from public.ai_news_media_assets m
  where m.event_id = p_event_id and m.status = 'approved'
  order by m.is_placeholder asc, m.event_match_score desc, m.created_at asc
  limit 1;

  if v_media is not null then
    select * into v_license from public.ai_news_media_licenses where code = v_media.license_code;

    if not v_media.is_placeholder then
      if v_license is null or not v_license.is_usable or not v_license.commercial_use then
        raise exception 'media_license_invalid' using errcode = '22023';
      end if;
      if v_license.requires_documentation and v_media.license_reference is null then
        raise exception 'media_license_documentation_missing' using errcode = '22023';
      end if;
      if v_license.attribution_required and v_media.attribution is null then
        raise exception 'media_attribution_missing' using errcode = '22023';
      end if;
      if v_media.event_match_score < v_settings.min_media_match then
        raise exception 'media_event_mismatch' using errcode = '22023';
      end if;
    end if;

    v_placeholder := v_media.is_placeholder;
  end if;

  select * into v_category from public.ai_news_categories
  where slug = coalesce(v_draft.category_slug, v_event.category_slug);

  select coalesce(string_agg(distinct v.source_domain::text, ', '), '')
  into v_sources
  from public.ai_news_evidence v
  where v.event_id = p_event_id;

  v_body := public.ai_news_compose_body(
    v_draft.title, v_draft.spot, v_draft.body,
    coalesce(v_draft.district, v_event.district),
    coalesce(v_category.name_tr, 'Haber'), v_sources, v_placeholder
  );

  -- Kota, tüm doğrulamalar geçtikten hemen sonra atomik olarak tüketilir.
  if v_mode = 'auto' then
    v_slot := public.ai_news_quota_reserve(v_day, v_settings.daily_auto_limit);
    if v_slot is null then
      raise exception 'quota_exhausted' using errcode = '22023';
    end if;
  else
    insert into public.ai_news_quota_days (day, manual_published)
    values (v_day, 1)
    on conflict (day) do update
      set manual_published = public.ai_news_quota_days.manual_published + 1,
          updated_at = now();
  end if;

  insert into public.posts (author_id, body, visibility, city)
  values (v_publisher.id, v_body, 'public', 'Trabzon')
  returning id into v_post_id;

  if v_media.id is not null then
    insert into public.post_media (
      post_id, storage_path, thumbnail_path, media_type, width, height, sort_order
    ) values (
      v_post_id, v_media.storage_path, v_media.thumbnail_path, 'image',
      v_media.width, v_media.height, 0
    );

    update public.ai_news_media_assets
       set status = 'published'
     where id = v_media.id
       and status = 'approved';
  end if;

  insert into public.ai_news_publications (
    event_id, draft_id, post_id, mode, status, published_at
  ) values (
    p_event_id, v_draft.id, v_post_id, v_mode, 'published', now()
  )
  returning id into v_publication_id;

  update public.ai_news_events
     set published_post_id = v_post_id,
         last_seen_at = now()
   where id = p_event_id;

  perform public.ai_news_event_set_status(p_event_id, 'published');

  update public.ai_news_drafts
     set status = 'published'
   where id = v_draft.id;

  update public.ai_news_review_queue
     set state = 'approved',
         resolved_at = now(),
         resolved_by = coalesce(p_actor, v_publisher.id)
   where event_id = p_event_id and state = 'pending';

  insert into public.ai_news_publication_history (publication_id, action, actor_id, details)
  values (
    v_publication_id,
    case when v_mode = 'auto' then 'auto_published' else 'manual_published' end,
    p_actor,
    jsonb_build_object(
      'post_id', v_post_id,
      'risk_level', v_event.risk_level,
      'quality_score', v_draft.quality_score,
      'quota_slot', v_slot,
      'media_placeholder', v_placeholder,
      'media_license', case when v_media is null then null else v_media.license_code end
    )
  );

  insert into public.ai_news_audit_logs (actor_id, action, target_type, target_id, metadata)
  values (
    p_actor,
    case when v_mode = 'auto' then 'news.auto_publish' else 'news.manual_publish' end,
    'ai_news_event',
    p_event_id::text,
    jsonb_build_object(
      'post_id', v_post_id,
      'publisher', v_publisher.username,
      'risk_level', v_event.risk_level,
      'sources', v_event.independent_sources,
      'primary_source', v_event.primary_source
    )
  );

  v_notified := public.ai_news_notify_followers(v_post_id, p_event_id, v_mode);

  return jsonb_build_object(
    'published', true,
    'already_published', false,
    'post_id', v_post_id,
    'publication_id', v_publication_id,
    'publisher', v_publisher.username,
    'quota_slot', v_slot,
    'notified', v_notified,
    'media_placeholder', v_placeholder
  );
end;
$$;

revoke all on function public.ai_news_publish_event(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.ai_news_publish_event(uuid, text, uuid) to service_role;

commit;
