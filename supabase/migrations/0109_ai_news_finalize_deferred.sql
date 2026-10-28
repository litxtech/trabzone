-- AI Haber Merkezi: otomatik yayın zamanlaması nedeniyle ertelenen olaylar
-- inceleme kuyruğuna düşmez; bir sonraki döngüde yeniden denenir.

create or replace function public.ai_news_finalize(
  p_event_id uuid,
  p_run_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings public.ai_news_settings%rowtype;
  v_event public.ai_news_events%rowtype;
  v_draft public.ai_news_drafts%rowtype;
  v_media public.ai_news_media_assets%rowtype;
  v_reasons text[] := '{}'::text[];
  v_publish jsonb;
  v_error text;
  v_priority smallint := 50;
begin
  select * into v_settings from public.ai_news_settings where id;
  select * into v_event from public.ai_news_events where id = p_event_id for update;
  if not found then
    raise exception 'event_not_found' using errcode = 'P0002';
  end if;

  select * into v_draft from public.ai_news_drafts
  where event_id = p_event_id and is_current
  order by version desc limit 1;

  select * into v_media
  from public.ai_news_media_assets m
  where m.event_id = p_event_id and m.status = 'approved'
  order by m.is_placeholder asc, m.created_at asc
  limit 1;

  if v_draft.id is null then
    v_reasons := array_append(v_reasons, 'draft_missing');
  else
    if v_draft.quality_score < v_settings.min_quality_score then
      v_reasons := array_append(v_reasons, 'quality_too_low');
    end if;
    if v_draft.plagiarism_score > 0.35 then
      v_reasons := array_append(v_reasons, 'plagiarism_risk');
    end if;
  end if;

  if v_media.id is null then
    v_reasons := array_append(v_reasons, 'media_missing');
  end if;

  v_reasons := v_reasons || v_event.auto_block_reasons;

  if v_event.risk_level <> 'A' then
    v_reasons := array_append(v_reasons, 'risk_not_low');
  end if;
  if v_settings.auto_publish_enabled is not true then
    v_reasons := array_append(v_reasons, 'auto_publish_disabled');
  end if;
  if v_settings.dry_run then
    v_reasons := array_append(v_reasons, 'dry_run_active');
  end if;

  v_reasons := array(
    select distinct unnest(v_reasons)
  );

  if cardinality(v_reasons) = 0 then
    begin
      v_publish := public.ai_news_publish_event(p_event_id, 'auto', null);
      return jsonb_build_object(
        'action', 'published',
        'reasons', '[]'::jsonb,
        'publication', v_publish
      );
    exception
      when others then
        v_error := sqlerrm;
        v_reasons := array_append(v_reasons, v_error);
    end;
  end if;

  -- Yayın penceresi / minimum aralık / günlük kota: geçici engel.
  -- Olay yayına hazır kalır ve sonraki döngüde otomatik gönderilir.
  if v_error in ('publish_deferred', 'quota_exhausted') then
    if v_event.status <> 'ready' then
      perform public.ai_news_event_set_status(p_event_id, 'ready');
    end if;
    update public.ai_news_drafts
       set status = 'ready'
     where event_id = p_event_id and is_current;

    return jsonb_build_object(
      'action', 'deferred',
      'reasons', to_jsonb(v_reasons),
      'deferred_reason', v_error
    );
  end if;

  if v_event.status not in ('awaiting_review', 'ready', 'media_checking', 'draft', 'verified') then
    perform public.ai_news_event_set_status(p_event_id, 'awaiting_review');
  end if;

  if v_event.risk_level = 'C' then
    v_priority := 90;
  elsif v_event.risk_level = 'B' then
    v_priority := 70;
  end if;
  if v_event.conflict then
    v_priority := 95;
  end if;

  insert into public.ai_news_review_queue (event_id, draft_id, reasons, priority, state)
  values (p_event_id, v_draft.id, v_reasons, v_priority, 'pending')
  on conflict (event_id) do update
    set draft_id = excluded.draft_id,
        reasons = excluded.reasons,
        priority = greatest(public.ai_news_review_queue.priority, excluded.priority),
        state = case when public.ai_news_review_queue.state = 'pending'
                     then 'pending' else public.ai_news_review_queue.state end;

  update public.ai_news_drafts
     set status = 'awaiting_review'
   where event_id = p_event_id and is_current;

  if p_run_id is not null and v_error is not null then
    perform public.ai_news_log_error(p_run_id, 'publish', v_error, 'Otomatik yayın kapısı', jsonb_build_object(
      'event_id', p_event_id, 'reasons', v_reasons
    ));
  end if;

  return jsonb_build_object(
    'action', 'review',
    'reasons', to_jsonb(v_reasons),
    'priority', v_priority
  );
end;
$$;
