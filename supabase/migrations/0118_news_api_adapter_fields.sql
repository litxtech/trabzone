-- 0102 — Haber API bağlantısı: adapter alanları (öğe yolu, sayfalama, since)
--
-- Neden: `admin_news_connection_save` ilk sürümünde `items_path`,
-- `pagination_kind`, `pagination_param`, `next_path` ve `since_param`
-- alanlarını yazmıyordu. Edge Function bu alanları okuduğu için panelden
-- yapılandırılamıyordu. Bu RPC yalnızca adapter alanlarını günceller; mevcut
-- bağlantı kaydetme akışını değiştirmez.

create or replace function public.admin_news_connection_adapter_save(p_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.tz_admin_require('news.manage', false);
  v_c public.news_api_connections%rowtype;
  v_items_path text;
  v_pagination text := coalesce(nullif(btrim(coalesce(p_payload->>'pagination_kind', '')), ''), 'auto');
  v_pagination_param text;
  v_next_path text;
  v_since_param text;
begin
  select * into v_c from public.news_api_connections where id = p_id for update;
  if not found then
    raise exception 'connection_not_found' using errcode = 'P0002';
  end if;

  if v_pagination not in ('auto','none','page','next_url','cursor') then
    raise exception 'invalid_pagination' using errcode = '22023';
  end if;

  v_items_path := nullif(btrim(coalesce(p_payload->>'items_path', '')), '');
  if v_items_path is not null and v_items_path !~ '^[A-Za-z0-9_.\[\]$-]{1,200}$' then
    raise exception 'invalid_items_path' using errcode = '22023';
  end if;

  v_pagination_param := nullif(btrim(coalesce(p_payload->>'pagination_param', '')), '');
  if v_pagination_param is not null and v_pagination_param !~ '^[A-Za-z0-9_.\-]{1,80}$' then
    raise exception 'invalid_pagination_param' using errcode = '22023';
  end if;

  v_next_path := nullif(btrim(coalesce(p_payload->>'next_path', '')), '');
  if v_next_path is not null and v_next_path !~ '^[A-Za-z0-9_.\[\]$-]{1,200}$' then
    raise exception 'invalid_next_path' using errcode = '22023';
  end if;

  v_since_param := nullif(btrim(coalesce(p_payload->>'since_param', '')), '');
  if v_since_param is not null and v_since_param !~ '^[A-Za-z0-9_.\-]{1,80}$' then
    raise exception 'invalid_since_param' using errcode = '22023';
  end if;

  update public.news_api_connections
     set items_path = v_items_path,
         pagination_kind = v_pagination,
         pagination_param = v_pagination_param,
         next_path = v_next_path,
         since_param = v_since_param,
         auth_username = case
           when p_payload ? 'auth_username' then nullif(btrim(coalesce(p_payload->>'auth_username', '')), '')
           else auth_username
         end,
         field_hints = case
           when jsonb_typeof(coalesce(p_payload->'field_hints', 'null'::jsonb)) = 'object'
             then p_payload->'field_hints'
           else field_hints
         end,
         updated_at = now()
   where id = p_id;

  update public.news_api_credentials
     set username = (select auth_username from public.news_api_connections where id = p_id),
         updated_at = now()
   where connection_id = p_id;

  perform public.tz_admin_audit(
    'news.connection.adapter', 'Haber kaynağı adapter ayarları güncellendi', 'news_api_connection', p_id::text,
    jsonb_build_object(
      'items_path', v_items_path,
      'pagination_kind', v_pagination,
      'pagination_param', v_pagination_param,
      'since_param', v_since_param
    )
  );

  return public.news_connection_row_json(p_id);
end;
$$;

revoke all on function public.admin_news_connection_adapter_save(uuid, jsonb) from public, anon;
grant execute on function public.admin_news_connection_adapter_save(uuid, jsonb) to authenticated;
