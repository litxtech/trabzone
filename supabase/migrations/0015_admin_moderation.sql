-- 0015: Admin moderation for social content, categories and orders
--
-- Every function re-checks the staff role server-side; the mobile UI hiding a
-- button is never the security boundary.

set search_path = public, extensions;

create or replace function public.tz_require_moderator()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
begin
  if not (public.has_role('moderator') or public.is_admin()) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

revoke all on function public.tz_require_moderator() from public, anon;
grant execute on function public.tz_require_moderator() to authenticated, service_role;

create or replace function public.tz_log_admin_action(
  p_actor    uuid,
  p_action   text,
  p_label    text,
  p_target   text,
  p_target_id text,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.moderation_actions (admin_id, target_type, target_id, action, metadata_safe)
  values (p_actor, p_target, p_target_id, p_action, coalesce(p_metadata, '{}'::jsonb));

  insert into public.admin_audit_logs (
    actor_admin_id, action_code, action_label_tr, target_type, target_id, metadata_safe
  )
  values (p_actor, p_action, p_label, p_target, p_target_id, coalesce(p_metadata, '{}'::jsonb));
end;
$$;

revoke all on function public.tz_log_admin_action(uuid, text, text, text, text, jsonb)
  from public, anon, authenticated;

create or replace function public.admin_social_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.tz_require_moderator();

  return jsonb_build_object(
    'users', (select count(*) from public.profiles where account_status = 'active'),
    'posts', (select count(*) from public.posts),
    'comments', (select count(*) from public.post_comments),
    'stories', (select count(*) from public.stories where expires_at > now()),
    'messages', (select count(*) from public.messages where deleted_at is null),
    'listings', (select count(*) from public.marketplace_listings where status = 'active'),
    'orders', (select count(*) from public.marketplace_orders),
    'open_orders', (
      select count(*) from public.marketplace_orders
      where status in ('requested', 'confirmed', 'shipped')
    ),
    'open_reports', (
      select count(*) from public.user_reports
      where status_code in ('received', 'under_review')
    ),
    'hidden_posts', (
      select count(*) from public.posts where moderation_status <> 'visible'
    )
  );
end;
$$;

revoke all on function public.admin_social_stats() from public, anon;
grant execute on function public.admin_social_stats() to authenticated;

create or replace function public.admin_content_list(
  p_kind   text default 'post',
  p_query  text default null,
  p_limit  integer default 30,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_kind   text := coalesce(nullif(trim(p_kind), ''), 'post');
  v_query  text := nullif(trim(coalesce(p_query, '')), '');
  v_limit  integer := least(greatest(coalesce(p_limit, 30), 1), 60);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  perform public.tz_require_moderator();

  if v_kind = 'post' then
    return jsonb_build_object(
      'items', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'kind', 'post',
              'id', p.id,
              'title', left(coalesce(p.body, 'Medya gönderisi'), 120),
              'moderation_status', p.moderation_status,
              'created_at', p.created_at,
              'owner_id', p.author_id,
              'owner_username', pr.username,
              'owner_name', trim(concat_ws(' ', pr.first_name, pr.last_name)),
              'like_count', p.like_count,
              'comment_count', p.comment_count,
              'report_count', (
                select count(*) from public.user_reports r
                where r.target_type = 'post' and r.target_id = p.id::text
                  and r.status_code in ('received', 'under_review')
              )
            )
            order by p.created_at desc
          )
          from (
            select * from public.posts
            where v_query is null or coalesce(body, '') ilike '%' || v_query || '%'
            order by created_at desc
            limit v_limit offset v_offset
          ) p
            join public.profiles pr on pr.id = p.author_id
        ),
        '[]'::jsonb
      )
    );
  end if;

  if v_kind = 'listing' then
    return jsonb_build_object(
      'items', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'kind', 'listing',
              'id', l.id,
              'title', l.title,
              'moderation_status', l.moderation_status,
              'status', l.status,
              'price_cents', l.price_cents,
              'created_at', l.created_at,
              'owner_id', l.seller_id,
              'owner_username', pr.username,
              'owner_name', trim(concat_ws(' ', pr.first_name, pr.last_name)),
              'report_count', (
                select count(*) from public.user_reports r
                where r.target_type = 'other' and r.target_id = l.id::text
                  and r.status_code in ('received', 'under_review')
              )
            )
            order by l.created_at desc
          )
          from (
            select * from public.marketplace_listings
            where v_query is null or title ilike '%' || v_query || '%'
            order by created_at desc
            limit v_limit offset v_offset
          ) l
            join public.profiles pr on pr.id = l.seller_id
        ),
        '[]'::jsonb
      )
    );
  end if;

  if v_kind = 'story' then
    return jsonb_build_object(
      'items', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'kind', 'story',
              'id', s.id,
              'title', left(coalesce(s.caption, 'Hikâye'), 120),
              'moderation_status', s.moderation_status,
              'created_at', s.created_at,
              'expires_at', s.expires_at,
              'owner_id', s.author_id,
              'owner_username', pr.username,
              'owner_name', trim(concat_ws(' ', pr.first_name, pr.last_name)),
              'report_count', (
                select count(*) from public.user_reports r
                where r.target_type = 'story' and r.target_id = s.id::text
                  and r.status_code in ('received', 'under_review')
              )
            )
            order by s.created_at desc
          )
          from (
            select * from public.stories
            order by created_at desc
            limit v_limit offset v_offset
          ) s
            join public.profiles pr on pr.id = s.author_id
        ),
        '[]'::jsonb
      )
    );
  end if;

  raise exception 'invalid_kind' using errcode = '22023';
end;
$$;

revoke all on function public.admin_content_list(text, text, integer, integer) from public, anon;
grant execute on function public.admin_content_list(text, text, integer, integer) to authenticated;

create or replace function public.admin_content_moderate(
  p_kind   text,
  p_id     uuid,
  p_action text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := public.tz_require_moderator();
  v_kind     text := coalesce(nullif(trim(p_kind), ''), '');
  v_action   text := coalesce(nullif(trim(p_action), ''), '');
  v_status   text;
  v_owner    uuid;
  v_title    text;
begin
  if v_action not in ('hide', 'restore', 'remove') then
    raise exception 'invalid_action' using errcode = '22023';
  end if;

  v_status := case v_action
    when 'hide' then 'hidden'
    when 'restore' then 'visible'
    else 'removed'
  end;

  if v_kind = 'post' then
    select author_id into v_owner from public.posts where id = p_id;
    if v_owner is null then
      raise exception 'content_not_found' using errcode = '22023';
    end if;
    update public.posts set moderation_status = v_status where id = p_id;
    v_title := 'Gönderi';
  elsif v_kind = 'listing' then
    select seller_id into v_owner from public.marketplace_listings where id = p_id;
    if v_owner is null then
      raise exception 'content_not_found' using errcode = '22023';
    end if;
    update public.marketplace_listings
       set moderation_status = v_status,
           status = case when v_status = 'removed' then 'removed' else status end
     where id = p_id;
    v_title := 'İlan';
  elsif v_kind = 'story' then
    select author_id into v_owner from public.stories where id = p_id;
    if v_owner is null then
      raise exception 'content_not_found' using errcode = '22023';
    end if;
    update public.stories set moderation_status = v_status where id = p_id;
    v_title := 'Hikâye';
  else
    raise exception 'invalid_kind' using errcode = '22023';
  end if;

  perform public.tz_log_admin_action(
    v_uid, 'content.' || v_action, v_title || ' moderasyonu', v_kind, p_id::text,
    jsonb_build_object('reason', left(coalesce(p_reason, ''), 400), 'status', v_status)
  );

  perform public.tz_notify(
    v_owner, v_uid, 'security',
    case v_action
      when 'restore' then 'İçeriğin yeniden yayınlandı'
      when 'hide' then 'İçeriğin geçici olarak gizlendi'
      else 'İçeriğin kaldırıldı'
    end,
    coalesce(nullif(trim(p_reason), ''), 'Topluluk kuralları gereği işlem uygulandı.'),
    v_kind, p_id::text, '/notifications'
  );

  return jsonb_build_object('id', p_id, 'kind', v_kind, 'moderation_status', v_status);
end;
$$;

revoke all on function public.admin_content_moderate(text, uuid, text, text) from public, anon;
grant execute on function public.admin_content_moderate(text, uuid, text, text) to authenticated;

create or replace function public.admin_orders_list(
  p_status text default null,
  p_query  text default null,
  p_limit  integer default 30,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_status text := nullif(trim(coalesce(p_status, '')), '');
  v_query  text := nullif(trim(coalesce(p_query, '')), '');
  v_limit  integer := least(greatest(coalesce(p_limit, 30), 1), 60);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  perform public.tz_require_moderator();

  return jsonb_build_object(
    'items', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', o.id,
            'order_no', o.order_no,
            'status', o.status,
            'total_cents', o.total_cents,
            'payment_status', o.payment_status,
            'created_at', o.created_at,
            'buyer_username', bp.username,
            'seller_username', sp.username,
            'item_count', (select count(*) from public.marketplace_order_items i where i.order_id = o.id),
            'first_item', (
              select i.title_snapshot from public.marketplace_order_items i
              where i.order_id = o.id order by i.id limit 1
            )
          )
          order by o.created_at desc
        )
        from (
          select * from public.marketplace_orders
          where (v_status is null or status = v_status)
            and (v_query is null or order_no ilike '%' || v_query || '%')
          order by created_at desc
          limit v_limit offset v_offset
        ) o
          join public.profiles bp on bp.id = o.buyer_id
          join public.profiles sp on sp.id = o.seller_id
      ),
      '[]'::jsonb
    )
  );
end;
$$;

revoke all on function public.admin_orders_list(text, text, integer, integer) from public, anon;
grant execute on function public.admin_orders_list(text, text, integer, integer) to authenticated;

create or replace function public.admin_category_upsert(
  p_id        uuid default null,
  p_parent_id uuid default null,
  p_slug      text default null,
  p_name      text default null,
  p_icon      text default null,
  p_sort      integer default 0,
  p_active    boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := public.tz_require_moderator();
  v_slug text := lower(trim(coalesce(p_slug, '')));
  v_name text := nullif(trim(coalesce(p_name, '')), '');
  v_id   uuid := p_id;
begin
  if v_name is null or char_length(v_name) < 2 or char_length(v_name) > 60 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;

  if v_slug !~ '^[a-z0-9-]{2,40}$' then
    raise exception 'invalid_slug' using errcode = '22023';
  end if;

  if p_parent_id is not null and not exists (
    select 1 from public.marketplace_categories c where c.id = p_parent_id
  ) then
    raise exception 'invalid_parent' using errcode = '22023';
  end if;

  if v_id is null then
    insert into public.marketplace_categories (parent_id, slug, name, icon, sort_order, is_active)
    values (p_parent_id, v_slug, v_name, p_icon, coalesce(p_sort, 0), coalesce(p_active, true))
    returning id into v_id;
  else
    update public.marketplace_categories c
       set parent_id = p_parent_id,
           slug = v_slug,
           name = v_name,
           icon = coalesce(p_icon, c.icon),
           sort_order = coalesce(p_sort, c.sort_order),
           is_active = coalesce(p_active, c.is_active)
     where c.id = v_id;

    if not found then
      raise exception 'category_not_found' using errcode = '22023';
    end if;
  end if;

  perform public.tz_log_admin_action(
    v_uid, 'category.upsert', 'Kategori güncellendi', 'category', v_id::text,
    jsonb_build_object('slug', v_slug, 'name', v_name)
  );

  return jsonb_build_object('id', v_id);
end;
$$;

revoke all on function public.admin_category_upsert(uuid, uuid, text, text, text, integer, boolean)
  from public, anon;
grant execute on function public.admin_category_upsert(uuid, uuid, text, text, text, integer, boolean)
  to authenticated;

create or replace function public.admin_category_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_moderator();
begin
  update public.marketplace_categories c
     set is_active = false
   where c.id = p_id;

  if not found then
    raise exception 'category_not_found' using errcode = '22023';
  end if;

  perform public.tz_log_admin_action(
    v_uid, 'category.deactivate', 'Kategori devre dışı', 'category', p_id::text, '{}'::jsonb
  );
end;
$$;

revoke all on function public.admin_category_delete(uuid) from public, anon;
grant execute on function public.admin_category_delete(uuid) to authenticated;
