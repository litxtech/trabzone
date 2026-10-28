-- 0054 — Marketplace arama geçmişi (kullanıcıya bağlı, RLS korumalı).
create table if not exists public.marketplace_search_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  query text not null,
  kind text,
  result_count integer not null default 0,
  created_at timestamptz not null default now(),
  constraint marketplace_search_history_query_check
    check (char_length(btrim(query)) between 1 and 120)
);

create index if not exists marketplace_search_history_user_idx
  on public.marketplace_search_history (user_id, created_at desc);

alter table public.marketplace_search_history enable row level security;

drop policy if exists marketplace_search_history_select on public.marketplace_search_history;
create policy marketplace_search_history_select on public.marketplace_search_history
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists marketplace_search_history_insert on public.marketplace_search_history;
create policy marketplace_search_history_insert on public.marketplace_search_history
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists marketplace_search_history_delete on public.marketplace_search_history;
create policy marketplace_search_history_delete on public.marketplace_search_history
  for delete to authenticated
  using (user_id = auth.uid());

revoke all on public.marketplace_search_history from anon, authenticated;
grant select, insert, delete on public.marketplace_search_history to authenticated;

create or replace function public.market_search_history_save(
  p_query text,
  p_kind text default null,
  p_result_count integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
begin
  if v_query is null or char_length(v_query) < 2 then
    return jsonb_build_object('ok', false);
  end if;

  insert into public.marketplace_search_history (user_id, query, kind, result_count)
  values (v_uid, left(v_query, 120), nullif(btrim(p_kind), ''), greatest(coalesce(p_result_count, 0), 0));

  -- Kişi başına son 15 arama tutulur; eski kayıtlar temizlenir.
  delete from public.marketplace_search_history h
  where h.user_id = v_uid
    and h.id not in (
      select h2.id from public.marketplace_search_history h2
      where h2.user_id = v_uid
      order by h2.created_at desc
      limit 15
    );

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.market_search_history_save(text, text, integer) from public, anon;
grant execute on function public.market_search_history_save(text, text, integer) to authenticated, service_role;

create or replace function public.market_search_history_list(p_limit integer default 12)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
  v_limit integer := least(greatest(coalesce(p_limit, 12), 1), 30);
begin
  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', h.id,
        'query', h.query,
        'kind', h.kind,
        'result_count', h.result_count,
        'created_at', h.created_at
      ) order by h.created_at desc)
      from (
        select * from public.marketplace_search_history
        where user_id = v_uid
        order by created_at desc
        limit v_limit
      ) h
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.market_search_history_list(integer) from public, anon;
grant execute on function public.market_search_history_list(integer) to authenticated, service_role;

create or replace function public.market_search_history_clear()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.tz_require_uid();
begin
  delete from public.marketplace_search_history where user_id = v_uid;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.market_search_history_clear() from public, anon;
grant execute on function public.market_search_history_clear() to authenticated, service_role;

comment on table public.marketplace_search_history is
  'Kullanıcının Marketplace arama geçmişi; RLS ile yalnızca sahibine açıktır.';
