-- ---------------------------------------------------------------------------
-- 0049 — İşletme yanıtları ve işletme sahibi iletişimi
--
-- * İşletme sahipleri/yetkili yöneticiler kullanıcı yorumlarına yanıt yazabilir.
--   Yanıtlar yorumu değiştirmez/silmez; ayrı kayıt olarak tutulur ve moderasyon
--   tarafından gizlenebilir.
-- * `place_owner_contact`, sahiplenilmiş işletmenin sahibiyle mevcut Trabzone
--   mesajlaşma altyapısı üzerinden sohbet açılabilmesi için yalnızca kimliği
--   döndürür. Ham iletişim bilgisi istemciye taşınmaz.
-- ---------------------------------------------------------------------------

create table if not exists public.place_review_replies (
  review_id     uuid primary key references public.place_reviews (id) on delete cascade,
  place_id      uuid not null references public.places (id) on delete cascade,
  author_id     uuid not null references public.profiles (id) on delete cascade,
  body          text not null,
  status        text not null default 'visible',
  moderated_by  uuid references public.profiles (id) on delete set null,
  moderated_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint place_review_replies_body_check check (char_length(body) between 2 and 1200),
  constraint place_review_replies_status_check check (status in ('visible', 'hidden', 'removed'))
);

create index if not exists place_review_replies_place_idx
  on public.place_review_replies (place_id, status, created_at desc);
create index if not exists place_review_replies_author_idx
  on public.place_review_replies (author_id, created_at desc);

drop trigger if exists place_review_replies_updated_at on public.place_review_replies;
create trigger place_review_replies_updated_at
  before update on public.place_review_replies
  for each row execute function public.set_updated_at();

alter table public.place_review_replies enable row level security;
revoke all on public.place_review_replies from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Yorum yanıtlarını listele
-- ---------------------------------------------------------------------------
create or replace function public.place_review_replies_list(p_place_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_items jsonb;
begin
  if not exists (
    select 1 from public.places
    where id = p_place_id and status = 'published'
  ) then
    raise exception 'place_not_found' using errcode = 'P0002';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'review_id', r.review_id,
      'body', r.body,
      'created_at', r.created_at,
      'updated_at', r.updated_at
    ) order by r.created_at
  ), '[]'::jsonb)
  into v_items
  from public.place_review_replies r
  where r.place_id = p_place_id
    and r.status = 'visible'
    and (
      r.author_id = v_uid
      or public.tz_place_manager(p_place_id, v_uid)
      or public.has_permission('places.moderate')
    );

  return jsonb_build_object('items', v_items);
end;
$$;

revoke all on function public.place_review_replies_list(uuid) from public, anon;
grant execute on function public.place_review_replies_list(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Yorum yanıtı ekle / güncelle
-- ---------------------------------------------------------------------------
create or replace function public.place_review_reply_upsert(
  p_review_id uuid,
  p_body text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_review public.place_reviews%rowtype;
  v_body text := nullif(trim(coalesce(p_body, '')), '');
  v_row public.place_review_replies%rowtype;
begin
  select * into v_review from public.place_reviews where id = p_review_id;
  if not found then
    raise exception 'review_not_found' using errcode = 'P0002';
  end if;

  if not (public.tz_place_manager(v_review.place_id, v_uid)
          or public.has_permission('places.moderate')) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  if v_body is null or char_length(v_body) < 2 then
    raise exception 'invalid_reply_body' using errcode = '22023';
  end if;

  insert into public.place_review_replies (review_id, place_id, author_id, body, status)
  values (p_review_id, v_review.place_id, v_uid, v_body, 'visible')
  on conflict (review_id) do update
    set body = excluded.body,
        author_id = excluded.author_id,
        status = 'visible',
        moderated_by = null,
        moderated_at = null
  returning * into v_row;

  return jsonb_build_object('id', v_row.review_id, 'body', v_row.body);
end;
$$;

revoke all on function public.place_review_reply_upsert(uuid, text) from public, anon;
grant execute on function public.place_review_reply_upsert(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- İşletme sahibi iletişim kimliği (mesajlaşma için)
-- ---------------------------------------------------------------------------
create or replace function public.place_owner_contact(p_place_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_owner uuid;
  v_item jsonb;
begin
  select p.owner_id into v_owner
  from public.places p
  where p.id = p_place_id
    and p.status = 'published';

  if v_owner is null then
    return null;
  end if;

  select jsonb_build_object(
    'id', pr.id,
    'username', pr.username,
    'display_name', nullif(trim(concat_ws(' ', pr.first_name, pr.last_name)), '')
  )
  into v_item
  from public.profiles pr
  where pr.id = v_owner
    and pr.account_status = 'active';

  -- Kullanıcı kendi işletmesinde kendisiyle sohbet açmasın.
  if v_item is null or v_owner = v_uid then
    return null;
  end if;

  return v_item;
end;
$$;

revoke all on function public.place_owner_contact(uuid) from public, anon;
grant execute on function public.place_owner_contact(uuid) to authenticated, service_role;

comment on table public.place_review_replies is
  'İşletme sahibinin kullanıcı yorumlarına verdiği resmî yanıtlar. Yorum kaydını değiştirmez.';
