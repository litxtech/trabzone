-- 0002: RBAC (roles + assignments)
-- Roles are database records, never client-side e-mail lists.

set search_path = public, extensions;

create table public.roles (
  key         text primary key,
  name        text not null,
  description text,
  rank        smallint not null unique,
  created_at  timestamptz not null default now(),
  constraint roles_key_format check (key ~ '^[a-z_]{3,32}$')
);

comment on table public.roles is 'Role catalog. rank orders privileges (higher wins).';

insert into public.roles (key, name, description, rank) values
  ('user',        'Kullanıcı',      'Standart Trabzone üyesi', 10),
  ('seller',      'Satıcı',         'Marketplace ilanı oluşturabilir', 20),
  ('moderator',   'Moderatör',      'İçerik ve şikâyet moderasyonu', 30),
  ('admin',       'Yönetici',       'Platform yönetimi (mesaj içerikleri hariç)', 40),
  ('super_admin', 'Süper Yönetici', 'Tam yetki, rol atama dahil', 50)
on conflict (key) do update
  set name = excluded.name,
      description = excluded.description,
      rank = excluded.rank;

create table public.user_role_assignments (
  user_id    uuid not null references auth.users (id) on delete cascade,
  role_key   text not null references public.roles (key) on delete restrict,
  granted_by uuid references auth.users (id) on delete set null,
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  primary key (user_id, role_key)
);

create index user_role_assignments_role_idx on public.user_role_assignments (role_key);

-- Security definer: policies on user_role_assignments call this function, so it
-- must bypass RLS to avoid infinite recursion.
create or replace function public.has_role(p_role text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_role_assignments a
    where a.user_id = auth.uid()
      and a.role_key = p_role
      and (a.expires_at is null or a.expires_at > now())
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role('admin') or public.has_role('super_admin');
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role('super_admin');
$$;

-- Server-side only: grants a role by e-mail. Never exposed to the mobile client.
create or replace function public.grant_role_by_email(p_email text, p_role text)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid;
begin
  if not exists (select 1 from public.roles where key = p_role) then
    raise exception 'unknown_role' using errcode = 'P0001';
  end if;

  select id into v_user_id from auth.users where lower(email) = lower(p_email);
  if v_user_id is null then
    raise exception 'user_not_found' using errcode = 'P0001';
  end if;

  insert into public.user_role_assignments (user_id, role_key, granted_by)
  values (v_user_id, p_role, auth.uid())
  on conflict (user_id, role_key) do nothing;

  return v_user_id;
end;
$$;

alter table public.roles enable row level security;
alter table public.user_role_assignments enable row level security;

-- The catalog is readable; assignments are private to the user and to admins.
create policy roles_select on public.roles
  for select to authenticated
  using (true);

create policy user_role_assignments_select on public.user_role_assignments
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

revoke all on function public.grant_role_by_email(text, text) from public, anon, authenticated;
grant execute on function public.grant_role_by_email(text, text) to service_role;

revoke all on public.roles from anon, authenticated;
grant select on public.roles to authenticated;

revoke all on public.user_role_assignments from anon, authenticated;
grant select on public.user_role_assignments to authenticated;

revoke all on function public.has_role(text) from public, anon;
revoke all on function public.is_admin() from public, anon;
revoke all on function public.is_super_admin() from public, anon;
grant execute on function public.has_role(text) to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_super_admin() to authenticated;
