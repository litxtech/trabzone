-- ---------------------------------------------------------------------------
-- Onaysız (otomatik) yayın anahtarı
--
-- Panelde tek bir anahtar hem tüm RSS/API kaynaklarını hem de AI haber
-- motorunu birlikte açar/kapatır. Kapatıldığında kaynaklardan gelen haberler
-- yine çekilir ve kuyruğa düşer; yalnızca kendiliğinden yayımlanmaz.
-- "Keşif" (discovery) modundaki kaynaklar her durumda yayımlanmaz.
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
    'worker_secret', exists (select 1 from vault.secrets where name = 'ai_news_cron_secret'),
    'sources_auto_publish', (
      select count(*) from public.news_api_connections
      where status = 'active' and publish_mode <> 'discovery' and auto_publish_enabled
    ),
    'sources_auto_total', (
      select count(*) from public.news_api_connections
      where status = 'active' and publish_mode <> 'discovery'
    ),
    'ai_auto_publish', coalesce(
      (select ai.auto_publish_enabled from public.ai_news_settings ai where ai.id), false
    ),
    'auto_publish_all', (
      coalesce((
        select bool_and(c.auto_publish_enabled)
        from public.news_api_connections c
        where c.status = 'active' and c.publish_mode <> 'discovery'
      ), false)
      and coalesce((select ai.auto_publish_enabled from public.ai_news_settings ai where ai.id), false)
    )
  );
end;
$$;

create or replace function public.admin_news_auto_publish_all(
  p_enabled boolean,
  p_include_ai boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('news.manage', false);
  v_enabled boolean := coalesce(p_enabled, false);
  v_sources integer := 0;
  v_blocked integer := 0;
begin
  -- Lisansı "yasak" olan kaynakta otomatik yayın açılmaz.
  if v_enabled then
    select count(*) into v_blocked
    from public.news_api_connections
    where status = 'active' and publish_mode <> 'discovery' and license_status = 'prohibited';
  end if;

  with updated as (
    update public.news_api_connections
       set auto_publish_enabled = v_enabled,
           updated_at = now()
     where status = 'active'
       and publish_mode <> 'discovery'
       and (not v_enabled or license_status <> 'prohibited')
    returning 1
  )
  select count(*) into v_sources from updated;

  if coalesce(p_include_ai, true) then
    update public.ai_news_settings
       set auto_publish_enabled = v_enabled,
           updated_at = now()
     where id;
  end if;

  perform public.tz_admin_audit(
    'news.auto_publish.all',
    case when v_enabled then 'Onaysız yayın açıldı' else 'Onaysız yayın kapatıldı' end,
    'news_api_settings',
    'singleton',
    jsonb_build_object(
      'enabled', v_enabled,
      'include_ai', coalesce(p_include_ai, true),
      'sources', v_sources,
      'license_blocked', v_blocked
    )
  );

  return public.admin_news_settings_get() || jsonb_build_object('sources_updated', v_sources);
end;
$$;

grant execute on function public.admin_news_auto_publish_all(boolean, boolean) to authenticated;
