-- 0099 — AI Haber Merkezi: arama konularının tür dengesi
--
-- 0094'te konu seçimi yalnızca `priority desc` ile yapılıyordu. Bu durumda
-- yüksek öncelikli üç genel/sport sorgusu her çalışmada seçiliyor, resmî
-- kurum ve ilçe sorguları hiç kullanılmıyordu. Yeni seçim her türden en iyi
-- konuyu alır ve en uzun süredir kullanılmayan türü öne çekararak rotasyon
-- sağlar. Böylece 15 dakikalık döngülerde resmî duyurular da taranır.

create or replace function public.ai_news_pick_topics(p_limit integer)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', x.id, 'query', x.query, 'kind', x.kind, 'priority', x.priority
  ) order by (x.kind = 'official') desc, x.last_used_at nulls first, x.priority desc), '[]'::jsonb)
  from (
    select t.id, t.query, t.kind, t.priority, t.last_used_at
    from (
      select t.*,
             row_number() over (
               partition by t.kind
               order by t.priority desc, t.last_used_at nulls first
             ) as kind_rank
      from public.ai_news_search_topics t
      where t.active
    ) t
    where t.kind_rank = 1
    -- Resmî kaynaklar her turda bir kez denenir; otomatik yayın için
    -- birincil doğrulama şansı buradan gelir.
    order by (t.kind = 'official') desc, t.last_used_at nulls first, t.priority desc
    limit least(greatest(coalesce(p_limit, 3), 1), 10)
  ) x;
$$;

create or replace function public.ai_news_run_begin(p_trigger text default 'cron')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings public.ai_news_settings%rowtype;
  v_run public.ai_news_runs%rowtype;
  v_busy public.ai_news_runs%rowtype;
  v_topics jsonb;
  v_quota jsonb;
  v_budget jsonb;
  v_publisher jsonb;
begin
  select * into v_settings from public.ai_news_settings where id for update;

  if v_settings.enabled is not true then
    return jsonb_build_object('skipped', 'disabled');
  end if;

  -- Yarım kalmış çalışmaları temizle (12 dakikadan eski heartbeat).
  update public.ai_news_runs r
     set status = 'failed',
         finished_at = now(),
         error = coalesce(r.error, 'stale_run_timeout')
   where r.status = 'running'
     and r.heartbeat_at < now() - interval '12 minutes';

  select * into v_busy
  from public.ai_news_runs r
  where r.status = 'running'
  limit 1;

  if found then
    return jsonb_build_object('skipped', 'busy', 'run_id', v_busy.id);
  end if;

  v_budget := public.ai_news_budget_status();
  if (v_budget ->> 'exhausted')::boolean then
    update public.ai_news_settings
       set next_run_at = now() + make_interval(mins => v_settings.scan_interval_minutes)
     where id;
    return jsonb_build_object('skipped', 'budget_exhausted', 'budget', v_budget);
  end if;

  begin
    insert into public.ai_news_runs (trigger, status)
    values (coalesce(nullif(p_trigger, ''), 'cron'), 'running')
    returning * into v_run;
  exception
    when unique_violation then
      return jsonb_build_object('skipped', 'busy');
  end;

  update public.ai_news_settings
     set last_tick_at = now(),
         next_run_at = now() + make_interval(mins => v_settings.scan_interval_minutes)
   where id;

  v_topics := public.ai_news_pick_topics(v_settings.max_searches_per_run);

  v_quota := public.ai_news_quota_status();

  select case when p.id is null then null else jsonb_build_object(
    'id', p.id, 'username', p.username, 'display_name', p.display_name,
    'is_verified', p.is_verified, 'avatar_path', p.avatar_path
  ) end
  into v_publisher
  from public.profiles p
  where p.id = coalesce(
    v_settings.publisher_user_id,
    (select pr.id from public.profiles pr where pr.username = v_settings.publisher_username)
  );

  return jsonb_build_object(
    'run_id', v_run.id,
    'settings', jsonb_build_object(
      'max_events_per_run', v_settings.max_events_per_run,
      'max_article_age_hours', v_settings.max_article_age_hours,
      'min_quality_score', v_settings.min_quality_score,
      'duplicate_title_threshold', v_settings.duplicate_title_threshold,
      'min_media_match', v_settings.min_media_match,
      'fast_model', v_settings.fast_model,
      'reasoning_model', v_settings.reasoning_model,
      'auto_publish_enabled', v_settings.auto_publish_enabled,
      'dry_run', v_settings.dry_run,
      'price_input_per_m', v_settings.price_input_per_m,
      'price_output_per_m', v_settings.price_output_per_m,
      'price_search_per_call', v_settings.price_search_per_call,
      'price_fetch_per_call', v_settings.price_fetch_per_call,
      'notify_enabled', v_settings.notify_enabled
    ),
    'topics', v_topics,
    'quota', v_quota,
    'budget', v_budget,
    'publisher', v_publisher
  );
end;
$$;

revoke all on function public.ai_news_pick_topics(integer) from public, anon, authenticated;
revoke all on function public.ai_news_run_begin(text) from public, anon, authenticated;
grant execute on function public.ai_news_run_begin(text) to service_role;

-- Resmî/ilçe konularının ilk turda kullanılmasını sağlamak için kullanım
-- geçmişini sıfırla; mevcut istatistikler korunur.
update public.ai_news_search_topics
   set last_used_at = null
 where kind in ('official', 'district', 'category')
   and uses = 0;
