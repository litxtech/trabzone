-- 0143: user_reports.target_id metin kolonunun uuid ile karşılaştırılması.

-- 0139'daki yönetici okuma fonksiyonları, rapor hedef kimliğini (text) doğrudan
-- live_news.post_id (uuid) ile karşılaştırıyordu. PostgreSQL'de text = uuid
-- operatörü olmadığı için "Vatandaş Haber Havuzu" ve rapor filtresi hata
-- veriyordu. Karşılaştırmaları açıkça metne çeviriyoruz.

begin;

create or replace function public.admin_live_news_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('live_news.view', false);
begin
  return jsonb_build_object(
    'total', (select count(*) from public.live_news),
    'pending', (select count(*) from public.live_news where moderation_status = 'pending'),
    'visible', (select count(*) from public.live_news where moderation_status = 'visible'),
    'verified', (select count(*) from public.live_news where verification_status = 'verified'),
    'newsroom', (select count(*) from public.live_news where newsroom_state in ('pool', 'reviewing', 'newsroom')),
    'reported', (
      select count(distinct ln.post_id)
      from public.live_news ln
      join public.user_reports ur
        on ur.target_type = 'post'
       and ur.target_id = ln.post_id::text
       and ur.status_code in ('received', 'under_review')
    ),
    'today', (
      select count(*) from public.live_news
      where created_at >= (
        ((now() at time zone 'Europe/Istanbul')::date)::timestamp
          at time zone 'Europe/Istanbul'
      )
    ),
    'views', (
      select coalesce(sum(c.unique_views), 0)
      from public.content_view_counters c
      join public.live_news ln on ln.post_id = c.content_id
      where c.content_type = 'post'
    )
  );
end;
$$;

revoke all on function public.admin_live_news_stats() from public, anon;
grant execute on function public.admin_live_news_stats() to authenticated;

create or replace function public.admin_live_news_list(
  p_state    text default 'all',
  p_district text default null,
  p_category text default null,
  p_query    text default null,
  p_limit    integer default 20,
  p_offset   integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_admin    uuid := public.tz_admin_require('live_news.view', false);
  v_state    text := lower(btrim(coalesce(p_state, 'all')));
  v_district text := nullif(btrim(coalesce(p_district, '')), '');
  v_category text := nullif(lower(btrim(coalesce(p_category, ''))), '');
  v_query    text := nullif(lower(btrim(coalesce(p_query, ''))), '');
  v_limit    integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_offset   integer := greatest(coalesce(p_offset, 0), 0);
  v_total    bigint;
begin
  if v_state not in (
    'all', 'pending', 'visible', 'hidden', 'removed', 'reviewing',
    'verified', 'unverified', 'reported', 'newsroom'
  ) then
    raise exception 'invalid_state' using errcode = '22023';
  end if;

  select count(*) into v_total
  from public.live_news ln
    join public.profiles pr on pr.id = ln.author_id
  where (v_state <> 'pending' or ln.moderation_status = 'pending')
    and (v_state <> 'visible' or ln.moderation_status = 'visible')
    and (v_state <> 'hidden' or ln.moderation_status = 'hidden')
    and (v_state <> 'removed' or ln.moderation_status = 'removed')
    and (v_state <> 'reviewing' or ln.verification_status = 'reviewing')
    and (v_state <> 'verified' or ln.verification_status = 'verified')
    and (v_state <> 'unverified' or ln.verification_status in ('unverified', 'citizen'))
    and (v_state <> 'newsroom' or ln.newsroom_state in ('pool', 'reviewing', 'newsroom'))
    and (v_state <> 'reported' or exists (
      select 1 from public.user_reports ur
      where ur.target_type = 'post' and ur.target_id = ln.post_id::text
        and ur.status_code in ('received', 'under_review')
    ))
    and (v_district is null or ln.district = v_district)
    and (v_category is null or ln.category = v_category)
    and (
      v_query is null
      or lower(ln.title) like '%' || v_query || '%'
      or lower(coalesce(ln.summary, '')) like '%' || v_query || '%'
      or lower(pr.username) like '%' || v_query || '%'
    );

  return jsonb_build_object(
    'total', v_total,
    'items', coalesce(
      (
        select jsonb_agg(item order by created_at desc)
        from (
          select
            jsonb_build_object(
              'post_id', ln.post_id,
              'canonical_id', ln.canonical_id,
              'title', ln.title,
              'summary', ln.summary,
              'category', ln.category,
              'district', ln.district,
              'media_kind', ln.media_kind,
              'verification_status', ln.verification_status,
              'verification_note', ln.verification_note,
              'moderation_status', ln.moderation_status,
              'risk_level', ln.risk_level,
              'risk_flags', ln.risk_flags,
              'reports_count', (
                select count(*) from public.user_reports ur
                where ur.target_type = 'post' and ur.target_id = ln.post_id::text
                  and ur.status_code in ('received', 'under_review')
              ),
              'view_count', coalesce(c.unique_views, 0),
              'like_count', p.like_count,
              'comment_count', p.comment_count,
              'share_count', p.share_count,
              'newsroom_state', ln.newsroom_state,
              'usage_consent', ln.usage_consent,
              'author_id', ln.author_id,
              'author_username', pr.username,
              'author_name', trim(coalesce(pr.first_name, '') || ' ' || coalesce(pr.last_name, '')),
              'author_avatar_path', pr.avatar_path,
              'media_path', (
                select m.storage_path from public.post_media m
                where m.post_id = ln.post_id order by m.sort_order limit 1
              ),
              'media_type', (
                select m.media_type from public.post_media m
                where m.post_id = ln.post_id order by m.sort_order limit 1
              ),
              'created_at', ln.created_at,
              'published_at', ln.published_at
            ) as item,
            ln.created_at
          from public.live_news ln
            join public.profiles pr on pr.id = ln.author_id
            join public.posts p on p.id = ln.post_id
            left join public.content_view_counters c
              on c.content_type = 'post' and c.content_id = ln.post_id
          where (v_state <> 'pending' or ln.moderation_status = 'pending')
            and (v_state <> 'visible' or ln.moderation_status = 'visible')
            and (v_state <> 'hidden' or ln.moderation_status = 'hidden')
            and (v_state <> 'removed' or ln.moderation_status = 'removed')
            and (v_state <> 'reviewing' or ln.verification_status = 'reviewing')
            and (v_state <> 'verified' or ln.verification_status = 'verified')
            and (v_state <> 'unverified' or ln.verification_status in ('unverified', 'citizen'))
            and (v_state <> 'newsroom' or ln.newsroom_state in ('pool', 'reviewing', 'newsroom'))
            and (v_state <> 'reported' or exists (
              select 1 from public.user_reports ur
              where ur.target_type = 'post' and ur.target_id = ln.post_id::text
                and ur.status_code in ('received', 'under_review')
            ))
            and (v_district is null or ln.district = v_district)
            and (v_category is null or ln.category = v_category)
            and (
              v_query is null
              or lower(ln.title) like '%' || v_query || '%'
              or lower(coalesce(ln.summary, '')) like '%' || v_query || '%'
              or lower(pr.username) like '%' || v_query || '%'
            )
          order by ln.created_at desc
          limit v_limit offset v_offset
        ) x
      ),
      '[]'::jsonb
    )
  );
end;
$$;

revoke all on function public.admin_live_news_list(text, text, text, text, integer, integer)
  from public, anon;
grant execute on function public.admin_live_news_list(text, text, text, text, integer, integer)
  to authenticated;

create or replace function public.admin_live_news_detail(p_post_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('live_news.view', false);
  v_row public.live_news%rowtype;
begin
  select * into v_row from public.live_news where post_id = p_post_id;
  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'post', public.tz_post_json(p_post_id, v_admin),
    'live_news', public.tz_live_news_brief(p_post_id, v_admin) || jsonb_build_object(
      'source_note', v_row.source_note,
      'editorial_note', v_row.editorial_note,
      'moderation_reason', v_row.moderation_reason,
      'attribution', v_row.attribution,
      'verified_by', v_row.verified_by,
      'reports', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', ur.id,
          'report_no', ur.report_no,
          'reason', ur.reason,
          'status_code', ur.status_code,
          'created_at', ur.created_at
        ) order by ur.created_at desc), '[]'::jsonb)
        from public.user_reports ur
        where ur.target_type = 'post' and ur.target_id = p_post_id::text
          and ur.status_code in ('received', 'under_review')
      ),
      'history', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', a.id,
          'action_code', a.action_code,
          'action_label', a.action_label_tr,
          'outcome', a.outcome,
          'metadata', a.metadata_safe,
          'created_at', a.created_at
        ) order by a.created_at desc), '[]'::jsonb)
        from (
          select * from public.admin_audit_logs
          where target_type = 'live_news' and target_id = p_post_id::text
          order by created_at desc
          limit 25
        ) a
      )
    )
  );
end;
$$;

revoke all on function public.admin_live_news_detail(uuid) from public, anon;
grant execute on function public.admin_live_news_detail(uuid) to authenticated;

commit;
