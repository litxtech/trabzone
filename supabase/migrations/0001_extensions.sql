-- 0001: Extensions & shared helpers
-- Every migration sets an explicit search_path so behaviour is identical when it
-- is applied through the CLI or the Management API.

set search_path = public, extensions;

create extension if not exists citext with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- Keeps `updated_at` honest without relying on the client.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Generic BEFORE UPDATE trigger that stamps updated_at with the server clock.';
