-- 0103 — Haber kaynağı medya temizliği kuyruğu
--
-- Neden: kaynak silme ve tek öğe kaldırma işlemleri `post_media` satırlarını
-- siliyor ancak `posts` Storage bucket'ındaki dosyalar kalıyordu. SQL katmanı
-- Storage API'ye erişemediği için temizlik, Edge Function worker'ının işlediği
-- kalıcı bir kuyruğa alınır. Böylece işlem yeniden denenebilir ve sonuç
-- audit/rapor için izlenebilir.

create table if not exists public.news_media_cleanup_queue (
  id bigserial primary key,
  connection_id uuid references public.news_api_connections(id) on delete set null,
  item_id uuid,
  post_id uuid,
  storage_path text not null,
  status text not null default 'pending'
    check (status in ('pending','done','failed')),
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists news_media_cleanup_pending_idx
  on public.news_media_cleanup_queue (created_at)
  where status = 'pending';

-- Aynı dosya birden çok kez kuyruğa eklenmesin (tamamlanmış kayıtlar geçmiş
-- olarak kalır; yalnızca bekleyen kayıtlar tekil tutulur).
create unique index if not exists news_media_cleanup_pending_uniq
  on public.news_media_cleanup_queue (storage_path)
  where status = 'pending';

alter table public.news_media_cleanup_queue enable row level security;

-- ---------------------------------------------------------------------------
-- Kuyruğa ekleme (SQL içi kullanım; doğrudan istemci erişimine kapalı)
-- ---------------------------------------------------------------------------
create or replace function public.news_media_cleanup_enqueue(
  p_connection_id uuid,
  p_item_id uuid,
  p_post_id uuid,
  p_paths text[]
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  v_path text;
begin
  if p_paths is null then
    return 0;
  end if;

  foreach v_path in array p_paths loop
    v_path := btrim(coalesce(v_path, ''));
    if v_path = '' or v_path like 'http%' or v_path like '%..%' then
      continue;
    end if;

    insert into public.news_media_cleanup_queue (
      connection_id, item_id, post_id, storage_path
    ) values (
      p_connection_id, p_item_id, p_post_id, v_path
    )
    on conflict do nothing;

    if found then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.news_media_cleanup_enqueue(uuid, uuid, uuid, text[]) from public;
grant execute on function public.news_media_cleanup_enqueue(uuid, uuid, uuid, text[]) to service_role;

-- ---------------------------------------------------------------------------
-- Tek öğe kaldırma: medyayı kuyruğa al
-- ---------------------------------------------------------------------------
create or replace function public.admin_news_item_remove(p_item_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('news.manage', false);
  v_item public.news_source_items%rowtype;
  v_exclusive boolean;
  v_paths text[] := array[]::text[];
  v_queued integer := 0;
  v_post_removed boolean := false;
begin
  select * into v_item from public.news_source_items where id = p_item_id for update;
  if not found then
    raise exception 'item_not_found' using errcode = 'P0002';
  end if;

  v_exclusive := public.news_post_is_exclusive(v_item.post_id, v_item.connection_id);

  if v_item.post_id is not null and v_exclusive then
    update public.posts
       set moderation_status = 'removed'
     where id = v_item.post_id and moderation_status <> 'removed';

    select coalesce(array_agg(storage_path), array[]::text[])
      into v_paths
      from public.post_media where post_id = v_item.post_id;

    delete from public.post_media where post_id = v_item.post_id;
    v_post_removed := true;
  end if;

  -- Kaynağa indirilen görsel, yayın kaldırıldığında sahipsiz kalmasın.
  if v_exclusive and nullif(btrim(coalesce(v_item.image_storage_path, '')), '') is not null then
    v_paths := v_paths || v_item.image_storage_path;
  end if;

  v_queued := public.news_media_cleanup_enqueue(
    v_item.connection_id, v_item.id, v_item.post_id, v_paths
  );

  update public.news_publication_links
     set status = 'removed',
         removed_at = now(),
         removed_reason = left(coalesce(p_reason, 'manual_removal'), 200)
   where item_id = v_item.id and status <> 'removed';

  update public.news_source_items
     set status = 'removed',
         removed_at = now(),
         removed_reason = left(coalesce(p_reason, 'manual_removal'), 200)
   where id = v_item.id;

  perform public.tz_admin_audit(
    'news.item.remove', 'Haber yayından kaldırıldı', 'news_source_item', v_item.id::text,
    jsonb_build_object(
      'connection_id', v_item.connection_id,
      'post_id', v_item.post_id,
      'post_removed', v_post_removed,
      'shared_post_kept', v_item.post_id is not null and not v_exclusive,
      'media_paths', v_paths,
      'media_queued', v_queued,
      'reason', p_reason
    )
  );

  return jsonb_build_object(
    'removed', true,
    'post_removed', v_post_removed,
    'post_kept_shared', v_item.post_id is not null and not v_exclusive,
    'media_paths', v_paths,
    'media_queued', v_queued
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Kaynak silme: her öğe için medyayı kuyruğa al
-- ---------------------------------------------------------------------------
create or replace function public.news_source_deletion_run(
  p_job_id uuid,
  p_max_items integer default 25
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.news_source_deletion_jobs%rowtype;
  v_conn public.news_api_connections%rowtype;
  v_profile public.news_source_profiles%rowtype;
  v_item record;
  v_exclusive boolean;
  v_paths text[];
  v_all_media text[] := array[]::text[];
  v_queued integer := 0;
  v_remaining integer;
  v_processed integer := 0;
  v_new_progress jsonb;
begin
  select * into v_job from public.news_source_deletion_jobs where id = p_job_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'job_not_found');
  end if;
  if v_job.status in ('completed','failed') then
    return jsonb_build_object('ok', true, 'status', v_job.status);
  end if;

  select * into v_conn from public.news_api_connections where id = v_job.connection_id;

  if v_conn.id is null then
    update public.news_source_deletion_jobs
       set status = 'completed', finished_at = now(), progress = '{"note":"connection_missing"}'::jsonb
     where id = p_job_id;
    return jsonb_build_object('ok', true, 'status', 'completed');
  end if;

  if v_job.status = 'queued' then
    if v_job.scope = 'disable_only' then
      update public.news_api_connections
         set status = 'disabled',
             auto_publish_enabled = false,
             last_error = null,
             auto_disabled_reason = 'Yönetici kaynağı kapattı.'
       where id = v_conn.id;

      update public.news_ingestion_jobs
         set status = 'skipped', error = coalesce(error, 'source_disabled')
       where connection_id = v_conn.id and status = 'running';

      insert into public.news_source_deletion_results (job_id, outcome, detail)
      values (p_job_id, 'connection_disabled', 'Yeni çekim ve otomatik yayın durduruldu; yayımlanan haberler korundu.');

      update public.news_source_deletion_jobs
         set status = 'completed',
             started_at = now(),
             finished_at = now(),
             counts = public.news_deletion_snapshot(v_conn.id),
             progress = jsonb_build_object('processed', 0, 'kept_posts', true)
       where id = p_job_id;

      return jsonb_build_object('ok', true, 'status', 'completed');
    end if;

    update public.news_source_deletion_jobs
       set status = 'running',
           started_at = now(),
           counts = public.news_deletion_snapshot(v_conn.id)
     where id = p_job_id;

    update public.news_api_connections
       set status = 'deleting',
           auto_publish_enabled = false
     where id = v_conn.id;

    update public.news_ingestion_jobs
       set status = 'skipped', error = coalesce(error, 'source_disabled')
     where connection_id = v_conn.id and status = 'running';

    select * into v_job from public.news_source_deletion_jobs where id = p_job_id;
  end if;

  for v_item in
    select i.id, i.post_id, i.image_storage_path
    from public.news_source_items i
    where i.connection_id = v_conn.id
      and i.status <> 'removed'
    order by i.first_seen_at
    limit least(greatest(coalesce(p_max_items, 25), 1), 100)
  loop
    v_paths := array[]::text[];
    v_exclusive := public.news_post_is_exclusive(v_item.post_id, v_conn.id);

    if v_item.post_id is not null then
      if v_exclusive then
        update public.posts
           set moderation_status = 'removed'
         where id = v_item.post_id and moderation_status <> 'removed';

        select coalesce(array_agg(storage_path), array[]::text[])
          into v_paths
          from public.post_media where post_id = v_item.post_id;

        if v_paths is not null and array_length(v_paths, 1) > 0 then
          v_all_media := v_all_media || v_paths;
          delete from public.post_media where post_id = v_item.post_id;
        end if;

        if nullif(btrim(coalesce(v_item.image_storage_path, '')), '') is not null then
          v_all_media := v_all_media || v_item.image_storage_path;
          v_paths := v_paths || v_item.image_storage_path;
        end if;

        v_queued := v_queued + public.news_media_cleanup_enqueue(
          v_conn.id, v_item.id, v_item.post_id, v_paths
        );

        insert into public.news_source_deletion_results (job_id, item_id, post_id, outcome, detail)
        values (p_job_id, v_item.id, v_item.post_id, 'post_removed', 'Kaynağa münhasır yayın kaldırıldı.');
      else
        insert into public.news_source_deletion_results (job_id, item_id, post_id, outcome, detail)
        values (p_job_id, v_item.id, v_item.post_id, 'shared_post_kept', 'Diğer kaynaklarla doğrulanan yayın korundu.');
      end if;
    else
      insert into public.news_source_deletion_results (job_id, item_id, post_id, outcome, detail)
      values (p_job_id, v_item.id, null, 'item_removed', 'Yayımlanmamış kaynak kaydı kaldırıldı.');
    end if;

    update public.news_publication_links
       set status = 'removed',
           removed_at = now(),
           removed_reason = 'source_removed'
     where item_id = v_item.id and status <> 'removed';

    update public.news_source_items
       set status = 'removed',
           removed_at = now(),
           removed_reason = 'source_removed'
     where id = v_item.id;

    v_processed := v_processed + 1;
  end loop;

  select count(*) into v_remaining
  from public.news_source_items
  where connection_id = v_conn.id and status <> 'removed';

  v_new_progress := jsonb_build_object(
    'processed', coalesce((v_job.progress->>'processed')::int, 0) + v_processed,
    'remaining', v_remaining,
    'media_collected', coalesce(array_length(v_all_media, 1), 0),
    'media_queued', v_queued
  );

  if v_remaining > 0 then
    update public.news_source_deletion_jobs
       set progress = v_new_progress,
           media_paths = (
             select coalesce(array_agg(distinct x), '{}'::text[])
             from unnest(v_job.media_paths || v_all_media) x
           )
     where id = p_job_id;

    return jsonb_build_object('ok', true, 'status', 'running', 'remaining', v_remaining);
  end if;

  if v_job.scope = 'purge' then
    if v_conn.purge_profile then
      select * into v_profile from public.news_source_profiles where connection_id = v_conn.id;
      if v_profile.profile_id is not null
         and not exists (
           select 1 from public.news_source_profiles sp
           where sp.profile_id = v_profile.profile_id and sp.connection_id <> v_conn.id
         )
      then
        update public.profiles
           set account_status = 'deleted'
         where id = v_profile.profile_id
           and account_status <> 'deleted';

        delete from public.news_source_profiles where connection_id = v_conn.id;

        insert into public.news_source_deletion_results (job_id, outcome, detail)
        values (p_job_id, 'profile_deactivated', 'Kaynağa ait sosyal profil devre dışı bırakıldı.');
      else
        insert into public.news_source_deletion_results (job_id, outcome, detail)
        values (p_job_id, 'profile_kept', 'Profil başka bir kaynakla paylaşıldığı için korundu.');
      end if;
    else
      insert into public.news_source_deletion_results (job_id, outcome, detail)
      values (p_job_id, 'profile_kept', 'Profil koruma seçeneği etkin.');
    end if;

    delete from public.news_api_credentials where connection_id = v_conn.id;

    delete from public.news_api_health_logs where connection_id = v_conn.id;

    delete from public.news_api_filters where connection_id = v_conn.id;
    delete from public.news_api_field_mappings where connection_id = v_conn.id;
    delete from public.news_api_category_mappings where connection_id = v_conn.id;

    update public.news_api_connections
       set status = 'disabled',
           archived_at = now(),
           auto_publish_enabled = false,
           default_params = '{}'::jsonb,
           auth_header_name = null,
           auth_query_param = null,
           auth_username = null,
           last_error = null,
           notes = null
     where id = v_conn.id;

    insert into public.news_source_deletion_results (job_id, outcome, detail)
    values (p_job_id, 'connection_archived', 'Kaynak bağlantısı ve konfigürasyonu arşivlendi.');
  else
    update public.news_api_connections
       set status = 'disabled',
           auto_publish_enabled = false,
           last_error = null
     where id = v_conn.id;
  end if;

  update public.news_source_deletion_jobs
     set status = 'completed',
         finished_at = now(),
         progress = v_new_progress || jsonb_build_object('finished', true),
         media_paths = (
           select coalesce(array_agg(distinct x), '{}'::text[])
           from unnest(v_job.media_paths || v_all_media) x
         ),
         counts = coalesce(nullif(counts, '{}'::jsonb), public.news_deletion_snapshot(v_conn.id))
   where id = p_job_id;

  perform public.tz_admin_audit(
    'news.deletion.complete', 'Haber kaynağı kaldırma işi tamamlandı', 'news_api_connection', v_conn.id::text,
    jsonb_build_object('job_id', p_job_id, 'scope', v_job.scope, 'media_paths', v_all_media, 'media_queued', v_queued)
  );

  return jsonb_build_object('ok', true, 'status', 'completed');
exception
when others then
  update public.news_source_deletion_jobs
     set status = 'failed',
         finished_at = now(),
         error = left(sqlerrm, 500)
   where id = p_job_id;
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end;
$$;

-- ---------------------------------------------------------------------------
-- Worker medya temizliği RPC'leri
-- ---------------------------------------------------------------------------
create or replace function public.news_worker_media_cleanup_pending(p_limit integer default 20)
returns setof public.news_media_cleanup_queue
language sql
security definer
set search_path = public
as $$
  select *
  from public.news_media_cleanup_queue
  where status = 'pending'
    and attempts < 5
  order by created_at
  limit least(greatest(coalesce(p_limit, 20), 1), 100);
$$;

create or replace function public.news_worker_media_cleanup_mark(
  p_id bigint,
  p_ok boolean,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.news_media_cleanup_queue%rowtype;
begin
  update public.news_media_cleanup_queue
     set attempts = attempts + 1,
         status = case when p_ok then 'done' else 'failed' end,
         processed_at = case when p_ok then now() else null end,
         last_error = case when p_ok then null else left(coalesce(p_error, 'unknown'), 500) end
   where id = p_id
  returning * into v_row;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  return jsonb_build_object('ok', true, 'status', v_row.status, 'attempts', v_row.attempts);
end;
$$;

revoke all on function public.news_worker_media_cleanup_pending(integer) from public;
revoke all on function public.news_worker_media_cleanup_mark(bigint, boolean, text) from public;
grant execute on function public.news_worker_media_cleanup_pending(integer) to service_role;
grant execute on function public.news_worker_media_cleanup_mark(bigint, boolean, text) to service_role;
