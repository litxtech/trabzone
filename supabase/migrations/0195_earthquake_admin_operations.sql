-- ---------------------------------------------------------------------------
-- 0195 - Deprem Merkezi: manuel worker işlemlerinin yetki + audit kaydı
--
-- earthquake-sync edge function'ı admin JWT'siyle gelen manuel işlemleri
-- (kaynak testi, manuel senkron, geçmiş veri doldurma, bildirim kuyruğunu
-- işletme) bu fonksiyonla doğrular. Fonksiyon yetkiyi denetler ve işlemi
-- audit kaydına yazar; yetki yoksa hata verir ve hiçbir şey yazmaz.
-- ---------------------------------------------------------------------------
set search_path = public, extensions;

create or replace function public.earthquake_admin_operation_log(
  p_operation text,
  p_provider  text default null,
  p_detail    jsonb default '{}'::jsonb,
  p_reason    text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_permission text;
  v_critical boolean := false;
begin
  case p_operation
    when 'test' then v_permission := 'earthquake.view';
    when 'sync' then v_permission := 'earthquake.manage';
    when 'backfill' then v_permission := 'earthquake.manage'; v_critical := true;
    when 'dispatch' then v_permission := 'earthquake.notify';
    else raise exception 'invalid_action' using errcode = '22023';
  end case;
  if p_provider is not null and p_provider not in ('afad', 'usgs') then
    raise exception 'invalid_provider' using errcode = '22023';
  end if;

  perform public.tz_admin_require(v_permission, v_critical);
  perform public.earthquake_rate_check('earthquake_admin_operation_' || p_operation, 30, 600);

  perform public.earthquake_audit(
    'manual_' || p_operation, 'earthquake_worker', coalesce(p_provider, 'all'),
    coalesce(nullif(left(trim(coalesce(p_reason, '')), 500), ''), 'Manuel işlem'),
    null,
    coalesce(p_detail, '{}'::jsonb) - 'token' - 'authorization');
  return true;
end;
$$;

revoke all on function public.earthquake_admin_operation_log(text, text, jsonb, text) from public, anon;
grant execute on function public.earthquake_admin_operation_log(text, text, jsonb, text) to authenticated;
