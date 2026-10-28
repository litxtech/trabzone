-- 0085: Engelleme sertleştirmesi ("premium" engel).
--
-- Hedef: engellenen taraf engelleyene hiçbir kanaldan ulaşamaz.
--   * Profiline, avatarına, bio'suna, takipçi grafiğine erişemez.
--   * Akışta, keşifte, haritada, hikâyede, reels'te görünmez.
--   * Yorum yazamaz/yazdığı yorum görünmez, arayamaz, mesaj gönderemez,
--     eski sohbeti okuyamaz.
--   * Hakkında üretilmiş bildirimler iki taraftan da silinir.
--
-- Engelleyen taraf için mevcut sohbet geçmişi korunur (destek/şikâyet
-- senaryolarında kanıt olarak kalır); yalnızca engellenen taraf erişimini
-- kaybeder.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Yardımcılar
-- ---------------------------------------------------------------------------

-- Karşı taraf beni engelledi mi? (Yönlü: engelleyen değil, engellenen sorar.)
create or replace function public.blocked_by_peer(p_peer uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_peer is not null
     and exists (
       select 1
       from public.user_blocks b
       where b.blocker_id = p_peer
         and b.blocked_id = auth.uid()
     );
$$;

revoke all on function public.blocked_by_peer(uuid) from public, anon;
grant execute on function public.blocked_by_peer(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Profil görünürlüğü: engel varsa satır hiç dönmez.
-- ---------------------------------------------------------------------------
drop policy if exists profiles_select on public.profiles;

create policy profiles_select on public.profiles
  for select to authenticated
  using (
    ((account_status <> 'deleted'::text) or id = auth.uid())
    and (id = auth.uid() or not public.is_blocked(auth.uid(), id))
  );

-- Takip grafiği: engelli bir kullanıcının hiçbir takip kenarı görünmez.
drop policy if exists user_follows_select on public.user_follows;

create policy user_follows_select on public.user_follows
  for select to authenticated
  using (
    not public.is_blocked(auth.uid(), follower_id)
    and not public.is_blocked(auth.uid(), following_id)
  );

-- ---------------------------------------------------------------------------
-- Profil görünümü: engelleyen taraf maskeli satırı görür (engeli kaldırabilsin),
-- engellenen taraf ise profil yokmuş gibi boş yanıt alır.
-- ---------------------------------------------------------------------------
create or replace function public.get_profile_view(p_username text)
returns table(id uuid, username citext, first_name text, last_name text, bio text, city text, district text, website text, avatar_path text, cover_path text, is_verified boolean, followers_count integer, following_count integer, posts_count integer, created_at timestamp with time zone, visibility text, restricted boolean, is_me boolean, i_follow boolean, follows_me boolean, is_friend boolean, friend_request_out uuid, friend_request_in uuid, blocked boolean, blocked_by_me boolean, accepts_friend_requests boolean)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_me        uuid := auth.uid();
  v_target    public.profiles%rowtype;
  v_settings  public.profile_settings%rowtype;
  v_restricted boolean := false;
  v_blocked   boolean := false;
  v_by_me     boolean := false;
  v_i_follow  boolean := false;
  v_follows_me boolean := false;
  v_friends   boolean := false;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  select p.* into v_target
  from public.profiles p
  where p.username = lower(trim(p_username))
  limit 1;

  if not found then
    return;
  end if;

  v_blocked := public.is_blocked(v_me, v_target.id);
  v_by_me := exists (
    select 1 from public.user_blocks b
    where b.blocker_id = v_me and b.blocked_id = v_target.id
  );

  -- Beni engelleyen kişi hakkında hiçbir bilgi verilmez: profil "yok" sayılır.
  -- Böylece engel varlığı bile doğrulanamaz.
  if v_blocked and not v_by_me then
    return;
  end if;

  -- Ayarlar yoksa (olmamali) guvenli varsayilanlarla devam et.
  select s.* into v_settings
  from public.profile_settings s
  where s.user_id = v_target.id;

  if not found then
    v_settings.profile_visibility := 'public';
    v_settings.show_city := true;
    v_settings.show_district := true;
    v_settings.allow_friend_requests := true;
  end if;

  if v_blocked then
    -- Engelleyen taraf: yalnızca "engelledim" bilgisi ve username döner,
    -- böylece arayüzde engeli kaldırma akışı çalışır.
    return query
    select
      v_target.id, v_target.username, null::text, null::text, null::text, null::text,
      null::text, null::text, null::text, null::text, false,
      0, 0, 0, v_target.created_at,
      v_settings.profile_visibility, true, v_target.id = v_me,
      false, false, false, null::uuid, null::uuid, true,
      true,
      false;
    return;
  end if;

  v_i_follow := exists (
    select 1 from public.user_follows f
    where f.follower_id = v_me and f.following_id = v_target.id
  );

  v_follows_me := exists (
    select 1 from public.user_follows f
    where f.follower_id = v_target.id and f.following_id = v_me
  );

  v_friends := public.are_friends(v_me, v_target.id);

  v_restricted :=
    v_target.id <> v_me
    and (
      (v_settings.profile_visibility = 'private' and not v_friends)
      or (v_settings.profile_visibility = 'followers' and not v_i_follow and not v_friends)
    );

  return query
  select
    v_target.id,
    v_target.username,
    v_target.first_name,
    v_target.last_name,
    case when v_restricted then null else v_target.bio end,
    case when v_restricted or not v_settings.show_city then null else v_target.city end,
    case when v_restricted or not v_settings.show_district then null else v_target.district end,
    case when v_restricted then null else v_target.website end,
    v_target.avatar_path,
    case when v_restricted then null else v_target.cover_path end,
    v_target.is_verified,
    v_target.followers_count,
    v_target.following_count,
    v_target.posts_count,
    v_target.created_at,
    v_settings.profile_visibility,
    v_restricted,
    v_target.id = v_me,
    v_i_follow,
    v_follows_me,
    v_friends,
    (
      select r.id from public.friend_requests r
      where r.sender_id = v_me and r.receiver_id = v_target.id and r.status = 'pending'
      limit 1
    ),
    (
      select r.id from public.friend_requests r
      where r.sender_id = v_target.id and r.receiver_id = v_me and r.status = 'pending'
      limit 1
    ),
    false,
    false,
    v_settings.allow_friend_requests;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Engellenen kişiler listesi (engelleyen taraf için).
-- ---------------------------------------------------------------------------
create or replace function public.list_blocked_users(p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_uid    uuid := public.tz_require_uid();
  v_limit  integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  return jsonb_build_object(
    'items', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', p.id,
            'username', p.username,
            'first_name', p.first_name,
            'last_name', p.last_name,
            'avatar_path', p.avatar_path,
            'is_verified', p.is_verified,
            'blocked_at', b.created_at
          )
          order by b.created_at desc
        )
        from (
          select * from public.user_blocks
          where blocker_id = v_uid
          order by created_at desc
          limit v_limit offset v_offset
        ) b
          join public.profiles p on p.id = b.blocked_id
      ),
      '[]'::jsonb
    ),
    'total', (
      select count(*) from public.user_blocks where blocker_id = v_uid
    )
  );
end;
$function$;

revoke all on function public.list_blocked_users(integer, integer) from public, anon;
grant execute on function public.list_blocked_users(integer, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Sohbet: engellenen taraf doğrudan sohbete hiç giremez.
-- Engelleyen taraf geçmişi okumaya devam eder (gönderim zaten chat_send_message
-- içinde ayrıca engellenir).
-- ---------------------------------------------------------------------------
create or replace function public.tz_conversation_guard(p_conversation_id uuid, p_uid uuid)
returns void
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_kind text;
  v_peer uuid;
begin
  if not exists (
    select 1 from public.conversation_members m
    where m.conversation_id = p_conversation_id
      and m.user_id = p_uid
      and m.left_at is null
  ) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;

  select c.kind into v_kind from public.conversations c where c.id = p_conversation_id;

  if v_kind = 'direct' then
    v_peer := public.tz_direct_peer(p_conversation_id, p_uid);
    if public.blocked_by_peer(v_peer) then
      raise exception 'blocked' using errcode = '42501';
    end if;
  end if;
end;
$function$;

-- Tek mesaj okuma da aynı kapıdan geçer.
create or replace function public.chat_message_get(p_message_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_uid  uuid := public.tz_require_uid();
  v_conv uuid;
begin
  select m.conversation_id into v_conv
  from public.messages m
    join public.conversation_members cm
      on cm.conversation_id = m.conversation_id
     and cm.user_id = v_uid
     and cm.left_at is null
  where m.id = p_message_id;

  if v_conv is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  perform public.tz_conversation_guard(v_conv, v_uid);

  return public.tz_message_json(p_message_id, v_uid);
end;
$function$;

create or replace function public.chat_edit_message(p_message_id uuid, p_body text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid  uuid := public.tz_require_uid();
  v_body text := nullif(trim(coalesce(p_body, '')), '');
  v_kind text;
  v_conv uuid;
begin
  if v_body is null or char_length(v_body) > 4000 then
    raise exception 'invalid_body' using errcode = '22023';
  end if;

  select m.kind, m.conversation_id into v_kind, v_conv
  from public.messages m
  where m.id = p_message_id and m.sender_id = v_uid and m.deleted_at is null;

  if v_kind is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  perform public.tz_conversation_guard(v_conv, v_uid);

  if v_kind <> 'text' then
    raise exception 'unsupported_kind' using errcode = '22023';
  end if;

  update public.messages
     set body = v_body, edited_at = now()
   where id = p_message_id;
end;
$function$;

create or replace function public.chat_delete_message(p_message_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid   uuid := public.tz_require_uid();
  v_paths jsonb;
  v_conv  uuid;
begin
  select m.conversation_id into v_conv
  from public.messages m
  where m.id = p_message_id
    and m.sender_id = v_uid
    and m.deleted_at is null
    and m.created_at > now() - interval '48 hours'
  for update;

  if v_conv is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  perform public.tz_conversation_guard(v_conv, v_uid);

  select coalesce(jsonb_agg(mm.storage_path), '[]'::jsonb)
    into v_paths
  from public.message_media mm
  where mm.message_id = p_message_id;

  delete from public.message_media where message_id = p_message_id;

  update public.messages
     set body = null,
         media_path = null,
         media_meta = '{}'::jsonb,
         deleted_at = now()
   where id = p_message_id;

  update public.conversations
     set last_message_preview = 'Mesaj silindi',
         updated_at = now()
   where id = v_conv
     and last_message_preview is not null;

  return jsonb_build_object('media_paths', v_paths);
end;
$function$;

-- ---------------------------------------------------------------------------
-- Aramalar: engellenen kişi çağrı başlatamaz (çağrı zaten sohbet üzerinden).
-- ---------------------------------------------------------------------------
create or replace function public.safety_can_call(p_caller uuid, p_callee uuid)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_policy text;
begin
  if p_caller is null or p_callee is null or p_caller = p_callee then
    return false;
  end if;

  if exists (
    select 1 from public.user_blocks b
    where (b.blocker_id = p_caller and b.blocked_id = p_callee)
       or (b.blocker_id = p_callee and b.blocked_id = p_caller)
  ) then
    return false;
  end if;

  if public.safety_is_child_protected(p_caller) and public.safety_is_child_protected(p_callee) then
    return true;
  end if;

  if public.safety_is_child_protected(p_callee) then
    select s.call_policy into v_policy
    from public.child_protection_settings s where s.user_id = p_callee;

    if coalesce(v_policy, 'friends') = 'nobody' then
      return false;
    end if;

    return exists (
      select 1 from public.user_follows f
      where f.follower_id = p_caller and f.following_id = p_callee
    ) and exists (
      select 1 from public.user_follows f
      where f.follower_id = p_callee and f.following_id = p_caller
    );
  end if;

  return true;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Bildirimler: engellenen kişiden gelen (eski) bildirimler listelenmez.
-- ---------------------------------------------------------------------------
create or replace function public.notifications_list(p_limit integer default 30, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_uid    uuid := public.tz_require_uid();
  v_limit  integer := least(greatest(coalesce(p_limit, 30), 1), 60);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  return jsonb_build_object(
    'items', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', n.id,
            'kind', n.kind,
            'title', n.title,
            'body', n.body,
            'entity_type', n.entity_type,
            'entity_id', n.entity_id,
            'route', n.route,
            'read_at', n.read_at,
            'created_at', n.created_at,
            'actor_id', n.actor_id,
            'actor_username', a.username,
            'actor_first_name', a.first_name,
            'actor_last_name', a.last_name,
            'actor_avatar_path', a.avatar_path
          )
          order by n.created_at desc
        )
        from (
          select * from public.notifications
          where user_id = v_uid
            and (actor_id is null or not public.is_blocked(v_uid, actor_id))
          order by created_at desc
          limit v_limit offset v_offset
        ) n
          left join public.profiles a on a.id = n.actor_id
      ),
      '[]'::jsonb
    ),
    'unread', (
      select count(*) from public.notifications
      where user_id = v_uid
        and read_at is null
        and (actor_id is null or not public.is_blocked(v_uid, actor_id))
    )
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- Yorumlar: engellenen kişinin reels yorumları görünmez.
-- ---------------------------------------------------------------------------
create or replace function public.reel_list_comments(p_reel_id uuid, p_limit integer default 40, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_me     uuid := public.tz_require_uid();
  v_limit  integer := least(greatest(coalesce(p_limit, 40), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if not public.can_view_reel(p_reel_id) then
    raise exception 'reel_not_found' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'items', coalesce(
      (
        select jsonb_agg(public.tz_reel_comment_json(c.id, v_me) order by c.created_at asc)
        from (
          select c.id, c.created_at
          from public.reel_comments c
          where c.reel_id = p_reel_id
            and not public.is_blocked(v_me, c.author_id)
          order by c.created_at asc
          limit v_limit offset v_offset
        ) c
      ),
      '[]'::jsonb
    )
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- Hikâye izleyicileri: engellenen kişiler listede görünmez.
-- ---------------------------------------------------------------------------
create or replace function public.story_viewers(p_story_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := public.tz_require_uid();
begin
  if not exists (
    select 1 from public.stories s where s.id = p_story_id and s.author_id = v_uid
  ) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'items', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'user_id', p.id,
            'username', p.username,
            'first_name', p.first_name,
            'last_name', p.last_name,
            'avatar_path', p.avatar_path,
            'viewed_at', v.viewed_at
          )
          order by v.viewed_at desc
        )
        from public.story_views v
          join public.profiles p on p.id = v.viewer_id
        where v.story_id = p_story_id
          and not public.is_blocked(v_uid, v.viewer_id)
      ),
      '[]'::jsonb
    )
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- İşletme yorumları: engellenen kişinin yorumu ve sayacı görünmez.
-- ---------------------------------------------------------------------------
create or replace function public.place_reviews_list(p_place_id uuid, p_sort text default 'new', p_limit integer default 20, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_uid uuid := public.tz_require_uid();
  v_sort text := lower(coalesce(nullif(trim(p_sort), ''), 'new'));
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_items jsonb;
  v_total bigint;
begin
  if not exists (select 1 from public.places where id = p_place_id and status = 'published') then
    raise exception 'place_not_found' using errcode = 'P0002';
  end if;

  select count(*) into v_total
  from public.place_reviews r
  where r.place_id = p_place_id
    and r.status = 'visible'
    and not public.is_blocked(v_uid, r.author_id);

  select coalesce(jsonb_agg(item order by ord nulls last, created_at desc), '[]'::jsonb)
  into v_items
  from (
    select jsonb_build_object(
      'id', r.id,
      'rating', r.rating,
      'body', r.body,
      'status', r.status,
      'helpful_count', r.helpful_count,
      'helpful_by_me', exists (
        select 1 from public.place_review_votes v
        where v.review_id = r.id and v.user_id = v_uid
      ),
      'is_mine', r.author_id = v_uid,
      'created_at', r.created_at,
      'updated_at', r.updated_at,
      'author', jsonb_build_object(
        'id', pr.id,
        'username', pr.username,
        'display_name', nullif(trim(concat_ws(' ', pr.first_name, pr.last_name)), ''),
        'avatar_path', pr.avatar_path,
        'is_verified', pr.is_verified
      ),
      'media', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', m.id, 'kind', m.kind, 'storage_path', m.storage_path, 'status', m.status
        ) order by m.created_at)
        from public.place_review_media m
        where m.review_id = r.id
          and (m.status = 'approved' or m.uploader_id = v_uid)
      ), '[]'::jsonb)
    ) as item,
    case
      when v_sort = 'highest' then (-r.rating)::numeric
      when v_sort = 'lowest' then r.rating::numeric
      when v_sort = 'helpful' then (-r.helpful_count)::numeric
      else null
    end as ord,
    r.created_at
    from public.place_reviews r
    join public.profiles pr on pr.id = r.author_id
    where r.place_id = p_place_id
      and r.status = 'visible'
      and not public.is_blocked(v_uid, r.author_id)
    order by
      case when v_sort = 'highest' then -r.rating end asc nulls last,
      case when v_sort = 'lowest' then r.rating end asc nulls last,
      case when v_sort = 'helpful' then -r.helpful_count end asc nulls last,
      case when v_sort = 'new' then extract(epoch from r.created_at) end desc nulls last,
      r.created_at desc
    limit v_limit offset v_offset
  ) t;

  return jsonb_build_object('items', v_items, 'total', v_total, 'limit', v_limit, 'offset', v_offset);
end;
$function$;

-- ---------------------------------------------------------------------------
-- Pazar yeri değerlendirmeleri: engelli çiftler birbirinin yorumunu görmez.
-- ---------------------------------------------------------------------------
drop policy if exists marketplace_reviews_select on public.marketplace_reviews;

create policy marketplace_reviews_select on public.marketplace_reviews
  for select to authenticated
  using (
    public.is_admin()
    or (
      not public.is_blocked(auth.uid(), reviewer_id)
      and not public.is_blocked(auth.uid(), seller_id)
    )
  );

-- ---------------------------------------------------------------------------
-- block_user: engel anında bütün temas noktalarını kapat.
-- ---------------------------------------------------------------------------
create or replace function public.block_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  if p_user_id is null or p_user_id = v_me then
    raise exception 'invalid_target' using errcode = '22023';
  end if;

  -- Engellemek takibi ve bekleyen arkadaslik isteklerini sona erdirir.
  delete from public.user_follows f
   where (f.follower_id = v_me and f.following_id = p_user_id)
      or (f.follower_id = p_user_id and f.following_id = v_me);

  update public.friend_requests r
     set status = 'cancelled'
   where r.status = 'pending'
     and (
       (r.sender_id = v_me and r.receiver_id = p_user_id)
       or (r.sender_id = p_user_id and r.receiver_id = v_me)
     );

  -- Açık kalan halkalar kapanır: engellenen kişi aramaya devam edemez.
  update public.call_sessions c
     set status = 'missed', ended_at = now()
   where c.status = 'ringing'
     and (
       (c.caller_id = v_me and c.callee_id = p_user_id)
       or (c.caller_id = p_user_id and c.callee_id = v_me)
     );

  -- Canlı konum paylaşımı engel sonrası görünmez olur.
  delete from public.map_location_viewers mv
   where (mv.viewer_id = v_me and mv.session_id in (
            select s.id from public.map_location_sessions s where s.owner_id = p_user_id
          ))
      or (mv.viewer_id = p_user_id and mv.session_id in (
            select s.id from public.map_location_sessions s where s.owner_id = v_me
          ));

  -- İki taraf arasındaki geçmiş bildirimler temizlenir.
  delete from public.notifications n
   where (n.user_id = v_me and n.actor_id = p_user_id)
      or (n.user_id = p_user_id and n.actor_id = v_me);

  -- Engel kaydı en sona yazılır: yukarıdaki temizlik RLS'e takılmasın.
  insert into public.user_blocks (blocker_id, blocked_id)
  values (v_me, p_user_id)
  on conflict do nothing;
end;
$$;
