-- =============================================================================
-- TRABZONE KONAKLAMA — Yorum moderasyonu
-- Otel yalnızca kendi tesisine ait yorumların yayın durumunu değiştirebilir.
-- Silme yapılmaz; gizlenen yorum denetim amacıyla korunur.
-- =============================================================================

create or replace function public.acc_review_status(
  p_review_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  r public.acc_reviews%rowtype;
begin
  if p_status not in ('published', 'hidden') then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  select * into r from public.acc_reviews where id = p_review_id;
  if not found then
    raise exception 'review_not_found' using errcode = 'P0002';
  end if;

  v_uid := public.acc_require(r.property_id, 'reviews');

  update public.acc_reviews
     set status = p_status
   where id = p_review_id
  returning * into r;

  insert into public.acc_activity (property_id, actor_id, action, entity_type, entity_id, detail)
  values (
    r.property_id, v_uid,
    case when p_status = 'published' then 'review_published' else 'review_hidden' end,
    'acc_reviews', r.id::text,
    jsonb_build_object('status', p_status)
  );

  return to_jsonb(r);
end;
$$;

grant execute on function public.acc_review_status(uuid, text) to authenticated, service_role;
