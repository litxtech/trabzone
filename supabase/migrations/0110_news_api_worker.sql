-- ---------------------------------------------------------------------------
-- TRABZONE — Haber API Merkezi: worker ayarları, gizli anahtar erişimi,
-- yayın kuyruğu ve sitemap yetkileri (0098)
-- ---------------------------------------------------------------------------

create table if not exists public.news_api_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  worker_url text,
  dispatch_interval_minutes integer not null default 10 check (dispatch_interval_minutes between 5 and 1440),
  ai_enabled boolean not null default true,
  ai_daily_budget integer not null default 500,
  media_download_enabled boolean not null default false,
  last_tick_at timestamptz,
  next_run_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now()
);

alter table public.news_api_settings enable row level security;

insert into public.news_api_settings (id, worker_url)
select true,
       coalesce(
         (select worker_url from public.ai_news_settings limit 1),
         'https://nzvoufcywppavaioirac.supabase.co'
       )
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 1. Yönetici kontrolü (Edge Function JWT ile çağırır)
-- ---------------------------------------------------------------------------
create or replace function public.admin_news_check()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.tz_admin_require('news.manage', false);
  return true;
exception
  when others then
    return false;
end;
$$;

grant execute on function public.admin_news_check() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Gizli anahtar (yalnızca service_role)
-- ---------------------------------------------------------------------------
create or replace function public.news_worker_connection_secret(p_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_secret_id uuid;
  v_value text;
begin
  select vault_secret_id into v_secret_id
  from public.news_api_credentials
  where connection_id = p_id;

  if v_secret_id is null then
    return null;
  end if;

  select decrypted_secret into v_value
  from vault.decrypted_secrets
  where id = v_secret_id;

  return v_value;
end;
$$;

revoke all on function public.news_worker_connection_secret(uuid) from public, anon, authenticated;
grant execute on function public.news_worker_connection_secret(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Ayarlar
-- ---------------------------------------------------------------------------
create or replace function public.admin_news_settings_get()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('news.view', false);
begin
  return (
    select to_jsonb(s) - 'updated_by'
    from public.news_api_settings s where s.id
  ) || jsonb_build_object(
    'queue_pending', (select count(*) from public.news_source_items where status = 'pending_review'),
    'queue_blocked', (select count(*) from public.news_source_items where status = 'blocked' and first_seen_at > now() - interval '24 hours'),
    'active_sources', (select count(*) from public.news_api_connections where status = 'active'),
    'worker_secret', exists (select 1 from vault.secrets where name = 'ai_news_cron_secret')
  );
end;
$$;

create or replace function public.admin_news_settings_save(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('news.manage', false);
  v_url text := nullif(btrim(coalesce(p_payload->>'worker_url', '')), '');
begin
  if v_url is not null then
    perform public.news_assert_public_url(v_url);
  end if;

  update public.news_api_settings
     set enabled = coalesce((p_payload->>'enabled')::boolean, enabled),
         worker_url = coalesce(v_url, worker_url),
         dispatch_interval_minutes = coalesce((p_payload->>'dispatch_interval_minutes')::int, dispatch_interval_minutes),
         ai_enabled = coalesce((p_payload->>'ai_enabled')::boolean, ai_enabled),
         ai_daily_budget = coalesce((p_payload->>'ai_daily_budget')::int, ai_daily_budget),
         media_download_enabled = coalesce((p_payload->>'media_download_enabled')::boolean, media_download_enabled),
         updated_by = v_admin,
         updated_at = now()
   where id;

  perform public.tz_admin_audit(
    'news.settings.save', 'Haber API merkezi ayarları güncellendi', 'news_api_settings', 'singleton', p_payload
  );

  return public.admin_news_settings_get();
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Yayın kuyruğu (otomatik yayın için tüm kapılar SQL'de)
-- ---------------------------------------------------------------------------
create or replace function public.news_worker_publish_queue(p_limit integer default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'item_id', q.id,
      'connection_id', q.connection_id,
      'mode', q.publish_mode,
      'title', q.title
    ) order by q.first_seen_at)
    from (
      select i.id, i.connection_id, i.title, i.first_seen_at, c.publish_mode
      from public.news_source_items i
      join public.news_api_connections c on c.id = i.connection_id
      join public.news_source_permissions p on p.connection_id = c.id
      where i.status = 'pending_review'
        and i.post_id is null
        and c.status = 'active'
        and c.auto_publish_enabled
        and c.publish_mode in ('source_profile','trabzone_digest')
        and public.news_publish_mode_permitted(
          c.publish_mode, c.license_status, p.can_republish_text, p.can_republish_summary
        )
        and not exists (
          select 1 from public.news_source_items d
          where d.connection_id = i.connection_id
            and d.status = 'published'
            and d.published_at is not null
            and c.min_publish_interval_seconds > 0
            and d.published_at > now() - make_interval(secs => c.min_publish_interval_seconds)
        )
      order by i.first_seen_at
      limit least(greatest(coalesce(p_limit, 20), 1), 100)
    ) q
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.news_worker_publish_queue(integer) from public, anon, authenticated;
grant execute on function public.news_worker_publish_queue(integer) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Zamanlayıcı: pg_cron → pg_net → news-api-worker
-- ---------------------------------------------------------------------------
create or replace function public.news_api_tick()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_settings public.news_api_settings%rowtype;
  v_token text;
  v_request bigint;
begin
  select * into v_settings from public.news_api_settings where id;

  if v_settings.enabled is not true then
    return jsonb_build_object('queued', false, 'reason', 'disabled');
  end if;

  if v_settings.next_run_at > now() then
    return jsonb_build_object('queued', false, 'reason', 'not_due', 'next_run_at', v_settings.next_run_at);
  end if;

  if exists (
    select 1 from public.news_api_connections
    where status = 'active' and last_checked_at > now() - interval '90 seconds'
  ) then
    return jsonb_build_object('queued', false, 'reason', 'busy');
  end if;

  select decrypted_secret into v_token
  from vault.decrypted_secrets
  where name = 'ai_news_cron_secret';

  if v_token is null then
    return jsonb_build_object('queued', false, 'reason', 'secret_missing');
  end if;

  update public.news_api_settings
     set next_run_at = now() + make_interval(mins => v_settings.dispatch_interval_minutes),
         last_tick_at = now()
   where id;

  select net.http_post(
    url := rtrim(v_settings.worker_url, '/') || '/functions/v1/news-api-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-ai-news-token', v_token
    ),
    body := jsonb_build_object('action', 'dispatch', 'trigger', 'cron'),
    timeout_milliseconds := 150000
  ) into v_request;

  return jsonb_build_object('queued', true, 'request_id', v_request);
end;
$$;

revoke all on function public.news_api_tick() from public, anon, authenticated;
grant execute on function public.news_api_tick() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'news-api-tick';
    perform cron.schedule('news-api-tick', '* * * * *', 'select public.news_api_tick();');
  end if;
exception
  when others then
    raise notice 'news-api-tick planlanamadı: %', sqlerrm;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Sitemap erişimi (yalnızca yayındaki ve görünür haberler)
-- ---------------------------------------------------------------------------
grant execute on function public.news_api_sitemap_urls(integer, integer) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Silme işini manuel tetikleme (yönetici)
-- ---------------------------------------------------------------------------
create or replace function public.admin_news_deletion_run(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('news.manage', false);
  v_result jsonb;
begin
  v_result := public.news_process_deletion_job(p_job_id, 50);

  perform public.tz_admin_audit(
    'news.deletion.run', 'Silme işi elle ilerletildi', 'news_source_deletion_job', p_job_id::text, v_result
  );

  return v_result;
end;
$$;

revoke all on function public.admin_news_deletion_run(uuid) from public, anon;
grant execute on function public.admin_news_deletion_run(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. Yetki özeti: admin_* fonksiyonlarını yeniden yetkilendir
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'admin\_news%'
  loop
    execute format('revoke all on function %s from public', r.sig);
    execute format('revoke all on function %s from anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;
end;
$$;

notify pgrst, 'reload schema';
