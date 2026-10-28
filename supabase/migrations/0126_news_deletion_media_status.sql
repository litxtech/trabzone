-- 0105 — Silme işi yanıtına medya temizliği durumu
--
-- Kaynak silme işi tamamlandıktan sonra Storage dosyaları worker tarafından
-- kuyruktan temizlenir. Panelin "tamamlandı" demeden önce medya durumunu
-- gösterebilmesi için iş yanıtına kuyruk özeti eklenir.

create or replace function public.admin_news_deletion_job_get(p_job_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('news.view', false);
  v_job public.news_source_deletion_jobs%rowtype;
begin
  select * into v_job from public.news_source_deletion_jobs where id = p_job_id;
  if not found then
    raise exception 'job_not_found' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'job', to_jsonb(v_job),
    'results', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'item_id', r.item_id, 'post_id', r.post_id,
        'outcome', r.outcome, 'detail', r.detail, 'created_at', r.created_at
      ) order by r.id)
      from (
        select * from public.news_source_deletion_results
        where job_id = p_job_id order by id desc limit 300
      ) r
    ), '[]'::jsonb),
    'media_cleanup', (
      select jsonb_build_object(
        'pending', count(*) filter (where q.status = 'pending'),
        'done', count(*) filter (where q.status = 'done'),
        'failed', count(*) filter (where q.status = 'failed')
      )
      from public.news_media_cleanup_queue q
      where q.connection_id = v_job.connection_id
        and q.created_at >= v_job.requested_at
    )
  );
end;
$$;
