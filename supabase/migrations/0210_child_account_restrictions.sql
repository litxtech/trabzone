-- =============================================================================
-- 0210: 18 yaş altı hesaplar için "Çocuk Hesabı" etiketi, kısıtlanmış hesap
-- durumu ve gönderi/Reels görünürlük kısıtlamaları
-- =============================================================================
-- İlkeler:
--   * Doğum tarihi 18 yaşın altında olan her hesap "çocuk hesabı" sayılır ve
--     kısıtlanmış hesap olarak işaretlenir. Yaş, kayıtlı doğum tarihinden
--     CANLI hesaplanır: kullanıcı 18'ine girdiğinde kısıtlar kendiliğinden
--     kalkar (eski `is_child_protected` bayrağı güncellenmese bile).
--   * Kısıtlar sunucuda zorunludur; istemci arayüzünden veya doğrudan tablo
--     güncellemesiyle gevşetilemez.
--   * Gönderiler yalnızca arkadaşlara (karşılıklı takip) görünür; herkese açık
--     görünürlük ve konum etiketi sunucuda zorla kapatılır.
--   * Reels akışı (herkese açık keşfet yüzeyi) 18 yaş altı hesaplar için
--     yalnızca arkadaşlara gösterilir.
--   * Etiket yabancıya gösterilmez: yalnızca hesap sahibi, arkadaşları ve
--     yetkili moderasyon ekibi "Çocuk Hesabı" rozetini görür.
-- =============================================================================

set search_path = public, extensions;

-- -----------------------------------------------------------------------------
-- 1. Çocuk koruma ayarları: gönderi politikası
-- -----------------------------------------------------------------------------
alter table public.child_protection_settings
  add column if not exists post_visibility text not null default 'followers';

alter table public.child_protection_settings
  add column if not exists post_city_enabled boolean not null default false;

alter table public.child_protection_settings
  drop constraint if exists child_post_visibility_check;
alter table public.child_protection_settings
  add constraint child_post_visibility_check check (post_visibility = 'followers');

comment on column public.child_protection_settings.post_visibility is
  '18 yaş altı hesaplarda zorunlu gönderi görünürlüğü; yalnızca followers olabilir.';
comment on column public.child_protection_settings.post_city_enabled is
  '18 yaş altı hesaplarda konum/şehir etiketi kapalıdır.';

-- Tüm çocuk korumalı hesaplarda gönderi politikasını zorunlu değere çek.
update public.child_protection_settings
   set post_visibility = 'followers',
       post_city_enabled = false,
       updated_at = now()
 where post_visibility <> 'followers' or post_city_enabled;

-- -----------------------------------------------------------------------------
-- 2. Yaş grubu: doğum tarihinden canlı hesaplama
-- -----------------------------------------------------------------------------
create or replace function public.safety_age_group_for(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when b.birth_date is null then 'unknown'
    when b.birth_date > (current_date - interval '18 years')::date then 'child'
    else 'adult'
  end
  from (
    select coalesce(
      (select pp.birth_date from public.profile_private pp where pp.user_id = p_user_id),
      (select a.birth_date from public.user_age_assurance a where a.user_id = p_user_id)
    ) as birth_date
  ) b;
$$;

/**
 * Çocuk korumalı hesap mı?
 *
 * Eski sürüm yalnızca `user_age_assurance.is_child_protected` bayrağına
 * bakıyordu; bayrak 18. doğum gününde güncellenmediği için hesap ömür boyu
 * çocuk kalıyordu. Artık kayıtlı doğum tarihi esastır ve yaş canlı hesaplanır.
 */
create or replace function public.safety_is_child_protected(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.safety_age_group_for(p_user_id) = 'child';
$$;

-- -----------------------------------------------------------------------------
-- 3. Doğum tarihi uygulama (kayıt trigger'ı + backfill + RPC ortak yolu)
-- -----------------------------------------------------------------------------
create or replace function public.safety_apply_birth_date(
  p_user_id    uuid,
  p_birth_date date,
  p_source     text default 'signup'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_policy   public.age_policy_config%rowtype;
  v_country  text;
  v_age      integer;
  v_group    text;
  v_child    boolean;
  v_guardian boolean;
begin
  if p_user_id is null or p_birth_date is null then
    raise exception 'invalid_birth_date' using errcode = '22023';
  end if;

  if p_birth_date > current_date or p_birth_date < date '1900-01-01' then
    raise exception 'invalid_birth_date' using errcode = '22023';
  end if;

  select coalesce(p.country_code, 'TR') into v_country
  from public.profiles p where p.id = p_user_id;

  v_policy := public.safety_policy_for(coalesce(v_country, 'TR'));
  v_age := public.safety_age_on(p_birth_date);

  if v_age < v_policy.min_age then
    insert into public.moderation_audit_logs (actor_id, action_code, entity_type, entity_id, metadata)
    values (
      p_user_id, 'age.declined_under_minimum', 'user', p_user_id::text,
      jsonb_build_object('min_age', v_policy.min_age, 'source', p_source)
    );

    raise exception 'age_below_minimum' using errcode = '22023';
  end if;

  v_group := case when v_age < v_policy.adult_age then 'child' else 'adult' end;
  v_child := v_group = 'child';
  v_guardian := v_child
    and v_policy.guardian_consent_required
    and v_age <= v_policy.guardian_consent_max_age;

  perform set_config('safety.rpc', 'on', true);

  insert into public.user_age_assurance (
    user_id, birth_date, age_group, is_child_protected, verification_state,
    country_code, guardian_required, change_count, locked_at, evaluated_at
  )
  values (
    p_user_id, p_birth_date, v_group, v_child,
    case when v_guardian then 'pending_guardian' else 'declared' end,
    coalesce(v_country, 'TR'), v_guardian, 1, now(), now()
  )
  on conflict (user_id) do update set
    birth_date = excluded.birth_date,
    age_group = excluded.age_group,
    is_child_protected = excluded.is_child_protected,
    country_code = excluded.country_code,
    guardian_required = excluded.guardian_required,
    verification_state = case
      when public.user_age_assurance.verification_state = 'verified' then 'verified'
      when excluded.guardian_required then 'pending_guardian'
      else 'declared'
    end,
    change_count = public.user_age_assurance.change_count + 1,
    evaluated_at = now(),
    updated_at = now();

  insert into public.profile_private (user_id, birth_date)
  values (p_user_id, p_birth_date)
  on conflict (user_id) do update set birth_date = excluded.birth_date;

  if v_child then
    insert into public.child_protection_settings (
      user_id, is_enabled, guardian_consent_required, post_visibility, post_city_enabled
    )
    values (p_user_id, true, v_guardian, 'followers', false)
    on conflict (user_id) do update set
      is_enabled = true,
      guardian_consent_required = excluded.guardian_consent_required,
      enforced_by_system = true,
      post_visibility = 'followers',
      post_city_enabled = false,
      updated_at = now();

    -- Profil ayarlarını zorunlu koruma değerlerine çek.
    update public.profile_settings
       set profile_visibility = 'private',
           discoverable = false,
           show_city = false,
           show_district = false,
           show_last_seen = false,
           show_online_status = false,
           map_visibility = 'off',
           ghost_mode = true,
           allow_messages_from = case
             when allow_messages_from = 'everyone' then 'friends'
             else allow_messages_from
           end
     where user_id = p_user_id;

    insert into public.safety_notifications (user_id, kind, title, body)
    values (
      p_user_id, 'child_protection_enabled', 'Çocuk Hesabı etkin',
      'Hesabın 18 yaş altı olarak kaydedildi. Gönderilerin yalnızca arkadaşlarına görünür; mesaj, arama, yorum ve konum paylaşımı kısıtlanır.'
    );
  end if;

  insert into public.moderation_audit_logs (actor_id, action_code, entity_type, entity_id, metadata)
  values (
    null, 'age.' || coalesce(nullif(p_source, ''), 'system') || '_applied', 'user', p_user_id::text,
    jsonb_build_object('age_group', v_group, 'source', p_source, 'guardian_required', v_guardian)
  );
end
$$;

revoke all on function public.safety_apply_birth_date(uuid, date, text)
  from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. Gönderi kısıtlaması: 18 yaş altı hesap yalnızca arkadaşlarına paylaşır
-- -----------------------------------------------------------------------------
create or replace function public.tz_enforce_child_post_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Yaş doğum tarihinden canlı hesaplandığı için 18'ine giren hesap bu
  -- kısıttan kendiliğinden çıkar.
  if public.safety_is_child_protected(new.author_id) then
    new.visibility := 'followers';
    new.city := null;
  end if;

  return new;
end
$$;

revoke all on function public.tz_enforce_child_post_rules() from public, anon, authenticated;

drop trigger if exists tz_enforce_child_post_rules on public.posts;
create trigger tz_enforce_child_post_rules
  before insert or update of author_id, visibility, city, moderation_status on public.posts
  for each row execute function public.tz_enforce_child_post_rules();

/**
 * Çocuk hesabı işaretlendiğinde mevcut gönderileri de geriye dönük kısıtlar.
 * RPC, admin düzeltmesi veya backfill hangi yoldan yazarsa yazsın çalışır.
 */
create or replace function public.tz_lock_child_account_posts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_child_protected then
    update public.posts
       set visibility = 'followers',
           city = null
     where author_id = new.user_id
       and (visibility <> 'followers' or city is not null);
  end if;

  return new;
end
$$;

revoke all on function public.tz_lock_child_account_posts() from public, anon, authenticated;

drop trigger if exists tz_lock_child_account_posts on public.user_age_assurance;
create trigger tz_lock_child_account_posts
  after insert or update of is_child_protected on public.user_age_assurance
  for each row execute function public.tz_lock_child_account_posts();

-- -----------------------------------------------------------------------------
-- 5. Görünürlük: gönderiler, yorumlar ve Reels yalnızca arkadaşlara
-- -----------------------------------------------------------------------------
create or replace function public.can_view_post(p_post_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.posts p
      join public.profiles pr on pr.id = p.author_id
    where p.id = p_post_id
      and pr.account_status = 'active'
      and not public.is_blocked(auth.uid(), p.author_id)
      and (
        p.moderation_status = 'visible'
        or p.author_id = auth.uid()
        or public.is_admin()
      )
      and (
        p.visibility = 'public'
        or p.author_id = auth.uid()
        or public.is_following(p.author_id)
      )
      and (
        p.author_id = auth.uid()
        or public.is_admin()
        or not public.safety_is_child_protected(p.author_id)
        or public.are_friends(auth.uid(), p.author_id)
      )
  );
$$;

create or replace function public.feed_list(
  p_filter text default 'all',
  p_city   text default null,
  p_cursor timestamptz default null,
  p_limit  integer default 12
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me    uuid := public.tz_require_uid();
  v_limit integer := least(greatest(coalesce(p_limit, 12), 1), 30);
  v_filter text := coalesce(nullif(trim(p_filter), ''), 'all');
begin
  if v_filter not in ('all', 'following', 'nearby', 'popular', 'news') then
    raise exception 'invalid_filter' using errcode = '22023';
  end if;

  return (
    with base as (
      select
        p.id,
        p.created_at,
        (p.like_count + p.comment_count * 2 + p.save_count * 2) as score
      from public.posts p
        join public.profiles pr on pr.id = p.author_id
      where p.moderation_status = 'visible'
        and pr.account_status = 'active'
        and not public.is_blocked(v_me, p.author_id)
        and (
          p.visibility = 'public'
          or p.author_id = v_me
          or public.is_following(p.author_id)
        )
        and (
          p.author_id = v_me
          or public.is_admin()
          or not public.safety_is_child_protected(p.author_id)
          or public.are_friends(v_me, p.author_id)
        )
        and (p_cursor is null or p.created_at < p_cursor)
        and not exists (
          select 1 from public.live_news ln
          where ln.post_id = p.id
            and not ('feed' = any (ln.publish_targets))
        )
        and (
          v_filter <> 'following'
          or p.author_id = v_me
          or public.is_following(p.author_id)
        )
        and (
          v_filter <> 'nearby'
          or p_city is null
          or (p.city is not null and lower(trim(p.city)) = lower(trim(p_city)))
        )
        and (v_filter <> 'popular' or p.created_at > now() - interval '30 days')
        and (
          v_filter <> 'news'
          or exists (
            select 1 from public.ai_news_publications pub
            where pub.post_id = p.id and pub.status = 'published'
          )
        )
      order by
        case when v_filter = 'popular' then
          (p.like_count + p.comment_count * 2 + p.save_count * 2)
        end desc nulls last,
        p.created_at desc
      limit v_limit + 1
    ),
    numbered as (
      select
        b.id,
        b.created_at,
        row_number() over (
          order by
            case when v_filter = 'popular' then b.score end desc nulls last,
            b.created_at desc
        ) as rn
      from base b
    )
    select jsonb_build_object(
      'items', coalesce(
        (
          select jsonb_agg(public.tz_post_json(n.id, v_me) order by n.rn)
          from numbered n
          where n.rn <= v_limit
        ),
        '[]'::jsonb
      ),
      'next_cursor', (select n.created_at from numbered n where n.rn = v_limit),
      'has_more', (select count(*) from numbered) > v_limit
    )
  );
end;
$$;

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
              v_author = v_uid
              or public.is_admin()
              or not public.safety_is_child_protected(v_author)
              or public.are_friends(v_uid, v_author)
            )
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

-- -----------------------------------------------------------------------------
-- 6. Yazma yolları: görünürlük ve konum sunucuda zorlanır
-- -----------------------------------------------------------------------------
create or replace function public.feed_create_post(
  p_body       text default null,
  p_media      jsonb default '[]'::jsonb,
  p_visibility text default 'public',
  p_city       text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := public.tz_require_uid();
  v_body     text := nullif(trim(coalesce(p_body, '')), '');
  v_media    jsonb := coalesce(p_media, '[]'::jsonb);
  v_vis      text := coalesce(nullif(trim(p_visibility), ''), 'public');
  v_item     jsonb;
  v_count    integer := 0;
  v_post_id  uuid;
  v_type     text;
  v_thumb    text;
  v_index    integer := 0;
begin
  if v_vis not in ('public', 'followers') then
    raise exception 'invalid_visibility' using errcode = '22023';
  end if;

  if v_body is not null and char_length(v_body) > 2000 then
    raise exception 'body_too_long' using errcode = '22023';
  end if;

  if jsonb_typeof(v_media) <> 'array' then
    raise exception 'invalid_media' using errcode = '22023';
  end if;

  v_count := jsonb_array_length(v_media);
  if v_count > 10 then
    raise exception 'too_many_media' using errcode = '22023';
  end if;

  if v_body is null and v_count = 0 then
    raise exception 'empty_post' using errcode = '22023';
  end if;

  -- Çocuk hesabı: herkese açık paylaşım ve konum etiketi sunucuda kapatılır.
  if public.safety_is_child_protected(v_uid) then
    v_vis := 'followers';
    p_city := null;
  end if;

  perform public.safety_check_rate('post_create', 20, interval '1 day');

  insert into public.posts (author_id, body, visibility, city)
  values (v_uid, v_body, v_vis, nullif(trim(coalesce(p_city, '')), ''))
  returning id into v_post_id;

  for v_item in select * from jsonb_array_elements(v_media)
  loop
    v_type := v_item ->> 'media_type';
    if v_type not in ('image', 'video') then
      raise exception 'invalid_media_type' using errcode = '22023';
    end if;

    perform public.tz_validate_media_path(v_item ->> 'storage_path', v_uid);

    v_thumb := nullif(trim(coalesce(v_item ->> 'thumbnail_path', '')), '');
    if v_thumb is not null then
      perform public.tz_validate_media_path(v_thumb, v_uid);
    end if;

    insert into public.post_media (
      post_id, storage_path, thumbnail_path, media_type, width, height, duration_ms, sort_order
    )
    values (
      v_post_id,
      v_item ->> 'storage_path',
      v_thumb,
      v_type,
      nullif(v_item ->> 'width', '')::integer,
      nullif(v_item ->> 'height', '')::integer,
      nullif(v_item ->> 'duration_ms', '')::integer,
      v_index
    );

    v_index := v_index + 1;
  end loop;

  return jsonb_build_object('id', v_post_id);
end;
$$;

create or replace function public.feed_update_post(
  p_post_id    uuid,
  p_body       text default null,
  p_visibility text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := public.tz_require_uid();
  v_body text := nullif(trim(coalesce(p_body, '')), '');
  v_vis  text := nullif(trim(coalesce(p_visibility, '')), '');
begin
  if not exists (select 1 from public.posts p where p.id = p_post_id and p.author_id = v_uid) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  if v_body is null and not exists (
    select 1 from public.post_media m where m.post_id = p_post_id
  ) then
    raise exception 'empty_post' using errcode = '22023';
  end if;

  if v_body is not null and char_length(v_body) > 2000 then
    raise exception 'body_too_long' using errcode = '22023';
  end if;

  if v_vis is not null and v_vis not in ('public', 'followers') then
    raise exception 'invalid_visibility' using errcode = '22023';
  end if;

  if public.safety_is_child_protected(v_uid) then
    v_vis := 'followers';
  end if;

  update public.posts
     set body = v_body,
         visibility = coalesce(v_vis, visibility),
         is_edited = true
   where id = p_post_id;

  return public.tz_post_json(p_post_id, v_uid);
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. Reels: herkese açık keşfet akışında 18 yaş altı hesap yok
-- -----------------------------------------------------------------------------
create or replace function public.can_view_reel(p_reel_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.reels r
      join public.profiles pr on pr.id = r.author_id
    where r.id = p_reel_id
      and r.moderation_status = 'visible'
      and r.status = 'ready'
      and pr.account_status = 'active'
      and not public.is_blocked(auth.uid(), r.author_id)
      and (
        r.author_id = auth.uid()
        or public.is_admin()
        or not public.safety_is_child_protected(r.author_id)
        or public.are_friends(auth.uid(), r.author_id)
      )
  );
$$;

create or replace function public.reels_list(
  p_cursor timestamptz default null,
  p_limit  integer default 6
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me    uuid := public.tz_require_uid();
  v_limit integer := least(greatest(coalesce(p_limit, 6), 1), 20);
begin
  return (
    with base as (
      select r.id, r.created_at
      from public.reels r
        join public.profiles pr on pr.id = r.author_id
      where r.moderation_status = 'visible'
        and r.status = 'ready'
        and pr.account_status = 'active'
        and not public.is_blocked(v_me, r.author_id)
        and (
          r.author_id = v_me
          or public.is_admin()
          or not public.safety_is_child_protected(r.author_id)
          or public.are_friends(v_me, r.author_id)
        )
        and (p_cursor is null or r.created_at < p_cursor)
      order by r.created_at desc
      limit v_limit + 1
    ),
    numbered as (
      select b.id, b.created_at, row_number() over (order by b.created_at desc) as rn
      from base b
    )
    select jsonb_build_object(
      'items', coalesce(
        (
          select jsonb_agg(public.tz_reel_json(n.id, v_me) order by n.rn)
          from numbered n
          where n.rn <= v_limit
        ),
        '[]'::jsonb
      ),
      'next_cursor', (select n.created_at from numbered n where n.rn = v_limit),
      'has_more', (select count(*) from numbered) > v_limit
    )
  );
end;
$$;

create or replace function public.reel_add_comment(p_reel_id uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := public.tz_require_uid();
  v_body     text := trim(coalesce(p_body, ''));
  v_author   uuid;
  v_policy   text;
  v_comment  uuid;
  v_username text;
begin
  if not public.can_view_reel(p_reel_id) then
    raise exception 'reel_not_found' using errcode = '22023';
  end if;

  if char_length(v_body) < 1 or char_length(v_body) > 1000 then
    raise exception 'invalid_comment' using errcode = '22023';
  end if;

  select r.author_id into v_author from public.reels r where r.id = p_reel_id;

  -- Çocuk korumalı hesaplarda yorum politikası uygulanır.
  if v_author is not null and v_author <> v_uid and public.safety_is_child_protected(v_author) then
    select c.comment_policy into v_policy
    from public.child_protection_settings c
    where c.user_id = v_author;

    if coalesce(v_policy, 'friends') = 'nobody' then
      raise exception 'comments_disabled' using errcode = '42501';
    end if;

    if coalesce(v_policy, 'friends') = 'friends' and not public.are_friends(v_uid, v_author) then
      raise exception 'comments_friends_only' using errcode = '42501';
    end if;
  end if;

  perform public.safety_check_rate('reel_comment', 120, interval '1 hour');

  insert into public.reel_comments (reel_id, author_id, body)
  values (p_reel_id, v_uid, v_body)
  returning id into v_comment;

  if v_author <> v_uid then
    select pr.username || ' Reels videona yorum yaptı' into v_username
    from public.profiles pr where pr.id = v_uid;
    perform public.tz_notify(
      v_author, v_uid, 'comment', coalesce(v_username, 'Reels videona yorum yapıldı'), null,
      'reel', p_reel_id::text, '/reels'
    );
  end if;

  return public.tz_reel_comment_json(v_comment, v_uid);
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. Etiket: "Çocuk Hesabı" yalnızca sahibine, arkadaşlarına ve yetkililere
-- -----------------------------------------------------------------------------
create or replace function public.safety_profile_flags(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_relation text;
  v_child    boolean;
begin
  if v_uid is null then
    return '{}'::jsonb;
  end if;

  if v_uid = p_user_id then
    v_relation := 'self';
  elsif public.is_admin() then
    v_relation := 'admin';
  elsif public.are_friends(v_uid, p_user_id) then
    v_relation := 'friend';
  else
    -- Yabancıya yaş bilgisi verilmez; çocuk hesapların kimliği korunur.
    return '{}'::jsonb;
  end if;

  v_child := public.safety_is_child_protected(p_user_id);

  return jsonb_build_object(
    'user_id', p_user_id,
    'is_child_protected', v_child,
    'restricted_account', v_child,
    'account_label', case when v_child then 'Çocuk Hesabı' else null end,
    'restricted_label', case when v_child then 'Kısıtlanmış Hesap' else null end,
    'relation', v_relation,
    'badge_visible', v_child
  );
end
$$;

-- Gönderi kartlarında etiket göstermek için: yalnızca gönderiyi görebilen
-- kişilere döner (çocuk hesap gönderileri zaten arkadaş dışına kapalı).
create or replace function public.tz_post_json(p_post_id uuid, p_me uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', p.id,
    'author_id', p.author_id,
    'author_username', pr.username,
    'author_first_name', pr.first_name,
    'author_last_name', pr.last_name,
    'author_avatar_path', pr.avatar_path,
    'author_is_verified', pr.is_verified,
    'author_is_child_protected', public.safety_is_child_protected(p.author_id),
    'body', p.body,
    'visibility', p.visibility,
    'city', p.city,
    'moderation_status', p.moderation_status,
    'like_count', p.like_count,
    'comment_count', p.comment_count,
    'save_count', p.save_count,
    'share_count', p.share_count,
    'view_count', coalesce(c.unique_views, 0),
    'view_legacy_count', coalesce(c.legacy_views, 0),
    'is_edited', p.is_edited,
    'created_at', p.created_at,
    'updated_at', p.updated_at,
    'liked', exists (
      select 1 from public.post_likes l where l.post_id = p.id and l.user_id = p_me
    ),
    'saved', exists (
      select 1 from public.post_saves s where s.post_id = p.id and s.user_id = p_me
    ),
    'is_mine', p.author_id = p_me,
    'news', public.ai_news_post_meta(p.id),
    'source', public.news_source_post_meta(p.id),
    'live_news', public.tz_live_news_brief(p.id, p_me),
    'media', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', m.id,
            'storage_path', m.storage_path,
            'thumbnail_path', m.thumbnail_path,
            'media_type', m.media_type,
            'width', m.width,
            'height', m.height,
            'duration_ms', m.duration_ms,
            'display_fit', m.display_fit
          )
          order by m.sort_order, m.created_at
        )
        from public.post_media m
        where m.post_id = p.id
      ),
      '[]'::jsonb
    )
  )
  from public.posts p
    join public.profiles pr on pr.id = p.author_id
    left join public.content_view_counters c
      on c.content_type = 'post' and c.content_id = p.id
  where p.id = p_post_id;
$$;

-- -----------------------------------------------------------------------------
-- 9. Kendi güvenlik durumum: kısıtlanmış hesap + gönderi politikası
-- -----------------------------------------------------------------------------
create or replace function public.safety_my_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_age      public.user_age_assurance%rowtype;
  v_protection public.child_protection_settings%rowtype;
  v_settings public.profile_settings%rowtype;
  v_consent  public.guardian_consents%rowtype;
  v_policy   public.age_policy_config%rowtype;
  v_country  text;
  v_birth    date;
  v_age_years integer;
  v_group    text;
  v_child    boolean;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into v_age from public.user_age_assurance where user_id = v_uid;
  select * into v_protection from public.child_protection_settings where user_id = v_uid;
  select * into v_settings from public.profile_settings where user_id = v_uid;

  select * into v_consent
  from public.guardian_consents
  where user_id = v_uid and status in ('pending', 'verified', 'revoked')
  order by requested_at desc
  limit 1;

  select coalesce(p.country_code, 'TR') into v_country
  from public.profiles p where p.id = v_uid;

  v_policy := public.safety_policy_for(coalesce(v_country, 'TR'));

  v_birth := coalesce(
    (select pp.birth_date from public.profile_private pp where pp.user_id = v_uid),
    v_age.birth_date
  );

  v_age_years := case when v_birth is null then null else public.safety_age_on(v_birth) end;
  v_group := case
    when v_birth is null then 'unknown'
    when v_age_years < v_policy.adult_age then 'child'
    else 'adult'
  end;
  v_child := public.safety_is_child_protected(v_uid);

  return jsonb_build_object(
    'user_id', v_uid,
    'country_code', coalesce(v_country, 'TR'),
    'min_age', v_policy.min_age,
    'adult_age', v_policy.adult_age,
    'birth_date_set', v_birth is not null,
    'birth_date', v_birth,
    'age', v_age_years,
    'age_group', v_group,
    'is_child_protected', v_child,
    'restricted_account', v_child,
    'account_label', case when v_child then 'Çocuk Hesabı' else null end,
    'verification_state', coalesce(v_age.verification_state, case when v_birth is null then 'none' else 'declared' end),
    'guardian_required', coalesce(v_age.guardian_required, false),
    'evaluated_at', v_age.evaluated_at,
    'protection', jsonb_build_object(
      'is_enabled', v_child or coalesce(v_protection.is_enabled, false),
      'profile_visibility', coalesce(v_protection.profile_visibility, v_settings.profile_visibility, 'public'),
      'dm_policy', coalesce(v_protection.dm_policy, v_settings.allow_messages_from, 'everyone'),
      'call_policy', coalesce(v_protection.call_policy, 'friends'),
      'comment_policy', coalesce(v_protection.comment_policy, 'friends'),
      'location_sharing', case when v_child then false else coalesce(v_protection.location_sharing, false) end,
      'discoverable', coalesce(v_protection.discoverable, v_settings.discoverable, true),
      'content_filter', coalesce(v_protection.content_filter, 'strict'),
      'enforced_by_system', coalesce(v_protection.enforced_by_system, v_child),
      'guardian_consent_required', coalesce(v_protection.guardian_consent_required, false),
      'post_visibility', case when v_child then 'followers' else null end,
      'post_city_enabled', case when v_child then false else true end
    ),
    'guardian', jsonb_build_object(
      'required', coalesce(v_age.guardian_required, false),
      'status', coalesce(v_consent.status, 'none'),
      'requested_at', v_consent.requested_at,
      'verified_at', v_consent.verified_at,
      'guardian_email_masked', case
        when v_consent.guardian_email is null then null
        else left(v_consent.guardian_email::text, 2) || '***@' || split_part(v_consent.guardian_email::text, '@', 2)
      end
    ),
    'notifications_unread', (
      select count(*) from public.safety_notifications n
      where n.user_id = v_uid and n.read_at is null
    )
  );
end
$$;

-- -----------------------------------------------------------------------------
-- 10. Kayıt trigger'ı: doğum tarihi metadata'sı sunucuda değerlendirilir
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_username text;
  v_first    text;
  v_last     text;
  v_birth    text;
  v_date     date;
begin
  -- A verified, available username is claimed afterwards through
  -- complete_registration(); the placeholder only satisfies NOT NULL/UNIQUE.
  v_username := 'u_' || substr(replace(new.id::text, '-', ''), 1, 10);
  v_first    := coalesce(nullif(trim(new.raw_user_meta_data ->> 'first_name'), ''), 'Trabzone');
  v_last     := coalesce(nullif(trim(new.raw_user_meta_data ->> 'last_name'), ''), 'Üyesi');

  insert into public.profiles (id, username, first_name, last_name)
  values (new.id, v_username, v_first, v_last);

  insert into public.profile_private (user_id) values (new.id);
  insert into public.profile_settings (user_id) values (new.id);
  insert into public.user_preferences (user_id) values (new.id);

  insert into public.user_role_assignments (user_id, role_key)
  values (new.id, 'user')
  on conflict do nothing;

  -- Kayıt formunda beyan edilen doğum tarihi varsa yaş kaydı burada kurulur.
  -- 13 yaş altı beyanlar `age_below_minimum` ile kaydı reddeder.
  v_birth := nullif(trim(coalesce(new.raw_user_meta_data ->> 'birth_date', '')), '');
  if v_birth is not null then
    begin
      v_date := v_birth::date;
    exception when others then
      v_date := null;
    end;

    if v_date is not null then
      perform public.safety_apply_birth_date(new.id, v_date, 'signup');
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 11. Geriye dönük doldurma: doğum tarihi kayıtlı tüm hesaplar
-- -----------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select user_id, birth_date from public.profile_private where birth_date is not null
    union
    select user_id, birth_date from public.user_age_assurance where birth_date is not null
  loop
    begin
      perform public.safety_apply_birth_date(r.user_id, r.birth_date, 'backfill');
    exception when others then
      raise warning 'safety backfill atlandı (%) : %', r.user_id, sqlerrm;
    end;
  end loop;
end
$$;

-- -----------------------------------------------------------------------------
-- 12. Yetkiler
-- -----------------------------------------------------------------------------
revoke all on function public.safety_age_group_for(uuid) from public, anon, authenticated;
revoke all on function public.safety_is_child_protected(uuid) from public, anon;
grant execute on function public.safety_is_child_protected(uuid) to authenticated, service_role;
grant execute on function public.safety_age_group_for(uuid) to service_role;

revoke all on function public.safety_profile_flags(uuid) from public, anon;
grant execute on function public.safety_profile_flags(uuid) to authenticated;

revoke all on function public.tz_post_json(uuid, uuid) from public, anon, authenticated;
revoke all on function public.can_view_post(uuid) from public, anon, authenticated;
revoke all on function public.can_view_reel(uuid) from public, anon;
grant execute on function public.can_view_reel(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
