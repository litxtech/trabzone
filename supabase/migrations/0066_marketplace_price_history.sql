-- Marketplace fiyat değişiklik geçmişi.
-- İlan fiyatı her değiştiğinde eski/yeni fiyat ve işlemi yapan kullanıcı saklanır.
-- Böylece satıcı ve admin tarafında fiyat geçmişi denetlenebilir olur.

create table if not exists public.marketplace_listing_price_history (
  id bigint generated always as identity primary key,
  listing_id uuid not null references public.marketplace_listings(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  old_price_cents bigint,
  new_price_cents bigint not null,
  currency text not null default 'TRY',
  changed_at timestamptz not null default now()
);

create index if not exists marketplace_listing_price_history_listing_idx
  on public.marketplace_listing_price_history (listing_id, changed_at desc);

alter table public.marketplace_listing_price_history enable row level security;

drop policy if exists "marketplace_listing_price_history_read" on public.marketplace_listing_price_history;
create policy "marketplace_listing_price_history_read"
  on public.marketplace_listing_price_history
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.marketplace_listings l
      where l.id = listing_id
        and (l.seller_id = auth.uid() or public.is_admin())
    )
  );

create or replace function public.tz_market_price_history_capture()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.price_cents is distinct from old.price_cents then
    insert into public.marketplace_listing_price_history (
      listing_id,
      actor_id,
      old_price_cents,
      new_price_cents,
      currency
    ) values (
      new.id,
      auth.uid(),
      old.price_cents,
      new.price_cents,
      coalesce(new.currency, 'TRY')
    );
  end if;
  return new;
end;
$$;

drop trigger if exists marketplace_listing_price_history_trg on public.marketplace_listings;
create trigger marketplace_listing_price_history_trg
  after update of price_cents on public.marketplace_listings
  for each row
  execute function public.tz_market_price_history_capture();

revoke all on function public.tz_market_price_history_capture() from public, anon;
grant execute on function public.tz_market_price_history_capture() to authenticated, service_role;

-- Admin ilan detayına fiyat geçmişi eklenir.
create or replace function public.market_admin_listing_detail_v2(p_listing_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_item jsonb;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not public.has_permission('market.manage') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  v_item := public.tz_listing_json_v2(p_listing_id, v_uid);
  if v_item is null then
    raise exception 'listing_not_found' using errcode = '22023';
  end if;

  return v_item || jsonb_build_object(
    'history', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', h.id,
        'from_status', h.from_status,
        'to_status', h.to_status,
        'reason', h.reason,
        'created_at', h.created_at,
        'actor_username', p.username
      ) order by h.created_at desc)
      from public.marketplace_listing_status_history h
      left join public.profiles p on p.id = h.actor_id
      where h.listing_id = p_listing_id
    ), '[]'::jsonb),
    'price_history', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ph.id,
        'old_price_cents', ph.old_price_cents,
        'new_price_cents', ph.new_price_cents,
        'currency', ph.currency,
        'changed_at', ph.changed_at,
        'actor_username', pp.username
      ) order by ph.changed_at desc)
      from public.marketplace_listing_price_history ph
      left join public.profiles pp on pp.id = ph.actor_id
      where ph.listing_id = p_listing_id
    ), '[]'::jsonb),
    'reports', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'reason', r.reason_category,
        'details', r.description,
        'status', r.status,
        'created_at', r.created_at,
        'reporter_username', rp.username
      ) order by r.created_at desc)
      from public.user_reports r
      left join public.profiles rp on rp.id = r.reporter_id
      where r.target_type = 'listing' and r.target_id = p_listing_id::text
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.market_admin_listing_detail_v2(uuid) from public, anon;
grant execute on function public.market_admin_listing_detail_v2(uuid) to authenticated, service_role;

comment on table public.marketplace_listing_price_history is
  'Marketplace ilanlarının fiyat değişiklik geçmişi; trigger tarafından otomatik yazılır.';
