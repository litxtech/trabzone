-- 0026: Social feed, Reels, stories, comments and messaging oversight
--
-- Message content is never exposed through a generic list. Only the exact
-- reported message can be opened, with messaging.moderate permission and a
-- mandatory reason that is written to a dedicated access log.

set search_path = public, extensions;

-- Columns required for moderation without deleting user data.
alter table public.post_comments
  add column if not exists moderation_status text not null default 'visible';

alter table public.reel_comments
  add column if not exists moderation_status text not null default 'visible';

alter table public.posts
  add column if not exists comments_locked boolean not null default false,
  add column if not exists is_featured boolean not null default false;

alter table public.reels
  add column if not exists comments_locked boolean not null default false,
  add column if not exists is_featured boolean not null default false;

alter table public.stories
  add column if not exists is_featured boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'post_comments_moderation_check') then
    alter table public.post_comments add constraint post_comments_moderation_check
      check (moderation_status in ('visible', 'hidden', 'removed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'reel_comments_moderation_check') then
    alter table public.reel_comments add constraint reel_comments_moderation_check
      check (moderation_status in ('visible', 'hidden', 'removed'));
  end if;
end $$;

insert into public.app_settings (key, value, description_tr, is_public) values
  ('stories.retention_hours', '24'::jsonb, 'Hikâye saklama süresi (saat). Uygulama bu süreden sonra hikâyeyi yayından kaldırır.', true)
on conflict (key) do nothing;

create index if not exists post_comments_status_created_idx on public.post_comments (moderation_status, created_at desc);
create index if not exists reel_comments_status_created_idx on public.reel_comments (moderation_status, created_at desc);

-- ---------------------------------------------------------------------------
-- 1. Post list
-- ---------------------------------------------------------------------------

create or replace function public.admin_posts_list(
  p_query text default null,
  p_status text default null,
  p_author uuid default null,
  p_featured boolean default null,
  p_limit integer default 20,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_q text := nullif(trim(coalesce(p_query, '')), '');
  v_status text := nullif(trim(coalesce(p_status, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total bigint;
  v_items jsonb;
begin
  perform public.tz_admin_require('content.view');

  select count(*) into v_total
  from public.posts p
  join public.profiles pr on pr.id = p.author_id
  where (v_q is null or coalesce(p.body, '') ilike '%' || v_q || '%'
         or pr.username::text ilike '%' || v_q || '%'
         or pr.display_name ilike '%' || v_q || '%')
    and (v_status is null or p.moderation_status = v_status)
    and (p_author is null or p.author_id = p_author)
    and (p_featured is null or p.is_featured = p_featured);

  select coalesce(jsonb_agg(item order by created_at desc), '[]'::jsonb)
  into v_items
  from (
    select
      p.created_at,
      jsonb_build_object(
        'id', p.id,
        'body', p.body,
        'visibility', p.visibility,
        'city', p.city,
        'moderation_status', p.moderation_status,
        'comments_locked', p.comments_locked,
        'is_featured', p.is_featured,
        'like_count', p.like_count,
        'comment_count', p.comment_count,
        'save_count', p.save_count,
        'share_count', p.share_count,
        'created_at', p.created_at,
        'author_id', p.author_id,
        'author_username', pr.username,
        'author_name', pr.display_name,
        'author_avatar', pr.avatar_path,
        'author_verified', pr.is_verified,
        'media', coalesce((
          select jsonb_agg(jsonb_build_object('path', m.storage_path, 'type', m.media_type) order by m.sort_order)
          from public.post_media m where m.post_id = p.id
        ), '[]'::jsonb),
        'report_count', (
          select count(*) from public.user_reports r
          where r.target_type = 'post' and r.target_id = p.id::text
            and r.status_code in ('received', 'under_review')
        )
      ) as item
    from public.posts p
    join public.profiles pr on pr.id = p.author_id
    where (v_q is null or coalesce(p.body, '') ilike '%' || v_q || '%'
           or pr.username::text ilike '%' || v_q || '%'
           or pr.display_name ilike '%' || v_q || '%')
      and (v_status is null or p.moderation_status = v_status)
      and (p_author is null or p.author_id = p_author)
      and (p_featured is null or p.is_featured = p_featured)
    order by p.created_at desc
    limit v_limit offset v_offset
  ) s;

  return jsonb_build_object('items', v_items, 'total', v_total, 'limit', v_limit, 'offset', v_offset);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Reels list + technical status
-- ---------------------------------------------------------------------------

create or replace function public.admin_reels_list(
  p_query text default null,
  p_status text default null,
  p_moderation text default null,
  p_author uuid default null,
  p_limit integer default 20,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_q text := nullif(trim(coalesce(p_query, '')), '');
  v_status text := nullif(trim(coalesce(p_status, '')), '');
  v_mod text := nullif(trim(coalesce(p_moderation, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total bigint;
  v_items jsonb;
begin
  perform public.tz_admin_require('content.view');

  select count(*) into v_total
  from public.reels r
  join public.profiles pr on pr.id = r.author_id
  where (v_q is null or coalesce(r.caption, '') ilike '%' || v_q || '%'
         or pr.username::text ilike '%' || v_q || '%'
         or pr.display_name ilike '%' || v_q || '%'
         or r.id::text = v_q)
    and (v_status is null or r.status = v_status)
    and (v_mod is null or r.moderation_status = v_mod)
    and (p_author is null or r.author_id = p_author);

  select coalesce(jsonb_agg(item order by created_at desc), '[]'::jsonb)
  into v_items
  from (
    select
      r.created_at,
      jsonb_build_object(
        'id', r.id,
        'caption', r.caption,
        'cover_path', r.cover_path,
        'video_path', r.video_path,
        'duration_ms', r.duration_ms,
        'audio_title', r.audio_title,
        'status', r.status,
        'moderation_status', r.moderation_status,
        'comments_locked', r.comments_locked,
        'is_featured', r.is_featured,
        'view_count', r.view_count,
        'like_count', r.like_count,
        'comment_count', r.comment_count,
        'share_count', r.share_count,
        'created_at', r.created_at,
        'author_id', r.author_id,
        'author_username', pr.username,
        'author_name', pr.display_name,
        'author_avatar', pr.avatar_path,
        'report_count', (
          select count(*) from public.user_reports ur
          where ur.target_type = 'reel' and ur.target_id = r.id::text
            and ur.status_code in ('received', 'under_review')
        )
      ) as item
    from public.reels r
    join public.profiles pr on pr.id = r.author_id
    where (v_q is null or coalesce(r.caption, '') ilike '%' || v_q || '%'
           or pr.username::text ilike '%' || v_q || '%'
           or pr.display_name ilike '%' || v_q || '%'
           or r.id::text = v_q)
      and (v_status is null or r.status = v_status)
      and (v_mod is null or r.moderation_status = v_mod)
      and (p_author is null or r.author_id = p_author)
    order by r.created_at desc
    limit v_limit offset v_offset
  ) s;

  return jsonb_build_object(
    'items', v_items,
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'tech', jsonb_build_object(
      'ready', (select count(*) from public.reels where status = 'ready'),
      'processing', (select count(*) from public.reels where status not in ('ready')),
      'failed_24h', (select count(*) from public.reels where status not in ('ready') and created_at > now() - interval '24 hours')
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Story list
-- ---------------------------------------------------------------------------

create or replace function public.admin_stories_list(
  p_query text default null,
  p_status text default null,
  p_active_only boolean default false,
  p_limit integer default 20,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_q text := nullif(trim(coalesce(p_query, '')), '');
  v_status text := nullif(trim(coalesce(p_status, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total bigint;
  v_items jsonb;
begin
  perform public.tz_admin_require('content.view');

  select count(*) into v_total
  from public.stories s
  join public.profiles pr on pr.id = s.author_id
  where (v_q is null or coalesce(s.caption, '') ilike '%' || v_q || '%'
         or pr.username::text ilike '%' || v_q || '%'
         or pr.display_name ilike '%' || v_q || '%')
    and (v_status is null or s.moderation_status = v_status)
    and (not coalesce(p_active_only, false) or s.expires_at > now());

  select coalesce(jsonb_agg(item order by created_at desc), '[]'::jsonb)
  into v_items
  from (
    select
      s.created_at,
      jsonb_build_object(
        'id', s.id,
        'caption', s.caption,
        'media_path', s.media_path,
        'media_type', s.media_type,
        'moderation_status', s.moderation_status,
        'is_featured', s.is_featured,
        'expires_at', s.expires_at,
        'is_active', s.expires_at > now(),
        'created_at', s.created_at,
        'author_id', s.author_id,
        'author_username', pr.username,
        'author_name', pr.display_name,
        'author_avatar', pr.avatar_path,
        'report_count', (
          select count(*) from public.user_reports ur
          where ur.target_type = 'story' and ur.target_id = s.id::text
            and ur.status_code in ('received', 'under_review')
        )
      ) as item
    from public.stories s
    join public.profiles pr on pr.id = s.author_id
    where (v_q is null or coalesce(s.caption, '') ilike '%' || v_q || '%'
           or pr.username::text ilike '%' || v_q || '%'
           or pr.display_name ilike '%' || v_q || '%')
      and (v_status is null or s.moderation_status = v_status)
      and (not coalesce(p_active_only, false) or s.expires_at > now())
    order by s.created_at desc
    limit v_limit offset v_offset
  ) s;

  return jsonb_build_object(
    'items', v_items,
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'active_count', (select count(*) from public.stories where expires_at > now()),
    'retention_hours', coalesce((
      select (value #>> '{}')::int from public.app_settings where key = 'stories.retention_hours'
    ), 24)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Comment list
-- ---------------------------------------------------------------------------

create or replace function public.admin_comments_list(
  p_query text default null,
  p_status text default null,
  p_limit integer default 20,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_q text := nullif(trim(coalesce(p_query, '')), '');
  v_status text := nullif(trim(coalesce(p_status, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total bigint;
  v_items jsonb;
begin
  perform public.tz_admin_require('content.view');

  select count(*) into v_total
  from (
    select c.id, c.body, c.moderation_status, pr.username, pr.display_name
    from public.post_comments c join public.profiles pr on pr.id = c.author_id
    union all
    select c.id, c.body, c.moderation_status, pr.username, pr.display_name
    from public.reel_comments c join public.profiles pr on pr.id = c.author_id
  ) x
  where (v_q is null or x.body ilike '%' || v_q || '%'
         or x.username::text ilike '%' || v_q || '%'
         or x.display_name ilike '%' || v_q || '%')
    and (v_status is null or x.moderation_status = v_status);

  select coalesce(jsonb_agg(item order by created_at desc), '[]'::jsonb)
  into v_items
  from (
    select
      c.created_at,
      jsonb_build_object(
        'id', c.id,
        'kind', 'post_comment',
        'body', c.body,
        'moderation_status', c.moderation_status,
        'created_at', c.created_at,
        'author_id', c.author_id,
        'author_username', pr.username,
        'author_name', pr.display_name,
        'parent_id', c.post_id,
        'parent_label', 'Gönderi yorumu',
        'report_count', (
          select count(*) from public.user_reports ur
          where ur.target_type = 'comment' and ur.target_id = c.id::text
            and ur.status_code in ('received', 'under_review')
        )
      ) as item
    from public.post_comments c
    join public.profiles pr on pr.id = c.author_id
    where (v_q is null or c.body ilike '%' || v_q || '%'
           or pr.username::text ilike '%' || v_q || '%'
           or pr.display_name ilike '%' || v_q || '%')
      and (v_status is null or c.moderation_status = v_status)
    union all
    select
      c.created_at,
      jsonb_build_object(
        'id', c.id,
        'kind', 'reel_comment',
        'body', c.body,
        'moderation_status', c.moderation_status,
        'created_at', c.created_at,
        'author_id', c.author_id,
        'author_username', pr.username,
        'author_name', pr.display_name,
        'parent_id', c.reel_id,
        'parent_label', 'Reels yorumu',
        'report_count', (
          select count(*) from public.user_reports ur
          where ur.target_type = 'comment' and ur.target_id = c.id::text
            and ur.status_code in ('received', 'under_review')
        )
      ) as item
    from public.reel_comments c
    join public.profiles pr on pr.id = c.author_id
    where (v_q is null or c.body ilike '%' || v_q || '%'
           or pr.username::text ilike '%' || v_q || '%'
           or pr.display_name ilike '%' || v_q || '%')
      and (v_status is null or c.moderation_status = v_status)
    order by created_at desc
    limit v_limit offset v_offset
  ) s;

  return jsonb_build_object('items', v_items, 'total', v_total, 'limit', v_limit, 'offset', v_offset);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Unified content moderation
-- ---------------------------------------------------------------------------

create or replace function public.admin_content_action(
  p_kind text,
  p_id text,
  p_action text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_admin_require('content.action', true);
  v_kind text := lower(trim(coalesce(p_kind, '')));
  v_action text := lower(trim(coalesce(p_action, '')));
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_id uuid;
  v_owner uuid;
  v_old text;
  v_new text;
  v_label text;
  v_title text;
  v_entity text;
begin
  if v_action not in ('hide', 'restore', 'remove', 'lock_comments', 'unlock_comments', 'feature', 'unfeature') then
    raise exception 'invalid_action' using errcode = '22023';
  end if;

  if v_action in ('hide', 'remove') and (v_reason is null or char_length(v_reason) < 3) then
    raise exception 'reason_required' using errcode = '22023';
  end if;

  begin
    v_id := p_id::uuid;
  exception when others then
    raise exception 'invalid_id' using errcode = '22023';
  end;

  if v_kind = 'post' then
    select author_id, moderation_status into v_owner, v_old
    from public.posts where id = v_id for update;
    if v_owner is null then raise exception 'content_not_found' using errcode = '22023'; end if;
    v_label := 'Gönderi'; v_entity := 'post';

    if v_action in ('hide', 'remove', 'restore') then
      v_new := case v_action when 'hide' then 'hidden' when 'remove' then 'removed' else 'visible' end;
      update public.posts set moderation_status = v_new, updated_at = now() where id = v_id;
    elsif v_action in ('lock_comments', 'unlock_comments') then
      update public.posts set comments_locked = (v_action = 'lock_comments'), updated_at = now() where id = v_id;
      v_new := v_action;
    else
      update public.posts set is_featured = (v_action = 'feature'), updated_at = now() where id = v_id;
      v_new := v_action;
    end if;

  elsif v_kind = 'reel' then
    select author_id, moderation_status into v_owner, v_old
    from public.reels where id = v_id for update;
    if v_owner is null then raise exception 'content_not_found' using errcode = '22023'; end if;
    v_label := 'Reels'; v_entity := 'reel';

    if v_action in ('hide', 'remove', 'restore') then
      v_new := case v_action when 'hide' then 'hidden' when 'remove' then 'removed' else 'visible' end;
      update public.reels set moderation_status = v_new, updated_at = now() where id = v_id;
    elsif v_action in ('lock_comments', 'unlock_comments') then
      update public.reels set comments_locked = (v_action = 'lock_comments'), updated_at = now() where id = v_id;
      v_new := v_action;
    else
      update public.reels set is_featured = (v_action = 'feature'), updated_at = now() where id = v_id;
      v_new := v_action;
    end if;

  elsif v_kind = 'story' then
    select author_id, moderation_status into v_owner, v_old
    from public.stories where id = v_id for update;
    if v_owner is null then raise exception 'content_not_found' using errcode = '22023'; end if;
    v_label := 'Hikâye'; v_entity := 'story';

    if v_action in ('hide', 'remove', 'restore') then
      v_new := case v_action when 'hide' then 'hidden' when 'remove' then 'removed' else 'visible' end;
      update public.stories set moderation_status = v_new where id = v_id;
    elsif v_action = 'feature' or v_action = 'unfeature' then
      update public.stories set is_featured = (v_action = 'feature') where id = v_id;
      v_new := v_action;
    else
      raise exception 'invalid_action' using errcode = '22023';
    end if;

  elsif v_kind = 'comment' then
    select author_id, moderation_status into v_owner, v_old
    from public.post_comments where id = v_id for update;
    if v_owner is null then
      select author_id, moderation_status into v_owner, v_old
      from public.reel_comments where id = v_id for update;
    end if;
    if v_owner is null then raise exception 'content_not_found' using errcode = '22023'; end if;
    v_label := 'Yorum'; v_entity := 'comment';

    if v_action not in ('hide', 'remove', 'restore') then
      raise exception 'invalid_action' using errcode = '22023';
    end if;
    v_new := case v_action when 'hide' then 'hidden' when 'remove' then 'removed' else 'visible' end;
    update public.post_comments set moderation_status = v_new, updated_at = now() where id = v_id;
    update public.reel_comments set moderation_status = v_new, updated_at = now() where id = v_id;
  else
    raise exception 'invalid_kind' using errcode = '22023';
  end if;

  perform public.tz_notify(
    v_owner, v_uid, 'security',
    case v_action
      when 'hide' then v_label || ' geçici olarak gizlendi'
      when 'remove' then v_label || ' kaldırıldı'
      when 'restore' then v_label || ' yeniden yayınlandı'
      when 'lock_comments' then 'Yorumlar kapatıldı'
      when 'unlock_comments' then 'Yorumlar yeniden açıldı'
      when 'feature' then v_label || ' öne çıkarıldı'
      else v_label || ' öne çıkarma kaldırıldı'
    end,
    coalesce(v_reason, 'Moderasyon kuralları gereği işlem uygulandı.'),
    v_entity, p_id, '/notifications'
  );

  perform public.tz_admin_audit(
    'content.' || v_entity || '.' || v_action,
    v_label || ' moderasyonu: ' || v_action,
    v_entity,
    p_id,
    jsonb_build_object('old', v_old, 'new', v_new, 'reason', left(coalesce(v_reason, ''), 400))
  );

  return jsonb_build_object('id', p_id, 'kind', v_kind, 'action', v_action, 'status', v_new);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Messaging overview
-- ---------------------------------------------------------------------------

create or replace function public.admin_messaging_overview(
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_from timestamptz := coalesce(p_from, now() - interval '30 days');
  v_to timestamptz := coalesce(p_to, now());
begin
  perform public.tz_admin_require('messaging.view');

  return jsonb_build_object(
    'period', jsonb_build_object('from', v_from, 'to', v_to),
    'stats', jsonb_build_object(
      'messages_period', (select count(*) from public.messages where created_at >= v_from and created_at < v_to and deleted_at is null),
      'messages_today', (select count(*) from public.messages where created_at >= current_date and deleted_at is null),
      'active_conversations', (select count(distinct conversation_id) from public.messages where created_at >= v_from and created_at < v_to),
      'media_messages', (select count(*) from public.messages where created_at >= v_from and created_at < v_to and media_path is not null),
      'undelivered', (
        select count(*) from public.messages m
        where m.created_at >= v_from and m.created_at < v_to
          and m.created_at < now() - interval '5 minutes'
          and not exists (select 1 from public.message_receipts r where r.message_id = m.id and r.delivered_at is not null)
      ),
      'avg_delivery_seconds', coalesce((
        select round(avg(extract(epoch from (r.delivered_at - m.created_at)))::numeric, 1)
        from public.message_receipts r
        join public.messages m on m.id = r.message_id
        where r.delivered_at is not null and m.created_at >= v_from and m.created_at < v_to
      ), 0),
      'calls_period', (select count(*) from public.call_sessions where created_at >= v_from and created_at < v_to),
      'failed_calls', (select count(*) from public.call_sessions where created_at >= v_from and created_at < v_to and status in ('missed', 'failed', 'declined')),
      'blocked_events', (select count(*) from public.user_blocks where created_at >= v_from and created_at < v_to),
      'open_message_reports', (
        select count(*) from public.user_reports
        where status_code in ('received', 'under_review')
          and (target_type in ('message', 'call') or reason_category in ('spam', 'harassment', 'scam'))
      ),
      'upload_errors_24h', (
        select count(*) from public.system_errors
        where occurred_at > now() - interval '24 hours'
          and (source ilike '%message%' or source ilike '%upload%' or error_code ilike '%upload%')
      ),
      'notifications_24h', (select count(*) from public.notifications where created_at > now() - interval '24 hours')
    ),
    'series', coalesce((
      select jsonb_agg(jsonb_build_object('date', d.day, 'messages', coalesce(m.c, 0)) order by d.day)
      from (select generate_series(v_from::date, v_to::date, interval '1 day')::date as day) d
      left join (
        select created_at::date as day, count(*) as c
        from public.messages
        where created_at >= v_from and created_at < v_to and deleted_at is null
        group by 1
      ) m on m.day = d.day
    ), '[]'::jsonb),
    'report_reasons', coalesce((
      select jsonb_agg(jsonb_build_object('label', x.reason_category, 'value', x.value) order by x.value desc)
      from (
        select reason_category, count(*) as value
        from public.user_reports
        where created_at >= v_from and created_at < v_to
          and (target_type in ('message', 'call') or reason_category in ('spam', 'harassment', 'scam'))
        group by reason_category
        order by 2 desc
        limit 10
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Reported conversations/messages (metadata only)
-- ---------------------------------------------------------------------------

create or replace function public.admin_message_reports(
  p_queue text default 'open',
  p_limit integer default 20,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_where text;
  v_total bigint;
  v_items jsonb;
begin
  perform public.tz_admin_require('messaging.view');

  v_where := case coalesce(p_queue, 'open')
    when 'open' then 'r.status_code in (''received'', ''under_review'')'
    when 'resolved' then 'r.status_code in (''action_taken'', ''resolved'', ''dismissed'', ''closed'')'
    else 'true'
  end;

  execute format('select count(*) from public.user_reports r
                  where %s and (r.target_type in (''message'', ''call'')
                     or r.reason_category in (''spam'', ''harassment'', ''scam''))', v_where)
  into v_total;

  execute format('
    select coalesce(jsonb_agg(item order by created_at desc), ''[]''::jsonb)
    from (
      select
        r.created_at,
        jsonb_build_object(
          ''id'', r.id,
          ''report_no'', r.report_no,
          ''target_type'', r.target_type,
          ''target_id'', r.target_id,
          ''reason_category'', r.reason_category,
          ''description'', left(coalesce(r.description, ''''), 300),
          ''priority'', r.priority,
          ''status_code'', r.status_code,
          ''is_child_safety'', r.is_child_safety,
          ''created_at'', r.created_at,
          ''sla_due_at'', r.sla_due_at,
          ''assigned_to'', r.assigned_to,
          ''assignee_name'', (select p.display_name from public.profiles p where p.id = r.assigned_to),
          ''reporter_ref'', left(r.reporter_id::text, 8),
          ''has_snapshot'', (r.target_snapshot <> ''{}''::jsonb)
        ) as item
      from public.user_reports r
      where %s and (r.target_type in (''message'', ''call'')
         or r.reason_category in (''spam'', ''harassment'', ''scam''))
      order by
        case r.priority when ''critical'' then 0 when ''high'' then 1 else 2 end,
        r.created_at desc
      limit %s offset %s
    ) s', v_where, v_limit, v_offset)
  into v_items;

  return jsonb_build_object('items', v_items, 'total', v_total, 'limit', v_limit, 'offset', v_offset);
end;
$$;

create or replace function public.admin_message_report_detail(
  p_report_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_admin_require('messaging.moderate', true);
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_report public.user_reports%rowtype;
  v_message jsonb := null;
  v_conversation jsonb := null;
begin
  if v_reason is null or char_length(v_reason) < 3 then
    raise exception 'reason_required' using errcode = '22023';
  end if;

  select * into v_report from public.user_reports where id = p_report_id;
  if not found then
    raise exception 'report_not_found' using errcode = '22023';
  end if;

  -- Only the exact reported message may be read. Conversation history is never
  -- returned, even to a super admin.
  if v_report.target_type = 'message' and v_report.target_id ~ '^[0-9a-f-]{36}$' then
    select jsonb_build_object(
      'id', m.id,
      'conversation_id', m.conversation_id,
      'sender_id', m.sender_id,
      'kind', m.kind,
      'body', left(coalesce(m.body, ''), 4000),
      'media_path', m.media_path,
      'created_at', m.created_at,
      'deleted_at', m.deleted_at
    )
    into v_message
    from public.messages m
    where m.id = v_report.target_id::uuid;

    if v_message is not null then
      select jsonb_build_object(
        'id', c.id,
        'kind', c.kind,
        'title', c.title,
        'member_count', (select count(*) from public.conversation_members cm where cm.conversation_id = c.id)
      )
      into v_conversation
      from public.conversations c
      where c.id = (v_message ->> 'conversation_id')::uuid;
    end if;
  end if;

  insert into public.message_moderation_access_logs (report_id, admin_id, action, reason)
  values (p_report_id, v_uid, 'view_reported_message', left(v_reason, 400));

  perform public.tz_admin_audit(
    'messaging.reported_message_viewed',
    'Rapor kapsamındaki mesaj incelendi',
    'user_report',
    p_report_id::text,
    jsonb_build_object('reason', left(v_reason, 400))
  );

  return jsonb_build_object(
    'report', jsonb_build_object(
      'id', v_report.id,
      'report_no', v_report.report_no,
      'target_type', v_report.target_type,
      'target_id', v_report.target_id,
      'reason_category', v_report.reason_category,
      'description', v_report.description,
      'priority', v_report.priority,
      'status_code', v_report.status_code,
      'is_child_safety', v_report.is_child_safety,
      'created_at', v_report.created_at,
      'snapshot', v_report.target_snapshot
    ),
    'message', v_message,
    'conversation', v_conversation,
    'access_logged', true
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Grants
-- ---------------------------------------------------------------------------

revoke all on function public.admin_posts_list(text, text, uuid, boolean, integer, integer) from public, anon;
grant execute on function public.admin_posts_list(text, text, uuid, boolean, integer, integer) to authenticated;

revoke all on function public.admin_reels_list(text, text, text, uuid, integer, integer) from public, anon;
grant execute on function public.admin_reels_list(text, text, text, uuid, integer, integer) to authenticated;

revoke all on function public.admin_stories_list(text, text, boolean, integer, integer) from public, anon;
grant execute on function public.admin_stories_list(text, text, boolean, integer, integer) to authenticated;

revoke all on function public.admin_comments_list(text, text, integer, integer) from public, anon;
grant execute on function public.admin_comments_list(text, text, integer, integer) to authenticated;

revoke all on function public.admin_content_action(text, text, text, text) from public, anon;
grant execute on function public.admin_content_action(text, text, text, text) to authenticated;

revoke all on function public.admin_messaging_overview(timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_messaging_overview(timestamptz, timestamptz) to authenticated;

revoke all on function public.admin_message_reports(text, integer, integer) from public, anon;
grant execute on function public.admin_message_reports(text, integer, integer) to authenticated;

revoke all on function public.admin_message_report_detail(uuid, text) from public, anon;
grant execute on function public.admin_message_report_detail(uuid, text) to authenticated;
